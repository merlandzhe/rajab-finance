-- Direct merchant sale in instalments; legacy purchase records remain untouched.
alter table public.contracts alter column purchase_id drop not null;
alter table public.contracts drop constraint contracts_status_check;
alter table public.contracts
  add constraint contracts_status_check
  check (status = any(array['awaiting_acceptance','signed','transferred','closed']));
alter table public.contracts add column if not exists accepted_at timestamptz;

create or replace function private.hesap_application_quote()
returns trigger language plpgsql security invoker
set search_path='' set "TimeZone"='Europe/Moscow'
as $$
declare s public.organization_settings; gain bigint; price bigint; firstday date; monthly bigint;
begin
 if new.final_quote is not null then return new; end if;
 select * into s from public.organization_settings
  where tenant_id=new.tenant_id order by version desc limit 1;
 if not found or s.mode='individual' then return new; end if;
 gain:=private.profit(new.estimated_cost,new.months,s.mode,s.fixed_bps,s.term_rates,null,null);
 price:=new.estimated_cost+gain;
 if new.down_payment>=price then raise exception 'Первоначальный взнос должен быть меньше цены рассрочки'; end if;
 firstday:=(current_date+interval '1 month')::date;
 monthly:=(price-new.down_payment)/new.months;
 new.final_quote:=jsonb_build_object(
   'cost',new.estimated_cost::text,'profit',gain::text,'sale_price',price::text,
   'down_payment',new.down_payment::text,'months',new.months,
   'monthly_payment',monthly::text,'first_payment_on',firstday,
   'settings_version',s.version,'pricing_mode',s.mode,'quoted_at',now()
 );
 return new;
end $$;
revoke all on function private.hesap_application_quote() from public,anon,authenticated;
create trigger direct_installment_quote before insert on public.applications
for each row execute function private.hesap_application_quote();

create or replace function public.approve_direct_installment(p_id uuid, p_available boolean)
returns jsonb language plpgsql security definer
set search_path='' set "TimeZone"='Europe/Moscow'
as $$
declare
  t uuid:=private.current_tenant();
  u uuid:=auth.uid();
  r text:=private.current_role();
  a public.applications;
  st public.organization_settings;
  v_id uuid;
  v_cost bigint;
  v_profit bigint;
  v_price bigint;
  v_down bigint;
  v_months integer;
  v_first date;
  v_remaining bigint;
  v_each bigint;
  v_amount bigint;
  v_snapshot jsonb;
  i integer;
begin
 if u is null or t is null or r not in ('owner','manager') then
   raise exception 'Доступ запрещён' using errcode='42501';
 end if;
 if p_available is distinct from true then
   raise exception 'Подтвердите, что товар доступен для продажи';
 end if;
 if not private.company_enabled(t) then
   raise exception 'Доступ компании приостановлен';
 end if;
 -- Lock the request so duplicate clicks never create duplicate contracts.
 select * into a from public.applications
   where id=p_id and tenant_id=t for update;
 if not found then raise exception 'Заявка не найдена'; end if;
 if a.status='contracted' then
   select id into v_id from public.contracts
      where tenant_id=t and application_id=a.id;
   if v_id is not null then return jsonb_build_object('id',v_id,'ok',true,'already_created',true); end if;
 end if;
 if a.status not in ('draft','review','clarification','approved','awaiting_purchase','purchased','ready_to_sell') then
   raise exception 'Недопустимый статус заявки для одобрения';
 end if;
 if exists(select 1 from public.contracts where tenant_id=t and application_id=a.id) then
   raise exception 'Для заявки уже существует договор';
 end if;
 select * into st from public.organization_settings
    where tenant_id=t order by version desc limit 1;
 if not found then raise exception 'Тариф предпринимателя не настроен'; end if;

 v_cost:=a.estimated_cost;
 v_down:=a.down_payment;
 v_months:=a.months;
 if v_cost<=0 or v_months not between 1 and 36 then
   raise exception 'Некорректные условия заявки';
 end if;
 if a.final_quote ? 'quoted_at' then
   v_profit:=(a.final_quote->>'profit')::bigint;
   v_price:=(a.final_quote->>'sale_price')::bigint;
   v_first:=(a.final_quote->>'first_payment_on')::date;
 else
   if st.mode='individual' then
     raise exception 'Для быстрого оформления установите фиксированную наценку в настройках магазина';
   end if;
   v_profit:=private.profit(v_cost,v_months,st.mode,st.fixed_bps,st.term_rates,null,null);
   v_price:=v_cost+v_profit;
   v_first:=(current_date+interval '1 month')::date;
 end if;
 if v_first<=current_date then v_first:=(current_date+interval '1 month')::date; end if;
 if v_price <> v_cost+v_profit or v_down<0 or v_down>=v_price then
   raise exception 'Проверьте цену, наценку и первоначальный взнос';
 end if;
 v_remaining:=v_price-v_down;
 v_each:=v_remaining/v_months;
 if v_each<=0 then raise exception 'Сумма ежемесячного платежа слишком мала'; end if;
 v_snapshot:=jsonb_build_object(
   'cost',v_cost::text,'profit',v_profit::text,'sale_price',v_price::text,
   'down_payment',v_down::text,'months',v_months,
   'first_payment_on',v_first,'monthly_payment',v_each::text,
   'settings_version',coalesce(a.final_quote->'settings_version',to_jsonb(st.version)),
   'pricing_mode',coalesce(a.final_quote->'pricing_mode',to_jsonb(st.mode)),
   'contract_flow','direct_instalment','approved_at',now(),
   'product_name',a.product_name,'product_url',a.product_url,
   'customer_name',(select name from public.customers where id=a.customer_id and tenant_id=t),
   'seller_name',(select name from public.organizations where id=t),
   'template_version',2,'legal_notice','Требует подтверждения покупателем и проверки договора сторонами'
 );
 v_id:=gen_random_uuid();
 insert into public.contracts(
   id,tenant_id,customer_id,application_id,purchase_id,
   number,signed_on,cost,profit,sale_price,down_payment,months,first_payment_on,created_by,status)
 values(v_id,t,a.customer_id,a.id,null,
   'HE-'||to_char(current_date,'YY')||'-'||upper(left(v_id::text,8)),
   current_date,v_cost,v_profit,v_price,v_down,v_months,v_first,u,'awaiting_acceptance');
 insert into public.contract_items(tenant_id,contract_id,product_name,product_url,cost)
 values(t,v_id,a.product_name,a.product_url,v_cost);
 insert into public.contract_versions(tenant_id,contract_id,snapshot)
 values(t,v_id,v_snapshot);
 if v_down>0 then
   insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount)
   values(t,v_id,0,current_date,v_down);
 end if;
 for i in 1..v_months loop
   v_amount:=case when i=v_months then v_remaining-v_each*(v_months-1) else v_each end;
   insert into public.payment_schedules(tenant_id,contract_id,sequence,due_on,amount)
   values(t,v_id,i,(v_first+make_interval(months=>i-1))::date,v_amount);
 end loop;
 update public.applications set status='contracted',final_quote=v_snapshot
 where tenant_id=t and id=a.id;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details)
 values(t,u,'application.approve_direct',a.id,jsonb_build_object('contract_id',v_id,'total',v_price,'monthly',v_each));
 return jsonb_build_object('id',v_id,'ok',true,'awaiting_buyer_acceptance',true);
end $$;
revoke all on function public.approve_direct_installment(uuid,boolean) from public,anon;
grant execute on function public.approve_direct_installment(uuid,boolean) to authenticated;

create or replace function public.accept_direct_installment(p_id uuid, p_confirmed boolean)
returns jsonb language plpgsql security definer
set search_path='' set "TimeZone"='Europe/Moscow'
as $$
declare u uuid:=auth.uid(); c public.contracts;
begin
 if u is null or p_confirmed is distinct from true then
   raise exception 'Подтвердите согласие с условиями договора';
 end if;
 select ct.* into c from public.contracts ct
 join public.customers x on x.tenant_id=ct.tenant_id and x.id=ct.customer_id
 where ct.id=p_id and x.auth_user_id=u and ct.status in ('awaiting_acceptance','signed')
 for update of ct;
 if not found then raise exception 'Договор недоступен'; end if;
 if c.status='awaiting_acceptance' then
   update public.contracts set status='signed',accepted_at=now() where id=c.id and status='awaiting_acceptance';
   insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details)
   values(c.tenant_id,u,'contract.buyer_accept',c.id,jsonb_build_object('accepted_at',now(),'method','authenticated_account_confirmation'));
 end if;
 return jsonb_build_object('ok',true,'id',c.id);
end $$;
revoke all on function public.accept_direct_installment(uuid,boolean) from public,anon;
grant execute on function public.accept_direct_installment(uuid,boolean) to authenticated;
