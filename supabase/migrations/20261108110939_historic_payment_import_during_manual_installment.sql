create or replace function public.create_manual_installment_with_history(
 p_key uuid,p_customer_name text,p_customer_phone text,p_product_name text,
 p_cost bigint,p_markup_bps integer,p_down bigint,p_months integer,
 p_first_due date,p_signed_on date,p_offline_signed boolean,
 p_paid_steps integer[],p_paid_down boolean,p_paid_method text
) returns jsonb language plpgsql security definer
set search_path='' set "TimeZone"='Europe/Moscow'
as $$
declare
 u uuid:=auth.uid(); t uuid:=private.current_tenant(); staff_role text:=private.current_role();
 cust uuid; app uuid; ct uuid; gain bigint; total bigint; debt bigint;
 each_amount bigint; installment bigint; seller text; snap jsonb;
 fullname text:=btrim(coalesce(p_customer_name,'')); item text:=btrim(coalesce(p_product_name,''));
 tel text:=btrim(coalesce(p_customer_phone,'')); method_name text:=btrim(coalesce(p_paid_method,''));
 cash_account uuid; schedule_id uuid; payment_id uuid; step integer;
 seen integer[]:='{}'::integer[]; paid_total bigint:=0; payments_count integer:=0;
 i integer;
begin
 if u is null or t is null or staff_role not in ('owner','manager') then
   raise exception 'Доступ запрещён' using errcode='42501'; end if;
 if not private.company_enabled(t) then raise exception 'Доступ к компании приостановлен'; end if;
 if p_key is null then raise exception 'Отсутствует ключ операции'; end if;
 if length(fullname) not between 2 and 120 then raise exception 'Введите имя клиента'; end if;
 if length(item) not between 2 and 160 then raise exception 'Введите товар'; end if;
 if tel<>'' and tel!~'^\+?[0-9 ()-]{7,24}$' then raise exception 'Проверьте телефон клиента'; end if;
 if p_cost is null or p_cost not between 100 and 100000000000 then raise exception 'Стоимость товара некорректна'; end if;
 if p_markup_bps is null or p_markup_bps not between 0 and 10000 then raise exception 'Наценка от 0 до 100 процентов'; end if;
 if p_months is null or p_months not between 1 and 36 then raise exception 'Срок от 1 до 36 месяцев'; end if;
 if p_signed_on is null or p_signed_on > current_date or p_signed_on < (current_date-interval '5 years')::date then
   raise exception 'Проверьте дату продажи'; end if;
 if p_first_due is null or p_first_due < p_signed_on or
   p_first_due > (current_date+interval '5 years')::date then
   raise exception 'Дата первого платежа не может быть раньше продажи'; end if;
 if p_offline_signed is distinct from true then
   raise exception 'Требуется подтверждение согласования сделки вне HESAP'; end if;
 if method_name not in ('Наличные','СБП') then raise exception 'Выберите способ прошлых оплат'; end if;
 foreach step in array coalesce(p_paid_steps,'{}'::integer[]) loop
  if step is null or step not between 1 and p_months or step=any(seen) then
    raise exception 'Некорректный или повторяющийся номер оплаченного месяца'; end if;
  seen:=array_append(seen,step);
 end loop;
 gain:=round(p_cost::numeric*p_markup_bps/10000)::bigint;
 total:=p_cost+gain;
 if p_down is null or p_down<0 or p_down>=total then raise exception 'Первоначальный взнос слишком велик'; end if;
 debt:=total-p_down; each_amount:=debt/p_months;
 if each_amount<1 then raise exception 'Ежемесячный платёж слишком мал'; end if;
 if (p_paid_down or cardinality(seen)>0) then
   select ca.id into cash_account from public.cash_accounts ca
     where ca.tenant_id=t and ca.name=method_name order by ca.id limit 1;
   if cash_account is null then raise exception 'Выбранный способ оплаты не настроен в магазине'; end if;
 end if;
 perform 1 from public.organizations where id=t for update;
 select c.id into ct from public.applications a
  join public.contracts c on c.tenant_id=a.tenant_id and c.application_id=a.id
  where a.tenant_id=t and a.manual_entry_key=p_key;
 if ct is not null then
   return jsonb_build_object('ok',true,'id',ct,'already_created',true,
    'historical_paid',(select coalesce(sum(amount),0) from public.payments where contract_id=ct and tenant_id=t),
    'balance',(select sale_price-coalesce((select sum(amount) from public.payments where tenant_id=t and contract_id=ct),0) from public.contracts where id=ct));
 end if;
 if exists(select 1 from public.applications where tenant_id=t and manual_entry_key=p_key) then
   raise exception 'Повторный ключ неоконченной операции'; end if;
 select name into seller from public.organizations where id=t;
 insert into public.customers(tenant_id,auth_user_id,name,phone,email,notes)
 values(t,null,fullname,tel,null,'Добавлен предпринимателем при переносе продажи')
 returning id into cust;
 snap:=jsonb_build_object('cost',p_cost::text,'profit',gain::text,'sale_price',total::text,
 'down_payment',p_down::text,'months',p_months,'monthly_payment',each_amount::text,
 'first_payment_on',p_first_due,'pricing_mode','individual','custom_markup_bps',p_markup_bps,
 'markup_percent',round(p_markup_bps::numeric/100,2),'contract_flow','merchant_manual_entry',
 'agreement_method','merchant_attested_offline_signature','signed_in_hesap',false,
 'seller_name',seller,'customer_name',fullname,'product_name',item,
 'manual_entry_key',p_key,'signed_on',p_signed_on,'recorded_at',now(),
 'past_paid_entries',seen,'past_down_paid',p_paid_down,
 'past_payment_recorded_on',current_date,'past_payment_actual_date_known',false);
 insert into public.applications(tenant_id,customer_id,product_name,product_url,supplier,
 estimated_cost,down_payment,months,notes,status,final_quote,created_by,manual_entry_key)
 values(t,cust,item,null,'',p_cost,p_down,p_months,'Ручная запись ранее оформленной продажи',
 'contracted',snap,u,p_key) returning id into app;
 ct:=gen_random_uuid();
 insert into public.contracts(id,tenant_id,customer_id,application_id,purchase_id,number,
 signed_on,cost,profit,sale_price,down_payment,months,first_payment_on,created_by,status,transferred_on)
 values(ct,t,cust,app,null,'HM-'||to_char(current_date,'YY')||'-'||upper(left(ct::text,8)),
 p_signed_on,p_cost,gain,total,p_down,p_months,p_first_due,u,'transferred',p_signed_on);
 insert into public.contract_items(tenant_id,contract_id,product_name,product_url,cost)
 values(t,ct,item,null,p_cost);
 insert into public.contract_versions(tenant_id,contract_id,snapshot) values(t,ct,snap);
 if p_down>0 then
   insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount)
   values(t,ct,0,p_signed_on,p_down) returning id into schedule_id;
   if p_paid_down then
     payment_id:=gen_random_uuid();
     insert into public.payments(tenant_id,contract_id,cash_account_id,amount,
       reason,operation_key,paid_on,created_by)
     values(t,ct,cash_account,p_down,
       'Историческая оплата первоначального взноса: дата фактического поступления не указана; внесено при переносе',
       gen_random_uuid(),current_date,u) returning id into payment_id;
     insert into public.payment_allocations(tenant_id,payment_id,schedule_id,amount)
     values(t,payment_id,schedule_id,p_down);
     paid_total:=paid_total+p_down;payments_count:=payments_count+1;
   end if;
 end if;
 for i in 1..p_months loop
   installment:=case when i=p_months then debt-each_amount*(p_months-1) else each_amount end;
   insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount)
   values(t,ct,i,(p_first_due+make_interval(months=>i-1))::date,installment)
   returning id into schedule_id;
   if i=any(seen) then
     payment_id:=gen_random_uuid();
     insert into public.payments(tenant_id,contract_id,cash_account_id,amount,
       reason,operation_key,paid_on,created_by)
     values(t,ct,cash_account,installment,
       'Историческая оплата месяца '||i||': фактическая дата неизвестна; внесено при переносе',
       gen_random_uuid(),current_date,u) returning id into payment_id;
     insert into public.payment_allocations(tenant_id,payment_id,schedule_id,amount)
     values(t,payment_id,schedule_id,installment);
     paid_total:=paid_total+installment;payments_count:=payments_count+1;
   end if;
 end loop;
 -- No cash_transactions here: importing old receipts must not double-count current cash.
 if paid_total=total then
   update public.contracts set status='closed' where id=ct;
 end if;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details)
 values(t,u,'contract.manual_create_with_history',ct,
   jsonb_build_object('customer_id',cust,'source','merchant',
     'offline_signature_attested',true,'previous_paid_steps',seen,
     'previous_down_paid',p_paid_down,'payments_imported',payments_count,
     'previous_total',paid_total,'cash_ledger_unaffected',true,'actual_payment_dates_not_verified',true));
 return jsonb_build_object('ok',true,'id',ct,'customer_id',cust,'application_id',app,
   'sale_price',total::text,'historical_paid',paid_total::text,
   'balance',(total-paid_total)::text,'imported_payments',payments_count);
end $$;
revoke all on function public.create_manual_installment_with_history(uuid,text,text,text,bigint,integer,bigint,integer,date,date,boolean,integer[],boolean,text) from public,anon;
grant execute on function public.create_manual_installment_with_history(uuid,text,text,text,bigint,integer,bigint,integer,date,date,boolean,integer[],boolean,text) to authenticated;
