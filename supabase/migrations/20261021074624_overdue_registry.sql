-- Manual reports only. Private tables are not exposed through the Data API.
create table private.overdue_reports (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
 contract_id uuid not null, customer_id uuid not null, subject_user uuid references auth.users(id),
 phone text not null check(phone ~ '^7[0-9]{10}$'), customer_name text not null,
 cutoff date not null, reported_amount bigint not null check(reported_amount>0),
 basis_reference text not null check(length(basis_reference) between 5 and 200),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 withdrawn_at timestamptz, withdrawal_reason text, disputed_at timestamptz, dispute_reason text,
 foreign key(tenant_id,contract_id) references public.contracts(tenant_id,id),
 foreign key(tenant_id,customer_id) references public.customers(tenant_id,id)
);
create unique index overdue_report_live_contract on private.overdue_reports(contract_id) where withdrawn_at is null;
create index overdue_report_phone on private.overdue_reports(phone);
create table private.overdue_audit (
 id bigint generated always as identity primary key, actor uuid not null references auth.users(id),
 report_id uuid references private.overdue_reports(id), action text not null,
 created_at timestamptz not null default now()
);
alter table private.overdue_reports enable row level security;
alter table private.overdue_audit enable row level security;
revoke all on private.overdue_reports,private.overdue_audit from public,anon,authenticated,service_role;

create function private.registry_phone(p text) returns text language sql immutable set search_path='' as $$
 select case when left(n,1)='8' and length(n)=11 then '7'||substr(n,2) else n end
 from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') n) x;
$$;
create function private.registry_balance(c uuid, cutoff date) returns table(amount bigint, oldest date)
language sql stable security definer set search_path='' as $$
 select coalesce(sum(x.remaining),0)::bigint,min(x.due_on) from (
 select p.due_on,greatest(0,p.amount-coalesce((select sum(a.amount) from public.payment_allocations a where a.schedule_id=p.id and a.tenant_id=p.tenant_id),0))::bigint remaining
 from public.payment_schedules p join public.contracts k on k.id=p.contract_id and k.tenant_id=p.tenant_id
 where p.contract_id=c and p.due_on<=cutoff and k.status in ('signed','transferred')
 ) x where x.remaining>0;
$$;

create function public.overdue_registry_add(p_contract uuid,p_basis text,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare c public.contracts; u public.customers; b record; rid uuid;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into c from public.contracts where id=p_contract for update;
 if not found or not private.staff(c.tenant_id,array['owner']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_confirm is distinct from true or length(trim(coalesce(p_basis,''))) not between 5 and 200 then raise exception 'Укажите основание передачи данных и подтвердите сведения'; end if;
 select * into u from public.customers where tenant_id=c.tenant_id and id=c.customer_id;
 if private.registry_phone(u.phone) !~ '^7[0-9]{10}$' then raise exception 'Укажите корректный телефон клиента в карточке'; end if;
 select * into b from private.registry_balance(c.id,current_date-1);
 if b.amount<=0 then raise exception 'По договору нет подтверждённой просрочки'; end if;
 if exists(select 1 from public.payment_claims where contract_id=c.id and status='pending') then raise exception 'Сначала проверьте сообщения клиента об оплате'; end if;
 select id into rid from private.overdue_reports where contract_id=c.id and withdrawn_at is null;
 if found then return rid; end if;
 insert into private.overdue_reports(tenant_id,contract_id,customer_id,subject_user,phone,customer_name,cutoff,reported_amount,basis_reference,created_by)
 values(c.tenant_id,c.id,u.id,u.auth_user_id,private.registry_phone(u.phone),u.name,current_date-1,b.amount,trim(p_basis),auth.uid()) returning id into rid;
 insert into private.overdue_audit(actor,report_id,action) values(auth.uid(),rid,'add');
 perform private.notify_user(c.tenant_id,u.auth_user_id,'registry-add:'||rid,'Продавец добавил запись о просрочке в общий реестр HESAP. Откройте Профиль → Реестр просрочек: там можно проверить сведения и оспорить запись.');
 return rid;
end $$;

create function public.overdue_registry_state(p_phone text default null) returns jsonb
language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare v_phone text; owner_access boolean; result jsonb;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 owner_access:=private.staff(private.current_tenant(),array['owner']);
 if p_phone is not null then
  if not owner_access then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  v_phone:=private.registry_phone(p_phone);
  if v_phone !~ '^7[0-9]{10}$' then raise exception 'Введите полный номер телефона'; end if;
  if not public.consume_rate_limit('registry-search:'||auth.uid(),30,86400) then raise exception 'RATE_LIMIT'; end if;
  insert into private.overdue_audit(actor,action) values(auth.uid(),'search');
 end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]') into result from (
 select r.created_at,jsonb_build_object('id',r.id,'company',o.name,
 'name',case when p_phone is null then r.customer_name else left(r.customer_name,1)||'…' end,
 'phone',case when p_phone is null then '+'||r.phone else null end,
 'amount',b.amount::text,'reported_amount',r.reported_amount::text,
 'days',case when b.oldest is null then 0 else current_date-b.oldest end,
 'status',case when r.withdrawn_at is not null then 'withdrawn' when b.amount=0 then 'resolved' when r.disputed_at is not null then 'disputed' else 'overdue' end,
 'disputed',r.disputed_at is not null,'created_at',r.created_at,
 'own',owner_access and r.tenant_id=private.current_tenant(),
 'can_withdraw',p_phone is null and (private.platform_admin() or (owner_access and r.tenant_id=private.current_tenant())) and r.withdrawn_at is null,
 'can_dispute',r.subject_user=auth.uid() and r.disputed_at is null and r.withdrawn_at is null,
 'dispute_reason',case when p_phone is null then r.dispute_reason else null end,
 'basis_reference',case when p_phone is null and (private.platform_admin() or (owner_access and r.tenant_id=private.current_tenant())) then r.basis_reference else null end,
 'withdrawal_reason',case when p_phone is null then r.withdrawal_reason else null end) item
 from private.overdue_reports r join public.organizations o on o.id=r.tenant_id
 cross join lateral private.registry_balance(r.contract_id,r.cutoff) b
 where (p_phone is not null and r.phone=v_phone and r.withdrawn_at is null)
 or (p_phone is null and (private.platform_admin() or r.subject_user=auth.uid() or (owner_access and r.tenant_id=private.current_tenant())))
 order by r.created_at desc limit 100
 ) x;
 return result;
end $$;

create function public.overdue_registry_change(p_id uuid,p_action text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.overdue_reports;
begin
 if auth.uid() is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 select * into r from private.overdue_reports where id=p_id for update;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Укажите причину (5–500 символов)'; end if;
 if p_action='withdraw' then
  if not (private.platform_admin() or private.staff(r.tenant_id,array['owner'])) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if r.withdrawn_at is not null then return; end if;
  update private.overdue_reports set withdrawn_at=now(),withdrawal_reason=trim(p_reason) where id=p_id;
  perform private.notify_user(r.tenant_id,r.subject_user,'registry-withdraw:'||r.id,'Запись о просрочке отозвана продавцом или владельцем HESAP и исключена из общего поиска.');
 elsif p_action='dispute' then
  if r.subject_user is distinct from auth.uid() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if r.disputed_at is not null or r.withdrawn_at is not null then return; end if;
  update private.overdue_reports set disputed_at=now(),dispute_reason=trim(p_reason) where id=p_id;
  perform private.notify_owners(r.tenant_id,'registry-dispute:'||r.id,'Клиент оспорил запись в реестре просрочек HESAP. Проверьте сведения в разделе «Реестр просрочек».');
  insert into private.telegram_deliveries(tenant_id,recipient,event_key,message)
  select null,id,'registry-dispute:'||r.id,'Клиент оспорил запись в реестре просрочек. Проверьте её в панели HESAP.' from public.profiles where platform_admin
  on conflict do nothing;
 else raise exception 'Недопустимое действие'; end if;
 insert into private.overdue_audit(actor,report_id,action) values(auth.uid(),p_id,p_action);
end $$;
revoke all on function private.registry_phone(text),private.registry_balance(uuid,date) from public,anon,authenticated,service_role;
revoke all on function public.overdue_registry_add(uuid,text,boolean),public.overdue_registry_state(text),public.overdue_registry_change(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.overdue_registry_add(uuid,text,boolean),public.overdue_registry_state(text),public.overdue_registry_change(uuid,text,text) to authenticated;
