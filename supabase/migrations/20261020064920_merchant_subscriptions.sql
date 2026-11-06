-- Additive HESAP merchant onboarding. Financial records are never rewritten.
alter table private.telegram_accounts add column username text;
alter table private.telegram_accounts add column bot_started_at timestamptz;
create table public.merchant_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id),
 name text not null check(length(name) between 2 and 120), shop_name text not null check(length(shop_name) between 2 and 120),
 city text not null check(length(city) between 2 and 120), phone text not null check(phone ~ '^\+[1-9][0-9]{9,14}$'),
 telegram_id bigint not null, username text, status text not null default 'new' check(status in ('new','review','approved','rejected','activated')),
 tenant_id uuid references public.organizations(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.merchant_requests enable row level security;
revoke all on public.merchant_requests from public,anon,authenticated;
grant select on public.merchant_requests to authenticated;
create policy merchant_request_read on public.merchant_requests for select to authenticated using(user_id=auth.uid() or private.platform_admin());
create table public.company_access (
 tenant_id uuid primary key references public.organizations(id), status text not null default 'active' check(status in ('pending','active','blocked')),
 expires_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.company_access enable row level security;
revoke all on public.company_access from public,anon,authenticated;
grant select on public.company_access to authenticated;
create policy company_access_read on public.company_access for select to authenticated using(private.platform_admin() or exists(select 1 from public.organization_members m where m.tenant_id=company_access.tenant_id and m.user_id=auth.uid()));
-- Existing companies retain access until the operator sets a subscription date.
insert into public.company_access(tenant_id) select id from public.organizations;
create table private.merchant_codes (
 id uuid primary key default gen_random_uuid(), token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 request_id uuid not null references public.merchant_requests(id), tenant_id uuid not null references public.organizations(id),
 user_id uuid not null references auth.users(id), issued_by uuid not null references auth.users(id),
 duration_days int not null check(duration_days between 1 and 3660), expires_at timestamptz not null,
 used_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
alter table private.merchant_codes enable row level security;
revoke all on private.merchant_codes from public,anon,authenticated,service_role;
create index merchant_codes_request on private.merchant_codes(request_id);
create function private.company_enabled(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.company_access where tenant_id=t and (status<>'active' or expires_at<=now()));
$$;
revoke all on function private.company_enabled(uuid) from public,anon;
grant execute on function private.company_enabled(uuid) to authenticated;
create or replace function private.current_tenant() returns uuid language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.organization_members where user_id=auth.uid() and active)
 then (select tenant_id from public.organization_members where user_id=auth.uid() and active and (role='client' or private.company_enabled(tenant_id)) limit 1)
 else (select active_tenant from public.buyer_profiles where user_id=auth.uid() and active) end;
$$;
create or replace function private.staff(t uuid,roles text[] default array['owner','manager','cashier']) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(t=private.current_tenant() and private.current_role()=any(roles) and private.company_enabled(t),false);
$$;
drop policy seller_directory_read on public.seller_directory;
create policy seller_directory_read on public.seller_directory for select to authenticated using((enabled and private.company_enabled(tenant_id)) or private.staff(tenant_id,array['owner']) or exists(select 1 from public.customers c where c.tenant_id=seller_directory.tenant_id and c.auth_user_id=auth.uid()));
alter table public.seller_directory add column whatsapp_phone text not null default '' check(whatsapp_phone='' or whatsapp_phone ~ '^[1-9][0-9]{9,14}$');
alter table public.seller_directory add column logo_data text not null default '' check(logo_data='' or (length(logo_data)<=120000 and logo_data ~ '^data:image/webp;base64,[A-Za-z0-9+/=]+$'));
create function public.save_shop(p_name text,p_whatsapp text,p_logo text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=private.current_tenant();
begin
 if auth.uid() is null or not private.staff(t,array['owner']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 or p_whatsapp is null or p_logo is null or p_enabled is null then raise exception 'Проверьте данные магазина'; end if;
 insert into public.seller_directory(tenant_id,display_name,whatsapp_phone,logo_data,enabled) values(t,trim(p_name),p_whatsapp,p_logo,p_enabled)
 on conflict(tenant_id) do update set display_name=excluded.display_name,whatsapp_phone=excluded.whatsapp_phone,logo_data=excluded.logo_data,enabled=excluded.enabled;
 update public.organizations set name=trim(p_name) where id=t;
end $$;
revoke all on function public.save_shop(text,text,text,boolean) from public,anon;
grant execute on function public.save_shop(text,text,text,boolean) to authenticated;
create or replace function public.buyer_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('profile',(select to_jsonb(b)-'phone_requested_at' from public.buyer_profiles b where user_id=auth.uid()),
 'sellers',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('enabled',d.enabled and private.company_enabled(d.tenant_id)) order by display_name) from public.seller_directory d
 where (d.enabled and private.company_enabled(d.tenant_id)) or exists(select 1 from public.customers c where c.tenant_id=d.tenant_id and c.auth_user_id=auth.uid())),'[]'));
end $$;
-- Block new intake for expired/blocked companies, retaining existing buyer history.
alter function public.portal_command(text,jsonb,uuid) rename to portal_command_before_access;
revoke all on function public.portal_command_before_access(text,jsonb,uuid) from public,anon,authenticated,service_role;
create function public.portal_command(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_action='portal.application' and not private.company_enabled(private.current_tenant()) then raise exception 'Приём заявок приостановлен'; end if;
 return public.portal_command_before_access(p_action,p_payload,p_key);
end $$;
revoke all on function public.portal_command(text,jsonb,uuid) from public,anon;
grant execute on function public.portal_command(text,jsonb,uuid) to authenticated;

-- Trusted server updates identity metadata only after HMAC verification.
create function public.telegram_identity_update(p_id bigint,p_user uuid,p_username text) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.telegram_accounts set username=case when p_username ~ '^[A-Za-z0-9_]{1,32}$' then p_username else null end where telegram_id=p_id and user_id=p_user;
 if not found then raise exception 'FORBIDDEN'; end if;
end $$;
revoke all on function public.telegram_identity_update(bigint,uuid,text) from public,anon,authenticated;
grant execute on function public.telegram_identity_update(bigint,uuid,text) to service_role;

-- Platform notices use the same durable queue, with a platform-only recipient predicate.
alter table private.telegram_deliveries alter column tenant_id drop not null;
create unique index platform_delivery_dedupe on private.telegram_deliveries(recipient,event_key) where tenant_id is null;
create or replace function private.notification_recipient_allowed(t uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case when t is null then exists(select 1 from public.profiles where id=u and platform_admin)
 else exists(select 1 from public.organization_members where tenant_id=t and user_id=u and active and private.company_enabled(t))
 or exists(select 1 from public.buyer_profiles b join public.customers c on c.auth_user_id=b.user_id where b.user_id=u and b.active and c.tenant_id=t) end;
$$;
create function public.merchant_request_submit(p_name text,p_shop text,p_city text,p_phone text) returns uuid language plpgsql security definer set search_path='' as $$
declare a private.telegram_accounts; rid uuid;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 select * into a from private.telegram_accounts where user_id=auth.uid();
 if not found then raise exception 'Сначала войдите через Telegram'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 select id into rid from public.merchant_requests where user_id=auth.uid();
 if found then return rid; end if;
 if exists(select 1 from public.organization_members where user_id=auth.uid()) or private.platform_admin() then raise exception 'Кабинет предпринимателя уже подключён'; end if;
 insert into public.merchant_requests(user_id,name,shop_name,city,phone,telegram_id,username)
 values(auth.uid(),trim(p_name),trim(p_shop),trim(p_city),p_phone,a.telegram_id,a.username) returning id into rid;
 insert into private.telegram_deliveries(recipient,event_key,message)
 select id,'merchant-request:'||rid,'Новая заявка предпринимателя в HESAP. Откройте панель владельца: https://rajab-finance-mini.vercel.app/mini'
 from public.profiles where platform_admin;
 return rid;
end $$;
revoke all on function public.merchant_request_submit(text,text,text,text) from public,anon;
grant execute on function public.merchant_request_submit(text,text,text,text) to authenticated;

create function public.platform_access_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from public.merchant_requests r),'[]'),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',coalesce(a.status,'active'),'expires_at',a.expires_at,
 'linked',exists(select 1 from public.organization_members m join private.telegram_accounts t on t.user_id=m.user_id where m.tenant_id=o.id and m.role='owner' and m.active))) from public.organizations o left join public.company_access a on a.tenant_id=o.id),'[]'),
 'codes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'expires_at',c.expires_at,'used_at',c.used_at,'revoked_at',c.revoked_at)) from private.merchant_codes c),'[]'),
 'delivery',jsonb_build_object('pending',(select count(*) from private.telegram_deliveries where status<>'sent' and attempts<8),'failed',(select count(*) from private.telegram_deliveries where status='failed' and attempts>=8)));
end $$;
create function public.platform_request_status(p_id uuid,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status not in ('review','rejected') or p_status is null then raise exception 'Некорректный статус'; end if;
 update public.merchant_requests set status=p_status,updated_at=now() where id=p_id and status in ('new','review','rejected');
 if not found then raise exception 'Заявка уже подключена'; end if;
end $$;
create function public.platform_issue_code(p_request uuid,p_hash text,p_days int) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.merchant_requests; t uuid; cid uuid; expiry timestamptz:=now()+interval '24 hours';
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_days is null or p_days not between 1 and 3660 then raise exception 'Проверьте срок доступа'; end if;
 select * into r from public.merchant_requests where id=p_request for update;
 if not found or r.status='activated' then raise exception 'Заявка уже активирована или не найдена'; end if;
 t:=r.tenant_id;
 if t is null then
  if exists(select 1 from public.organization_members where user_id=r.user_id) then raise exception 'Кабинет уже подключён'; end if;
  insert into public.organizations(name,slug) values(r.shop_name,'merchant-'||r.id) returning id into t;
  insert into public.company_access(tenant_id,status) values(t,'pending');
  insert into public.organization_settings(tenant_id,version,mode,fixed_bps,term_rates,created_by) values(t,1,'individual',0,'{}',auth.uid());
  insert into public.cash_accounts(tenant_id,name) values(t,'СБП'),(t,'Наличные');
  insert into public.seller_directory(tenant_id,display_name,enabled) values(t,r.shop_name,false);
 end if;
 update private.merchant_codes set revoked_at=now() where request_id=r.id and used_at is null and revoked_at is null;
 insert into private.merchant_codes(token_hash,request_id,tenant_id,user_id,issued_by,duration_days,expires_at)
 values(p_hash,r.id,t,r.user_id,auth.uid(),p_days,expiry) returning id into cid;
 update public.merchant_requests set status='approved',tenant_id=t,updated_at=now() where id=r.id;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,auth.uid(),'platform.code_issue',cid);
 return jsonb_build_object('id',cid,'tenant_id',t,'expires_at',expiry);
end $$;
create function public.merchant_activate(p_hash text) returns void language plpgsql security definer set search_path='' as $$
declare c private.merchant_codes;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 -- Same request-row lock as issue/revoke serializes all code lifecycle changes.
 perform 1 from public.merchant_requests r join private.merchant_codes x on x.request_id=r.id where x.token_hash=p_hash and x.user_id=auth.uid() for update of r;
 select * into c from private.merchant_codes where token_hash=p_hash and user_id=auth.uid() for update;
 if not found or c.used_at is not null or c.revoked_at is not null or c.expires_at<=now() then raise exception 'Код недействителен, истёк или уже использован'; end if;
 perform 1 from public.company_access where tenant_id=c.tenant_id for update;
 if exists(select 1 from public.company_access where tenant_id=c.tenant_id and status='blocked') then raise exception 'Компания заблокирована'; end if;
 if not exists(select 1 from private.telegram_accounts where user_id=auth.uid()) or exists(select 1 from public.organization_members where user_id=auth.uid()) then raise exception 'FORBIDDEN'; end if;
 insert into public.organization_members(tenant_id,user_id,role) values(c.tenant_id,auth.uid(),'owner');
 update public.company_access set status='active',expires_at=now()+make_interval(days=>c.duration_days),updated_at=now() where tenant_id=c.tenant_id;
 update private.merchant_codes set used_at=now() where id=c.id;
 update public.merchant_requests set status='activated',updated_at=now() where id=c.request_id;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(c.tenant_id,auth.uid(),'platform.code_activate',c.id);
end $$;
create function public.platform_revoke_code(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c private.merchant_codes;
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 perform 1 from public.merchant_requests r join private.merchant_codes x on x.request_id=r.id where x.id=p_id for update of r;
 update private.merchant_codes set revoked_at=now() where id=p_id and used_at is null returning * into c;
 if found then insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(c.tenant_id,auth.uid(),'platform.code_revoke',c.id); end if;
end $$;
create function public.platform_company_access(p_tenant uuid,p_status text,p_expires timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_status is null or p_status not in ('active','blocked') then raise exception 'Проверьте статус'; end if;
 insert into public.company_access(tenant_id,status,expires_at) values(p_tenant,p_status,p_expires)
 on conflict(tenant_id) do update set status=excluded.status,expires_at=excluded.expires_at,updated_at=now();
 if p_status='blocked' then
  update private.merchant_codes set revoked_at=now() where tenant_id=p_tenant and used_at is null;
  delete from private.telegram_invites where tenant_id=p_tenant and used_at is null;
 end if;
 insert into public.audit_logs(tenant_id,actor_id,action,details) values(p_tenant,auth.uid(),'platform.access',jsonb_build_object('status',p_status,'expires_at',p_expires));
end $$;
create function public.my_company_access() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('tenant_id',m.tenant_id,'name',o.name,'allowed',private.company_enabled(m.tenant_id),'status',coalesce(a.status,'active'),'expires_at',a.expires_at)
 from public.organization_members m join public.organizations o on o.id=m.tenant_id left join public.company_access a on a.tenant_id=m.tenant_id where m.user_id=auth.uid() and m.active limit 1;
$$;
revoke all on function public.platform_access_state(),public.platform_request_status(uuid,text),public.platform_issue_code(uuid,text,int),public.merchant_activate(text),public.platform_revoke_code(uuid),public.platform_company_access(uuid,text,timestamptz),public.my_company_access() from public,anon;
grant execute on function public.platform_access_state(),public.platform_request_status(uuid,text),public.platform_issue_code(uuid,text,int),public.merchant_activate(text),public.platform_revoke_code(uuid),public.platform_company_access(uuid,text,timestamptz),public.my_company_access() to authenticated;

-- A /start event lets previously unreachable recipients retry their durable queue.
create function public.telegram_bot_started(p_id bigint) returns void language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 update private.telegram_accounts set bot_started_at=now() where telegram_id=p_id returning user_id into u;
 update private.telegram_deliveries set status='pending',attempts=0,next_attempt_at=now() where recipient=u and status='failed';
end $$;
revoke all on function public.telegram_bot_started(bigint) from public,anon,authenticated;
grant execute on function public.telegram_bot_started(bigint) to service_role;

create function public.telegram_linked_user(p_id bigint) returns uuid language sql stable security definer set search_path='' as $$
 select user_id from private.telegram_accounts where telegram_id=p_id;
$$;
revoke all on function public.telegram_linked_user(bigint) from public,anon,authenticated;
grant execute on function public.telegram_linked_user(bigint) to service_role;
-- A buyer becoming a merchant retains their profile/history; buyer-only checks
-- must not gate their new staff operations.
do $$ declare body text; begin
 select pg_get_functiondef('public.portal_command_before_access(text,jsonb,uuid)'::regprocedure) into body;
 body:=replace(body,'if b.user_id is not null then','if b.user_id is not null and r=''client'' then');
 execute body;
end $$;
alter table private.telegram_deliveries add column last_error text;
create or replace function public.claim_buyer_notifications() returns table(id uuid,lease uuid,telegram_id bigint,message text)
language sql security definer set search_path='' as $$
 with picked as (
 select d.id from private.telegram_deliveries d join private.telegram_accounts a on a.user_id=d.recipient
 where d.attempts<8 and d.next_attempt_at<=now() and (d.status in ('pending','failed') or (d.status='sending' and d.locked_at<now()-interval '5 minutes'))
 and (d.expires_at is null or d.expires_at>now())
 and (d.schedule_id is null or exists(select 1 from public.payment_schedules ps where ps.id=d.schedule_id and ps.amount>coalesce((select sum(a.amount) from public.payment_allocations a where a.schedule_id=ps.id and a.tenant_id=ps.tenant_id),0)))
 and private.notification_recipient_allowed(d.tenant_id,d.recipient)
 order by d.created_at for update of d skip locked limit 5
 ), claimed as (
 update private.telegram_deliveries d set status='sending',locked_at=now(),lease=gen_random_uuid(),attempts=attempts+1
 from picked p where d.id=p.id returning d.*
 ) select d.id,d.lease,a.telegram_id,replace(d.message,'RAJAB FINANCE','HESAP') from claimed d join private.telegram_accounts a on a.user_id=d.recipient;
$$;
create function public.finish_delivery(p_id uuid,p_lease uuid,p_success boolean,p_error text,p_retry int) returns void language sql security definer set search_path='' as $$
 update private.telegram_deliveries set status=case when p_success then 'sent' else 'failed' end,
 sent_at=case when p_success then now() else null end,
 next_attempt_at=now()+make_interval(secs=>greatest(least(coalesce(p_retry,0),86400),least(21600,30*power(2,attempts)::int))),
 last_error=case when p_success then null else left(p_error,100) end,lease=null
 where id=p_id and lease=p_lease and status='sending';
$$;
revoke all on function public.finish_delivery(uuid,uuid,boolean,text,int) from public,anon,authenticated;
grant execute on function public.finish_delivery(uuid,uuid,boolean,text,int) to service_role;
create function public.platform_retry_delivery() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update private.telegram_deliveries set attempts=0,status='pending',next_attempt_at=now() where status='failed' and (expires_at is null or expires_at>now());
end $$;
revoke all on function public.platform_retry_delivery() from public,anon;
grant execute on function public.platform_retry_delivery() to authenticated;
create function public.platform_revoke_legacy(p_tenant uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 delete from private.telegram_invites where tenant_id=p_tenant and expected_role='owner' and used_at is null;
 insert into public.audit_logs(tenant_id,actor_id,action) values(p_tenant,auth.uid(),'platform.legacy_code_revoke');
end $$;
revoke all on function public.platform_revoke_legacy(uuid) from public,anon;
grant execute on function public.platform_revoke_legacy(uuid) to authenticated;
