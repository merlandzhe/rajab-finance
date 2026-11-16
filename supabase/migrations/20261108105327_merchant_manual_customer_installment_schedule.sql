alter table public.applications add column if not exists manual_entry_key uuid;
create unique index if not exists applications_tenant_manual_entry_key_uniq on public.applications(tenant_id,manual_entry_key) where manual_entry_key is not null;
create or replace function public.create_manual_installment(
 p_key uuid,p_customer_name text,p_customer_phone text,p_product_name text,
 p_cost bigint,p_markup_bps integer,p_down bigint,p_months integer,
 p_first_due date,p_offline_signed boolean
) returns jsonb language plpgsql security definer
set search_path='' set "TimeZone"='Europe/Moscow'
as $$
declare
 u uuid:=auth.uid(); t uuid:=private.current_tenant(); role_name text:=private.current_role();
 cust uuid; app uuid; contract uuid; gain bigint; total bigint; rest bigint;
 each_amount bigint; installment bigint; seller text; snap jsonb; i integer;
 fullname text:=btrim(coalesce(p_customer_name,'')); item text:=btrim(coalesce(p_product_name,''));
 tel text:=btrim(coalesce(p_customer_phone,''));
begin
 if u is null or t is null or role_name not in ('owner','manager') then
   raise exception 'Доступ запрещён' using errcode='42501'; end if;
 if not private.company_enabled(t) then raise exception 'Доступ к компании приостановлен'; end if;
 if p_key is null then raise exception 'Отсутствует ключ операции'; end if;
 if length(fullname) not between 2 and 120 then raise exception 'Введите имя клиента'; end if;
 if length(item) not between 2 and 160 then raise exception 'Введите товар'; end if;
 if tel<>'' and tel!~'^\+?[0-9 ()-]{7,24}$' then raise exception 'Проверьте номер телефона'; end if;
 if p_cost is null or p_cost not between 100 and 100000000000 then raise exception 'Стоимость товара некорректна'; end if;
 if p_markup_bps is null or p_markup_bps not between 0 and 10000 then raise exception 'Наценка от 0 до 100 процентов'; end if;
 if p_months is null or p_months not between 1 and 36 then raise exception 'Срок от 1 до 36 месяцев'; end if;
 if p_first_due is null or p_first_due < current_date or p_first_due > (current_date+interval '5 years')::date then
   raise exception 'Проверьте дату первого платежа'; end if;
 if p_offline_signed is distinct from true then raise exception 'Требуется подтверждение подписания договора вне HESAP'; end if;

 gain:=round(p_cost::numeric*p_markup_bps/10000)::bigint;
 total:=p_cost+gain; rest:=total-p_down;
 if p_down is null or p_down<0 or rest<=0 then raise exception 'Первоначальный взнос слишком велик'; end if;
 each_amount:=rest/p_months;
 if each_amount<1 then raise exception 'Ежемесячный платёж слишком мал'; end if;

 perform 1 from public.organizations where id=t for update;
 select ct.id into contract from public.applications a join public.contracts ct
 on ct.tenant_id=a.tenant_id and ct.application_id=a.id
 where a.tenant_id=t and a.manual_entry_key=p_key;
 if contract is not null then return jsonb_build_object('ok',true,'id',contract,'already_created',true); end if;
 if exists(select 1 from public.applications where tenant_id=t and manual_entry_key=p_key) then
   raise exception 'Повторный ключ неоконченной операции'; end if;
 select name into seller from public.organizations where id=t;
 insert into public.customers(tenant_id,auth_user_id,name,phone,email,notes)
 values(t,null,fullname,tel,null,'Добавлен предпринимателем вручную')
 returning id into cust;
 snap:=jsonb_build_object('cost',p_cost::text,'profit',gain::text,'sale_price',total::text,
 'down_payment',p_down::text,'months',p_months,'monthly_payment',each_amount::text,
 'first_payment_on',p_first_due,'pricing_mode','individual','custom_markup_bps',p_markup_bps,
 'markup_percent',round(p_markup_bps::numeric/100,2),'contract_flow','merchant_manual_entry',
 'agreement_method','merchant_attested_offline_signature','signed_in_hesap',false,
 'seller_name',seller,'customer_name',fullname,'product_name',item,
 'manual_entry_key',p_key,'recorded_at',now());
 insert into public.applications(tenant_id,customer_id,product_name,product_url,supplier,
 estimated_cost,down_payment,months,notes,status,final_quote,created_by,manual_entry_key)
 values(t,cust,item,null,'',p_cost,p_down,p_months,'Внесено предпринимателем вручную',
 'contracted',snap,u,p_key) returning id into app;
 contract:=gen_random_uuid();
 insert into public.contracts(id,tenant_id,customer_id,application_id,purchase_id,number,
 signed_on,cost,profit,sale_price,down_payment,months,first_payment_on,created_by,status)
 values(contract,t,cust,app,null,'HM-'||to_char(current_date,'YY')||'-'||upper(left(contract::text,8)),
 current_date,p_cost,gain,total,p_down,p_months,p_first_due,u,'signed');
 insert into public.contract_items(tenant_id,contract_id,product_name,product_url,cost)
 values(t,contract,item,null,p_cost);
 insert into public.contract_versions(tenant_id,contract_id,snapshot) values(t,contract,snap);
 if p_down>0 then insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount)
 values(t,contract,0,current_date,p_down); end if;
 for i in 1..p_months loop
  installment:=case when i=p_months then rest-each_amount*(p_months-1) else each_amount end;
  insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount)
  values(t,contract,i,(p_first_due+make_interval(months=>i-1))::date,installment);
 end loop;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details)
 values(t,u,'contract.manual_create',contract,jsonb_build_object('customer_id',cust,
 'source','merchant','offline_signature_attested',true,'markup_bps',p_markup_bps));
 return jsonb_build_object('ok',true,'id',contract,'customer_id',cust,
 'application_id',app,'sale_price',total::text,'monthly_payment',each_amount::text);
end $$;
revoke all on function public.create_manual_installment(uuid,text,text,text,bigint,integer,bigint,integer,date,boolean) from public,anon;
grant execute on function public.create_manual_installment(uuid,text,text,text,bigint,integer,bigint,integer,date,boolean) to authenticated;
