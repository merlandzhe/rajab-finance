create function private.cents(value text) returns bigint language plpgsql immutable as $$begin
 if value is null or value !~ '^[0-9]{1,12}$' then raise exception 'Некорректная сумма в копейках'; end if;
 return value::bigint;
end$$;
create function private.profit(cost bigint, months int, mode text, bps int, grid jsonb, custom_kind text default null, custom_value text default null) returns bigint language plpgsql immutable as $$declare rate int; result bigint; begin
 if cost<=0 or cost>100000000000 or months not between 1 and 36 then raise exception 'Некорректная стоимость или срок'; end if;
 if mode='fixed' then rate:=bps;
 elsif mode='term' then rate:=(grid->>months::text)::int; if rate is null then raise exception 'Для этого срока тариф не задан'; end if;
 elsif mode='individual' then
   if custom_kind='rubles' then result:=private.cents(custom_value);
   elsif custom_kind='percent' then rate:=private.cents(custom_value)::int;
   else raise exception 'Укажите индивидуальную прибыль'; end if;
 else raise exception 'Неизвестный режим тарифа'; end if;
 if rate is not null then if rate not between 0 and 100000 then raise exception 'Наценка вне диапазона'; end if; result:=round(cost::numeric*rate/10000)::bigint; end if;
 if result<0 or result>100000000000 then raise exception 'Прибыль вне диапазона'; end if; return result;
end$$;
create function public.app_command(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
#variable_conflict use_column
declare
 incoming jsonb:=p_payload;
 t uuid:=private.current_tenant(); r text:=private.current_role(); u uuid:=auth.uid();
 a public.applications; pur public.purchases; c public.contracts; st public.organization_settings;
 original public.payments; op public.operations; doc public.documents;
 entity uuid; result jsonb; id2 uuid; amount bigint; profit bigint; price bigint; downp bigint; months int;
 remaining bigint; each_amount bigint; allocated bigint; account uuid; firstday date; rec record; i int;
begin
 if u is null or t is null or r='client' then raise exception 'Нет прав для выполнения операции' using errcode='42501'; end if;
 if p_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>20000 then raise exception 'Некорректная операция'; end if;
 if p_action in ('settings.update','cash.create','payment.reverse') and r<>'owner' then raise exception 'Требуются права владельца' using errcode='42501'; end if;
 if p_action in ('customer.create','application.create','application.transition','document.register','purchase.record','quote.confirm','contract.create','contract.transfer') and r not in ('owner','manager') then raise exception 'Требуются права менеджера' using errcode='42501'; end if;
 if p_action in ('payment.record','cash.move') and r not in ('owner','cashier') then raise exception 'Требуются права кассира' using errcode='42501'; end if;
 -- Serializes financial writes and idempotency within a tenant. No untrusted tenant parameter.
 perform 1 from public.organizations where id=t for update;
 select * into op from public.operations where tenant_id=t and operation_key=p_key;
 if found then
   if op.action<>p_action or op.payload<>p_payload or op.actor_id<>u then raise exception 'Ключ операции уже использован для других данных'; end if;
   return op.result;
 end if;
 select * into st from public.organization_settings where tenant_id=t order by version desc limit 1;
 if p_action='customer.create' then
   if length(trim(p_payload->>'name')) not between 2 and 120 or coalesce(p_payload->>'phone','') !~ '^\+?[0-9 ()-]{7,24}$' then raise exception 'Проверьте имя и телефон'; end if;
   insert into public.customers(tenant_id,name,phone,email,notes) values(t,trim(p_payload->>'name'),p_payload->>'phone',nullif(p_payload->>'email',''),left(coalesce(p_payload->>'notes',''),2000)) returning id into entity;
 elsif p_action='application.create' then
   if not exists(select 1 from public.customers where tenant_id=t and id=(p_payload->>'customer_id')::uuid) then raise exception 'Клиент не найден'; end if;
   if length(trim(p_payload->>'product_name')) not between 2 and 160 then raise exception 'Укажите товар'; end if;
   insert into public.applications(tenant_id,customer_id,product_name,product_url,supplier,estimated_cost,down_payment,months,notes,created_by)
   values(t,(p_payload->>'customer_id')::uuid,trim(p_payload->>'product_name'),left(p_payload->>'product_url',1000),left(coalesce(p_payload->>'supplier',''),160),private.cents(p_payload->>'estimated_cost'),private.cents(p_payload->>'down_payment'),(p_payload->>'months')::int,left(coalesce(p_payload->>'notes',''),2000),u) returning id into entity;
   insert into public.notifications(tenant_id,kind,dedupe_key,message) values(t,'application','application:'||entity,'Новая заявка '||left(entity::text,8)||'. Откройте CRM для просмотра.');
 elsif p_action='application.transition' then
   select * into a from public.applications where tenant_id=t and id=(p_payload->>'id')::uuid for update;
   if not found then raise exception 'Заявка не найдена'; end if;
   if not ((a.status='draft' and p_payload->>'status'='review') or (a.status='review' and p_payload->>'status' in ('approved','rejected')) or (a.status='approved' and p_payload->>'status'='awaiting_purchase')) then raise exception 'Недопустимый переход статуса'; end if;
   update public.applications set status=p_payload->>'status' where id=a.id; entity:=a.id;
   p_payload:=p_payload||jsonb_build_object('previous_status',a.status);
 elsif p_action='document.register' then
   entity:=(p_payload->>'application_id')::uuid;
   if not exists(select 1 from public.applications where tenant_id=t and id=entity and status<>'contracted') then raise exception 'Заявка недоступна для загрузки'; end if;
   if p_payload->>'storage_path' not like t::text||'/'||entity::text||'/%' or not exists(select 1 from storage.objects where bucket_id='deal-documents' and name=p_payload->>'storage_path') then raise exception 'Проверенный файл не найден'; end if;
   insert into public.documents(tenant_id,application_id,kind,name,storage_path,mime_type,size_bytes,sha256,created_by)
   values(t,entity,p_payload->>'kind',left(p_payload->>'name',180),p_payload->>'storage_path',p_payload->>'mime_type',(p_payload->>'size_bytes')::int,p_payload->>'sha256',u) returning id into entity;
 elsif p_action='purchase.record' then
   select * into a from public.applications where tenant_id=t and id=(p_payload->>'id')::uuid for update;
   if not found or a.status<>'awaiting_purchase' then raise exception 'Сначала согласуйте заявку и переведите её в ожидание закупки'; end if;
   select * into doc from public.documents where tenant_id=t and application_id=a.id and id=(p_payload->>'document_id')::uuid and kind='purchase_receipt';
   if not found then raise exception 'Прикрепите документ закупки'; end if;
   if coalesce((p_payload->>'ownership_confirmed')::boolean,false)=false then raise exception 'Подтвердите приобретение и право собственности'; end if;
   if (p_payload->>'purchased_on')::date>current_date then raise exception 'Дата закупки не может быть в будущем'; end if;
   insert into public.purchases(tenant_id,application_id,supplier,cost,purchased_on,ownership_confirmed,document_id,created_by)
   values(t,a.id,p_payload->>'supplier',private.cents(p_payload->>'cost'),(p_payload->>'purchased_on')::date,true,doc.id,u);
   update public.applications set status='purchased',final_quote=null where id=a.id; entity:=a.id;
 elsif p_action='quote.confirm' then
   select * into a from public.applications where tenant_id=t and id=(p_payload->>'id')::uuid for update;
   if not found or a.status not in ('purchased','ready_to_sell') then raise exception 'Окончательная цена согласуется после закупки'; end if;
   select * into pur from public.purchases where tenant_id=t and application_id=a.id;
   if not found or not pur.ownership_confirmed then raise exception 'Нет подтверждённой закупки'; end if;
   if coalesce((p_payload->>'agreed')::boolean,false)=false then raise exception 'Подтвердите повторное согласование с клиентом'; end if;
   if (st.mode='individual' or coalesce(p_payload->>'custom_kind','')<>'') and r<>'owner' then raise exception 'Индивидуальную прибыль задаёт владелец' using errcode='42501'; end if;
   months:=(p_payload->>'months')::int;
   profit:=private.profit(pur.cost,months,case when coalesce(p_payload->>'custom_kind','')<>'' then 'individual' else st.mode end,st.fixed_bps,st.term_rates,p_payload->>'custom_kind',p_payload->>'custom_value');
   price:=pur.cost+profit; downp:=private.cents(p_payload->>'down_payment'); firstday:=(p_payload->>'first_payment_on')::date;
   if downp>price or firstday<=current_date then raise exception 'Проверьте взнос и дату первого платежа'; end if;
   update public.applications set status='ready_to_sell',down_payment=downp,months=months,final_quote=jsonb_build_object('cost',pur.cost::text,'profit',profit::text,'sale_price',price::text,'down_payment',downp::text,'months',months,'first_payment_on',firstday,'settings_version',st.version,'pricing_mode',case when coalesce(p_payload->>'custom_kind','')<>'' then 'individual' else st.mode end,'agreed_at',now(),'agreed_by',u) where id=a.id; entity:=a.id;
 elsif p_action='contract.create' then
   select * into a from public.applications where tenant_id=t and id=(p_payload->>'id')::uuid for update;
   if not found or a.status<>'ready_to_sell' or a.final_quote is null then raise exception 'Требуется закупка и согласование окончательной цены'; end if;
   select * into pur from public.purchases where tenant_id=t and application_id=a.id;
   if not found or not pur.ownership_confirmed or pur.document_id is null then raise exception 'Без приобретения товара продавцом договор запрещён'; end if;
   price:=(a.final_quote->>'sale_price')::bigint; profit:=(a.final_quote->>'profit')::bigint; downp:=a.down_payment; months:=a.months; firstday:=(a.final_quote->>'first_payment_on')::date;
   if firstday<=current_date then raise exception 'Повторно согласуйте будущую дату первого платежа'; end if;
   entity:=gen_random_uuid();
   insert into public.contracts(id,tenant_id,customer_id,application_id,purchase_id,number,signed_on,cost,profit,sale_price,down_payment,months,first_payment_on,created_by)
   values(entity,t,a.customer_id,a.id,pur.id,'RF-'||to_char(current_date,'YY')||'-'||upper(left(entity::text,8)),current_date,pur.cost,profit,price,downp,months,firstday,u);
   insert into public.contract_items(tenant_id,contract_id,product_name,product_url,cost) values(t,entity,a.product_name,a.product_url,pur.cost);
   insert into public.contract_versions(tenant_id,contract_id,snapshot) values(t,entity,a.final_quote||jsonb_build_object('product_name',a.product_name,'product_url',a.product_url,'customer_name',(select name from public.customers where id=a.customer_id),'seller_name',(select name from public.organizations where id=t),'purchase_id',pur.id,'template_version',1,'legal_notice','Не является юридически утверждённым договором'));
   if downp>0 then insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount) values(t,entity,0,current_date,downp); end if;
   remaining:=price-downp; each_amount:=remaining/months;
   for i in 1..months loop
     amount:=case when i=months then remaining-each_amount*(months-1) else each_amount end;
     if amount>0 then insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount) values(t,entity,i,(firstday+make_interval(months=>i-1))::date,amount); end if;
   end loop;
   update public.applications set status='contracted' where id=a.id;
 elsif p_action='contract.transfer' then
   select * into c from public.contracts where tenant_id=t and id=(p_payload->>'id')::uuid for update;
   if not found or c.status<>'signed' or length(trim(coalesce(p_payload->>'reference','')))<3 then raise exception 'Укажите подтверждение передачи для заключённого договора'; end if;
   if (p_payload->>'transferred_on')::date<c.signed_on or (p_payload->>'transferred_on')::date>current_date then raise exception 'Некорректная дата передачи'; end if;
   update public.contracts set transferred_on=(p_payload->>'transferred_on')::date,transfer_reference=left(p_payload->>'reference',1000),status=case when c.sale_price=coalesce((select sum(amount) from public.payments where tenant_id=t and contract_id=c.id),0) then 'closed' else 'transferred' end where id=c.id; entity:=c.id;
 elsif p_action='payment.record' then
   select * into c from public.contracts where tenant_id=t and id=(p_payload->>'contract_id')::uuid for update;
   if not found then raise exception 'Договор не найден'; end if;
   account:=(p_payload->>'cash_account_id')::uuid;
   perform 1 from public.cash_accounts where tenant_id=t and id=account for update;
   if not found then raise exception 'Касса не найдена'; end if;
   amount:=private.cents(p_payload->>'amount');
   remaining:=c.sale_price-coalesce((select sum(amount) from public.payments where tenant_id=t and contract_id=c.id),0);
   if amount<=0 or amount>remaining then raise exception 'Платёж превышает остаток или равен нулю'; end if;
   if (p_payload->>'paid_on')::date<c.signed_on or (p_payload->>'paid_on')::date>current_date then raise exception 'Некорректная дата поступления'; end if;
   insert into public.payments(tenant_id,contract_id,cash_account_id,amount,operation_key,paid_on,created_by) values(t,c.id,account,amount,p_key,(p_payload->>'paid_on')::date,u) returning id into entity;
   remaining:=amount;
   for rec in select s.*,s.amount-coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.tenant_id=t and pa.schedule_id=s.id),0) as unpaid from public.payment_schedules s where s.tenant_id=t and s.contract_id=c.id order by sequence loop
     allocated:=least(remaining,rec.unpaid); if allocated>0 then insert into public.payment_allocations(tenant_id,payment_id,schedule_id,amount) values(t,entity,rec.id,allocated); remaining:=remaining-allocated; end if; exit when remaining=0;
   end loop;
   if remaining<>0 then raise exception 'Ошибка распределения платежа'; end if;
   insert into public.cash_transactions(tenant_id,cash_account_id,payment_id,amount,operation_key,kind,description,created_by) values(t,account,entity,amount,p_key,'payment','Поступление по '||c.number,u);
   if c.transferred_on is not null and c.sale_price=(select sum(amount) from public.payments where tenant_id=t and contract_id=c.id) then update public.contracts set status='closed' where id=c.id; end if;
   insert into public.notifications(tenant_id,kind,dedupe_key,message) values(t,'payment','payment:'||entity,'Платёж зарегистрирован по '||c.number||'. Сведения доступны в CRM.');
 elsif p_action='payment.reverse' then
   select * into original from public.payments where tenant_id=t and id=(p_payload->>'id')::uuid;
   if not found or original.amount<0 or exists(select 1 from public.payments where tenant_id=t and reversal_of=original.id) then raise exception 'Платёж уже отменён или не найден'; end if;
   if length(trim(coalesce(p_payload->>'reason','')))<5 then raise exception 'Укажите причину отмены'; end if;
   perform 1 from public.contracts where tenant_id=t and id=original.contract_id for update;
   perform 1 from public.cash_accounts where tenant_id=t and id=original.cash_account_id for update;
   if st.prevent_negative_cash and coalesce((select sum(amount) from public.cash_transactions where tenant_id=t and cash_account_id=original.cash_account_id),0)<original.amount then raise exception 'Недостаточно средств в кассе для возврата'; end if;
   insert into public.payments(tenant_id,contract_id,cash_account_id,amount,reversal_of,reason,operation_key,paid_on,created_by) values(t,original.contract_id,original.cash_account_id,-original.amount,original.id,left(p_payload->>'reason',1000),p_key,current_date,u) returning id into entity;
   insert into public.payment_allocations(tenant_id,payment_id,schedule_id,amount) select t,entity,schedule_id,-amount from public.payment_allocations where tenant_id=t and payment_id=original.id;
   insert into public.cash_transactions(tenant_id,cash_account_id,payment_id,amount,operation_key,kind,description,created_by) values(t,original.cash_account_id,entity,-original.amount,p_key,'reversal',p_payload->>'reason',u);
   update public.contracts set status=case when transferred_on is null then 'signed' else 'transferred' end where tenant_id=t and id=original.contract_id;
 elsif p_action='cash.create' then
   if length(trim(coalesce(p_payload->>'name','')))<2 then raise exception 'Укажите название кассы'; end if;
   insert into public.cash_accounts(tenant_id,name) values(t,left(p_payload->>'name',80)) returning id into entity;
 elsif p_action='cash.move' then
   account:=(p_payload->>'cash_account_id')::uuid; amount:=private.cents(p_payload->>'amount');
   if amount<=0 or p_payload->>'kind' not in ('income','expense','transfer') then raise exception 'Неверная кассовая операция'; end if;
   perform 1 from public.cash_accounts where tenant_id=t and id=account for update;
   if not found then raise exception 'Касса не найдена'; end if;
   if p_payload->>'kind' in ('expense','transfer') and st.prevent_negative_cash and coalesce((select sum(amount) from public.cash_transactions where tenant_id=t and cash_account_id=account),0)<amount then raise exception 'Недостаточно средств в кассе'; end if;
   if p_payload->>'kind'='transfer' then
     id2:=(p_payload->>'destination_id')::uuid;
     perform 1 from public.cash_accounts where tenant_id=t and id=id2 for update;
     if not found or account=id2 then raise exception 'Выберите другую кассу организации'; end if;
     insert into public.cash_transactions(tenant_id,cash_account_id,amount,operation_key,kind,description,created_by) values(t,id2,amount,p_key,'transfer',left(p_payload->>'description',500),u);
   end if;
   insert into public.cash_transactions(tenant_id,cash_account_id,amount,operation_key,kind,description,created_by) values(t,account,case when p_payload->>'kind'='income' then amount else -amount end,p_key,p_payload->>'kind',left(p_payload->>'description',500),u) returning id into entity;
 elsif p_action='settings.update' then
   if p_payload->>'mode' not in ('fixed','term','individual') or jsonb_typeof(p_payload->'term_rates')<>'object' then raise exception 'Некорректные тарифы'; end if;
   for rec in select key,value from jsonb_each_text(p_payload->'term_rates') loop
     if rec.key !~ '^[0-9]{1,2}$' or rec.key::int not between 1 and 36 or rec.value !~ '^[0-9]{1,6}$' or rec.value::int not between 0 and 100000 then raise exception 'Некорректная тарифная сетка'; end if;
   end loop;
   if p_payload->>'mode'='term' and p_payload->'term_rates'='{}'::jsonb then raise exception 'Заполните сетку'; end if;
   insert into public.organization_settings(tenant_id,version,mode,fixed_bps,term_rates,prevent_negative_cash,created_by) values(t,st.version+1,p_payload->>'mode',(p_payload->>'fixed_bps')::int,p_payload->'term_rates',coalesce((p_payload->>'prevent_negative_cash')::boolean,true),u) returning id into entity;
 else raise exception 'Неизвестная команда'; end if;
 result:=jsonb_build_object('id',entity,'ok',true);
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details) values(t,u,p_action,entity,case when p_action='application.transition' then p_payload else jsonb_build_object('operation_key',p_key) end);
 -- Preserve the original caller payload for retry equality.
 insert into public.operations(tenant_id,operation_key,action,payload,result,actor_id) values(t,p_key,p_action,incoming,result,u);
 return result;
end$$;
revoke all on function public.app_command(text,jsonb,uuid) from public;
grant execute on function public.app_command(text,jsonb,uuid) to authenticated;
revoke all on all functions in schema private from public;
