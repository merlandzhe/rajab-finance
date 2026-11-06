-- Client submissions never post money. Only owner/cashier confirmation posts a payment.
create table public.payment_claims (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.organizations(id),
 contract_id uuid not null, amount bigint not null check(amount>0 and amount<=100000000000),
 method text not null check(method in ('sbp','cash')),
 paid_on date not null, status text not null default 'pending' check(status in ('pending','confirmed','rejected')),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id), reviewed_at timestamptz, reason text not null default '', payment_id uuid,
 unique(tenant_id,id),
 foreign key(tenant_id,contract_id) references public.contracts(tenant_id,id),
 foreign key(tenant_id,payment_id) references public.payments(tenant_id,id)
);
create unique index one_pending_claim_per_contract on public.payment_claims(tenant_id,contract_id) where status='pending';
alter table public.payment_claims enable row level security;
revoke all on public.payment_claims from anon,authenticated;
grant select on public.payment_claims to authenticated;
grant all on public.payment_claims to service_role;
create policy claims_read on public.payment_claims for select to authenticated using(private.staff(tenant_id) or private.own_contract(tenant_id,contract_id));
create policy client_applications_read on public.applications for select to authenticated using(
 tenant_id=private.current_tenant() and private.current_role()='client' and exists(
 select 1 from public.customers c where c.id=customer_id and c.tenant_id=applications.tenant_id and c.auth_user_id=auth.uid()));

alter function public.app_state() rename to app_state_base;
create function public.app_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select public.app_state_base() || jsonb_build_object('payment_claims',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from public.payment_claims c),'[]'));
$$;
revoke all on function public.app_state() from public;
grant execute on function public.app_state() to authenticated;

-- Explicit role, ownership and tenant checks precede every privileged operation.
create function public.portal_command(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare
 t uuid:=private.current_tenant(); u uuid:=auth.uid(); r text:=private.current_role();
 cid uuid; entity uuid; result jsonb; op public.operations; claim public.payment_claims; contract public.contracts;
 amount bigint; remaining bigint; payment_result jsonb;
begin
 if u is null or t is null or r is null then raise exception 'Доступ запрещён' using errcode='42501'; end if;
 if p_action in ('portal.application','portal.claim') then
  if r<>'client' then raise exception 'Только для клиента' using errcode='42501'; end if;
 elsif p_action in ('portal.confirm','portal.reject') then
  if r not in ('owner','cashier') then raise exception 'Только для владельца или кассира' using errcode='42501'; end if;
 else raise exception 'Неизвестная операция'; end if;
 if p_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or length(p_payload::text)>20000 then raise exception 'Некорректная операция'; end if;
 perform 1 from public.organizations where id=t for update;
 select * into op from public.operations where tenant_id=t and operation_key=p_key;
 if found then
  if op.action<>p_action or op.payload<>p_payload or op.actor_id is distinct from u then raise exception 'Ключ уже использован'; end if;
  return op.result;
 end if;
 if p_action='portal.application' then
  select id into cid from public.customers where tenant_id=t and auth_user_id=u;
  if cid is null then raise exception 'Кабинет не связан с клиентом'; end if;
  if length(trim(coalesce(p_payload->>'product_name',''))) not between 2 and 160 then raise exception 'Укажите товар'; end if;
  if coalesce(p_payload->>'product_url','')<>'' and p_payload->>'product_url' !~ '^https?://' then raise exception 'Некорректная ссылка'; end if;
  if private.cents(p_payload->>'down_payment')>private.cents(p_payload->>'estimated_cost') then raise exception 'Взнос превышает стоимость'; end if;
  insert into public.applications(tenant_id,customer_id,product_name,product_url,estimated_cost,down_payment,months,notes,created_by)
   values(t,cid,trim(p_payload->>'product_name'),left(p_payload->>'product_url',1000),private.cents(p_payload->>'estimated_cost'),private.cents(p_payload->>'down_payment'),(p_payload->>'months')::int,left(coalesce(p_payload->>'notes',''),2000),u) returning id into entity;
  insert into public.notifications(tenant_id,kind,dedupe_key,message) values(t,'application','application:'||entity,'Новая заявка '||left(entity::text,8)||'. Подробности в CRM.');
 elsif p_action='portal.claim' then
  select * into contract from public.contracts where tenant_id=t and id=(p_payload->>'contract_id')::uuid;
  if not found or not private.own_contract(t,contract.id) then raise exception 'Договор недоступен' using errcode='42501'; end if;
  amount:=private.cents(p_payload->>'amount');
  remaining:=contract.sale_price-coalesce((select sum(p.amount) from public.payments p where p.tenant_id=t and p.contract_id=contract.id),0);
  if amount<=0 or amount>remaining then raise exception 'Сумма превышает остаток или равна нулю'; end if;
  if (p_payload->>'paid_on')::date<contract.signed_on or (p_payload->>'paid_on')::date>current_date then raise exception 'Некорректная дата'; end if;
  if exists(select 1 from public.payment_claims where tenant_id=t and contract_id=contract.id and status='pending') then raise exception 'Предыдущее сообщение ещё проверяется'; end if;
  insert into public.payment_claims(tenant_id,contract_id,amount,method,paid_on,created_by)
   values(t,contract.id,amount,p_payload->>'method',(p_payload->>'paid_on')::date,u) returning id into entity;
  insert into public.notifications(tenant_id,kind,dedupe_key,message) values(t,'payment_claim','claim:'||entity,'Клиент сообщил об оплате. Проверка '||left(entity::text,8)||' в CRM.');
 else
  select * into claim from public.payment_claims where tenant_id=t and id=(p_payload->>'id')::uuid for update;
  if not found or claim.status<>'pending' then raise exception 'Сообщение уже обработано или недоступно'; end if;
  entity:=claim.id;
  if p_action='portal.confirm' then
   -- Existing ledger command checks balance/date/account and allocates atomically.
   payment_result:=public.app_command('payment.record',jsonb_build_object('contract_id',claim.contract_id,'amount',claim.amount::text,'paid_on',claim.paid_on,'cash_account_id',p_payload->>'cash_account_id'),gen_random_uuid());
   update public.payment_claims set status='confirmed',payment_id=(payment_result->>'id')::uuid,reviewed_by=u,reviewed_at=now() where id=claim.id;
  else
   if length(trim(coalesce(p_payload->>'reason',''))) not between 5 and 1000 then raise exception 'Укажите причину отказа'; end if;
   update public.payment_claims set status='rejected',reason=trim(p_payload->>'reason'),reviewed_by=u,reviewed_at=now() where id=claim.id;
  end if;
 end if;
 result:=jsonb_build_object('id',entity,'ok',true);
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,u,p_action,entity);
 insert into public.operations(tenant_id,operation_key,action,payload,result,actor_id) values(t,p_key,p_action,p_payload,result,u);
 return result;
end$$;
revoke all on function public.portal_command(text,jsonb,uuid) from public,anon;
grant execute on function public.portal_command(text,jsonb,uuid) to authenticated;
