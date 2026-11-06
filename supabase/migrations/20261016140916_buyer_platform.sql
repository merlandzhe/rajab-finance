-- Additive upgrade of the existing CRM. Staff membership remains single-tenant.
-- Buyers have a separate, non-privileged identity and can select several sellers.
create table public.buyer_profiles (
 user_id uuid primary key references auth.users(id), name text not null default '', city text not null default '',
 phone text, phone_verified_at timestamptz, phone_requested_at timestamptz,
 consent_at timestamptz, consent_version text, active_tenant uuid references public.organizations(id),
 active boolean not null default true, created_at timestamptz not null default now()
);
alter table public.buyer_profiles enable row level security;
revoke all on public.buyer_profiles from anon,authenticated;
grant select on public.buyer_profiles to authenticated;
create policy buyer_self on public.buyer_profiles for select to authenticated using(user_id=auth.uid());
create table public.seller_directory (
 tenant_id uuid primary key references public.organizations(id), display_name text not null,
 enabled boolean not null default false
);
alter table public.seller_directory enable row level security;
revoke all on public.seller_directory from anon,authenticated;
grant select on public.seller_directory to authenticated;
create policy seller_directory_read on public.seller_directory for select to authenticated using(enabled or private.staff(tenant_id,array['owner']));
alter table public.customers drop constraint customers_auth_user_id_key;
alter table public.customers add constraint customers_tenant_auth_unique unique(tenant_id,auth_user_id);
alter table public.customers add column city text not null default '';

create or replace function private.current_tenant() returns uuid language sql stable security definer set search_path='' as $$
 select coalesce((select tenant_id from public.organization_members where user_id=auth.uid() and active limit 1),
 (select active_tenant from public.buyer_profiles where user_id=auth.uid() and active));
$$;
create or replace function private.current_role() returns text language sql stable security definer set search_path='' as $$
 select coalesce((select role from public.organization_members where user_id=auth.uid() and active limit 1),
 (select 'client' from public.buyer_profiles where user_id=auth.uid() and active));
$$;
-- Only server-provisioned accounts can be recovered after an interrupted signup.
create function public.telegram_signup_lookup(p_email text) returns uuid language sql stable security definer set search_path='' as $$
 select id from auth.users where email=p_email and raw_app_meta_data->>'rajab_telegram_buyer'='true';
$$;
create function public.telegram_register_buyer(p_telegram_id bigint,p_digest text,p_user uuid,p_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if p_telegram_id is null or p_telegram_id<=0 or p_telegram_id>9007199254740991 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'TELEGRAM_INVALID'; end if;
 perform pg_advisory_xact_lock(p_telegram_id);
 select user_id into existing from private.telegram_accounts where telegram_id=p_telegram_id;
 if existing is not null and existing<>p_user then raise exception 'TELEGRAM_ALREADY_LINKED'; end if;
 if not exists(select 1 from auth.users where id=p_user and email=p_email and raw_app_meta_data->>'rajab_telegram_buyer'='true')
 or exists(select 1 from public.organization_members where user_id=p_user)
 or exists(select 1 from public.profiles where id=p_user and platform_admin)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 insert into public.profiles(id,display_name) values(p_user,'Покупатель') on conflict(id) do nothing;
 insert into public.buyer_profiles(user_id) values(p_user) on conflict(user_id) do nothing;
 if not exists(select 1 from public.buyer_profiles where user_id=p_user and active) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 insert into private.telegram_accounts(telegram_id,user_id) values(p_telegram_id,p_user) on conflict(telegram_id) do nothing;
 if exists(select 1 from private.telegram_auth_replays where digest=p_digest) then raise exception 'TELEGRAM_REPLAY'; end if;
 insert into private.telegram_auth_replays(digest) values(p_digest);
 return p_user;
end $$;
revoke all on function public.telegram_signup_lookup(text),public.telegram_register_buyer(bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.telegram_signup_lookup(text),public.telegram_register_buyer(bigint,text,uuid,text) to service_role;

-- Wrapper keeps invitation verification unchanged, adds login for registered buyers.
alter function public.telegram_exchange(bigint,text,text) rename to telegram_exchange_invited;
revoke all on function public.telegram_exchange_invited(bigint,text,text) from service_role;
create function public.telegram_exchange(p_telegram_id bigint,p_digest text,p_invite_hash text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 if p_telegram_id is null or p_telegram_id<=0 or p_telegram_id>9007199254740991 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'TELEGRAM_INVALID'; end if;
 perform pg_advisory_xact_lock(p_telegram_id);
 select a.user_id into u from private.telegram_accounts a join public.buyer_profiles b on b.user_id=a.user_id where a.telegram_id=p_telegram_id and b.active;
 if u is null then return public.telegram_exchange_invited(p_telegram_id,p_digest,p_invite_hash); end if;
 delete from private.telegram_auth_replays where expires_at<now();
 if exists(select 1 from private.telegram_auth_replays where digest=p_digest) then raise exception 'TELEGRAM_REPLAY'; end if;
 insert into private.telegram_auth_replays(digest) values(p_digest);
 return u;
end $$;
revoke all on function public.telegram_exchange(bigint,text,text) from public,anon,authenticated;
grant execute on function public.telegram_exchange(bigint,text,text) to service_role;

create function public.buyer_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('profile',(select to_jsonb(b)-'phone_requested_at' from public.buyer_profiles b where user_id=auth.uid()),
 'sellers',coalesce((select jsonb_agg(to_jsonb(d) order by display_name) from public.seller_directory d),'[]'));
$$;
create function public.buyer_request_phone() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update public.buyer_profiles set phone_requested_at=now() where user_id=auth.uid() and active;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('ok',true);
end $$;
create table private.telegram_contact_updates(update_id bigint primary key, received_at timestamptz not null default now());
alter table private.telegram_contact_updates enable row level security;
revoke all on private.telegram_contact_updates from public,anon,authenticated,service_role;
create function public.telegram_verify_phone(p_telegram_id bigint,p_phone text,p_message_date bigint,p_update_id bigint) returns void
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 if p_phone is null or p_phone !~ '^\+7[0-9]{10}$' then return; end if;
 if to_timestamp(p_message_date)<now()-interval '15 minutes' or to_timestamp(p_message_date)>now()+interval '30 seconds' then return; end if;
 insert into private.telegram_contact_updates(update_id) values(p_update_id) on conflict do nothing;
 if not found then return; end if;
 select user_id into u from private.telegram_accounts where telegram_id=p_telegram_id;
 update public.buyer_profiles set phone=p_phone,phone_verified_at=now(),phone_requested_at=null
 where user_id=u and active and phone_requested_at>now()-interval '15 minutes'
 and to_timestamp(p_message_date)>=phone_requested_at-interval '5 seconds';
 if found then update public.customers set phone=p_phone where auth_user_id=u; end if;
 delete from private.telegram_contact_updates where received_at<now()-interval '2 days';
end $$;
revoke all on function public.telegram_verify_phone(bigint,text,bigint,bigint) from public,anon,authenticated;
grant execute on function public.telegram_verify_phone(bigint,text,bigint,bigint) to service_role;
create function public.buyer_profile_save(p_name text,p_city text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_consent is distinct from true or length(trim(coalesce(p_name,''))) not between 2 and 120 or length(trim(coalesce(p_city,''))) not between 2 and 120 then raise exception 'Заполните профиль и подтвердите согласие'; end if;
 update public.buyer_profiles set name=trim(p_name),city=trim(p_city),consent_at=now(),consent_version='buyer-v1'
 where user_id=auth.uid() and active and phone_verified_at is not null;
 if not found then raise exception 'Сначала подтвердите свой номер через Telegram'; end if;
 update public.profiles set display_name=trim(p_name) where id=auth.uid();
 update public.customers set name=trim(p_name),city=trim(p_city) where auth_user_id=auth.uid();
 return jsonb_build_object('ok',true);
end $$;
create function public.buyer_select(p_tenant uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.buyer_profiles;
begin
 select * into b from public.buyer_profiles where user_id=auth.uid() and active for update;
 if not found or b.phone_verified_at is null or b.consent_at is null then raise exception 'Сначала заполните профиль и подтвердите телефон'; end if;
 if exists(select 1 from public.organization_members where user_id=auth.uid()) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if not exists(select 1 from public.seller_directory where tenant_id=p_tenant and enabled)
 and not exists(select 1 from public.customers where tenant_id=p_tenant and auth_user_id=auth.uid()) then raise exception 'Предприниматель недоступен'; end if;
 insert into public.customers(tenant_id,auth_user_id,name,phone,city) values(p_tenant,auth.uid(),b.name,b.phone,b.city) on conflict(tenant_id,auth_user_id) do nothing;
 update public.buyer_profiles set active_tenant=p_tenant where user_id=auth.uid();
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.buyer_state(),public.buyer_request_phone(),public.buyer_profile_save(text,text,boolean),public.buyer_select(uuid) from public,anon;
grant execute on function public.buyer_state(),public.buyer_request_phone(),public.buyer_profile_save(text,text,boolean),public.buyer_select(uuid) to authenticated;

alter table public.applications drop constraint applications_status_check;
alter table public.applications add constraint applications_status_check check(status in ('draft','review','clarification','approved','rejected','awaiting_purchase','purchased','ready_to_sell','contracted'));
create table public.application_messages (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, application_id uuid not null,
 author_id uuid not null references auth.users(id), author_role text not null, message text not null check(length(message) between 2 and 2000),
 created_at timestamptz not null default now(), foreign key(tenant_id,application_id) references public.applications(tenant_id,id)
);
alter table public.application_messages enable row level security;
revoke all on public.application_messages from anon,authenticated;
grant select on public.application_messages to authenticated;
create policy application_messages_read on public.application_messages for select to authenticated using(exists(select 1 from public.applications a where a.id=application_id and a.tenant_id=application_messages.tenant_id));
alter table public.documents drop constraint documents_kind_check;
alter table public.documents add constraint documents_kind_check check(kind in ('purchase_receipt','ownership','transfer','product_photo'));
create policy buyer_photo_read on public.documents for select to authenticated using(kind='product_photo' and exists(select 1 from public.applications a where a.id=application_id and a.tenant_id=documents.tenant_id));
create policy buyer_photo_storage on storage.objects for select to authenticated using(bucket_id='deal-documents' and exists(select 1 from public.documents d where d.storage_path=name and d.kind='product_photo'));

alter function public.portal_command(text,jsonb,uuid) rename to portal_command_base;
revoke all on function public.portal_command_base(text,jsonb,uuid) from authenticated;
create function public.portal_command(p_action text,p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare t uuid; r text; u uuid:=auth.uid(); a public.applications; entity uuid; op public.operations; result jsonb; b public.buyer_profiles;
begin
 -- Selection and commands share a lock. Stale tabs must explicitly match tenant.
 select * into b from public.buyer_profiles where user_id=u for update;
 t:=private.current_tenant(); r:=private.current_role();
 if u is null or t is null or r is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if b.user_id is not null then
  if not b.active or b.phone_verified_at is null or b.consent_at is null then raise exception 'Завершите регистрацию'; end if;
  if p_payload->>'expected_tenant' is distinct from t::text then raise exception 'Предприниматель изменён. Обновите страницу'; end if;
 end if;
 p_payload:=p_payload-'expected_tenant';
 if p_action in ('portal.application','portal.claim','portal.confirm','portal.reject') then
  if p_action='portal.application' and b.user_id is not null and not exists(select 1 from public.seller_directory where tenant_id=t and enabled) then raise exception 'Приём заявок приостановлен'; end if;
  return public.portal_command_base(p_action,p_payload,p_key);
 end if;
 if p_key is null or p_payload is null or length(p_payload::text)>20000 then raise exception 'Некорректная операция'; end if;
 perform 1 from public.organizations where id=t for update;
 select * into op from public.operations where tenant_id=t and operation_key=p_key;
 if found then
  if op.action<>p_action or op.payload<>p_payload or op.actor_id is distinct from u then raise exception 'Ключ уже использован'; end if;
  return op.result;
 end if;
 if p_action='portal.directory' then
  if r<>'owner' then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if length(trim(coalesce(p_payload->>'display_name',''))) not between 2 and 120 then raise exception 'Укажите название'; end if;
  insert into public.seller_directory(tenant_id,display_name,enabled) values(t,trim(p_payload->>'display_name'),(p_payload->>'enabled')::boolean)
  on conflict(tenant_id) do update set display_name=excluded.display_name,enabled=excluded.enabled;
  entity:=t;
 elsif p_action in ('portal.clarify','portal.reply','portal.photo') then
  select * into a from public.applications where tenant_id=t and id=(p_payload->>'id')::uuid for update;
  if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if r='client' and not exists(select 1 from public.customers where id=a.customer_id and tenant_id=t and auth_user_id=u) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if p_action='portal.clarify' then
   if r not in ('owner','manager') or a.status not in ('review','clarification') then raise exception 'Недопустимый запрос уточнения'; end if;
   update public.applications set status='clarification' where id=a.id;
  elsif p_action='portal.reply' then
   if r<>'client' or a.status<>'clarification' then raise exception 'Ответ сейчас не требуется'; end if;
   update public.applications set status='review' where id=a.id;
  else
   if r<>'client' or a.status not in ('review','clarification') then raise exception 'Нельзя добавить фото'; end if;
   if p_payload->>'storage_path' not like t::text||'/'||a.id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='deal-documents' and name=p_payload->>'storage_path') then raise exception 'Файл не найден'; end if;
   if p_payload->>'mime_type' not in ('image/jpeg','image/png') then raise exception 'Нужно фото JPEG или PNG'; end if;
   if (select count(*) from public.documents where application_id=a.id and kind='product_photo')>=5 then raise exception 'Не более пяти фото'; end if;
   insert into public.documents(tenant_id,application_id,kind,name,storage_path,mime_type,size_bytes,sha256,created_by)
   values(t,a.id,'product_photo',left(p_payload->>'name',180),p_payload->>'storage_path',p_payload->>'mime_type',(p_payload->>'size_bytes')::int,p_payload->>'sha256',u) returning id into entity;
  end if;
  if p_action<>'portal.photo' then
   insert into public.application_messages(tenant_id,application_id,author_id,author_role,message) values(t,a.id,u,r,trim(p_payload->>'message')) returning id into entity;
  end if;
 else raise exception 'Неизвестная операция'; end if;
 result:=jsonb_build_object('id',entity,'ok',true);
 insert into public.operations(tenant_id,operation_key,action,payload,result,actor_id) values(t,p_key,p_action,p_payload,result,u);
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id) values(t,u,p_action,entity);
 return result;
end $$;
revoke all on function public.portal_command(text,jsonb,uuid) from public,anon;
grant execute on function public.portal_command(text,jsonb,uuid) to authenticated;
create or replace function public.app_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select public.app_state_base() || jsonb_build_object(
 'payment_claims',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from public.payment_claims c),'[]'),
 'application_messages',coalesce((select jsonb_agg(to_jsonb(m) order by created_at) from public.application_messages m),'[]'),
 'seller_directory',coalesce((select jsonb_agg(to_jsonb(d)) from public.seller_directory d),'[]'));
$$;

-- Transactional per-recipient outbox. No chat IDs or bearer tokens in public state.
create table private.telegram_deliveries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.organizations(id),
 recipient uuid not null references auth.users(id), event_key text not null, message text not null,
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts int not null default 0, next_attempt_at timestamptz not null default now(),
 lease uuid, locked_at timestamptz, sent_at timestamptz, schedule_id uuid references public.payment_schedules(id), expires_at timestamptz, created_at timestamptz not null default now(),
 unique(tenant_id,recipient,event_key)
);
alter table private.telegram_deliveries enable row level security;
revoke all on private.telegram_deliveries from public,anon,authenticated,service_role;
create index telegram_delivery_pending on private.telegram_deliveries(next_attempt_at) where status<>'sent';
create function private.notify_user(t uuid,u uuid,k text,m text) returns void language sql security definer set search_path='' as $$
 insert into private.telegram_deliveries(tenant_id,recipient,event_key,message) select t,u,k,m where u is not null
 on conflict(tenant_id,recipient,event_key) do nothing;
$$;
create function private.notify_owners(t uuid,k text,m text) returns void language sql security definer set search_path='' as $$
 insert into private.telegram_deliveries(tenant_id,recipient,event_key,message)
 select t,user_id,k,m from public.organization_members where tenant_id=t and active and role='owner'
 on conflict(tenant_id,recipient,event_key) do nothing;
$$;
create function private.application_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid; label text;
begin
 if tg_op='INSERT' then
  perform private.notify_owners(new.tenant_id,'application:'||new.id,'Новая заявка на рассрочку. Откройте заявки в RAJAB FINANCE.');
 elsif old.status is distinct from new.status then
  select auth_user_id into u from public.customers where id=new.customer_id and tenant_id=new.tenant_id;
  label:=case new.status when 'review' then 'На рассмотрении' when 'clarification' then 'Нужно уточнение' when 'approved' then 'Одобрена' when 'rejected' then 'Отклонена' when 'awaiting_purchase' then 'Ожидает закупки' when 'purchased' then 'Товар приобретён' when 'ready_to_sell' then 'Условия согласованы' when 'contracted' then 'Договор оформлен' else new.status end;
  perform private.notify_user(new.tenant_id,u,'status:'||gen_random_uuid(),'Статус вашей заявки: '||label||'. Подробности в кабинете RAJAB FINANCE.');
 end if;
 return new;
end $$;
create trigger application_telegram after insert or update on public.applications for each row execute function private.application_notice();
create function private.claim_notice() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  perform private.notify_owners(new.tenant_id,'claim:'||new.id,'Покупатель сообщил об оплате. Проверьте реальное поступление в CRM RAJAB FINANCE.');
 elsif old.status is distinct from new.status and new.status='rejected' then
  perform private.notify_user(new.tenant_id,new.created_by,'claim-rejected:'||new.id,'Сообщение об оплате отклонено. Причина указана в вашем кабинете.');
 end if;
 return new;
end $$;
create trigger claim_telegram after insert or update on public.payment_claims for each row execute function private.claim_notice();
create function private.payment_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 select x.auth_user_id into u from public.contracts c join public.customers x on x.tenant_id=c.tenant_id and x.id=c.customer_id where c.id=new.contract_id and c.tenant_id=new.tenant_id;
 perform private.notify_user(new.tenant_id,u,'payment:'||new.id,case when new.amount>0 then 'Поступление подтверждено. График и остаток обновлены в вашем кабинете.' else 'Поступление скорректировано продавцом. Проверьте историю и остаток в кабинете.' end);
 return new;
end $$;
create trigger payment_telegram after insert on public.payments for each row execute function private.payment_notice();
create function private.message_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
 if new.author_role='client' then
  perform private.notify_owners(new.tenant_id,'reply:'||new.id,'Покупатель ответил на запрос уточнения. Откройте заявку в CRM.');
 else
  select c.auth_user_id into u from public.applications a join public.customers c on c.id=a.customer_id and c.tenant_id=a.tenant_id where a.id=new.application_id;
  perform private.notify_user(new.tenant_id,u,'message:'||new.id,'Предприниматель задал вопрос по заявке. Ответьте в кабинете RAJAB FINANCE.');
 end if;
 return new;
end $$;
create trigger message_telegram after insert on public.application_messages for each row execute function private.message_notice();
revoke all on function private.notify_user(uuid,uuid,text,text),private.notify_owners(uuid,text,text),private.application_notice(),private.claim_notice(),private.payment_notice(),private.message_notice() from public,anon,authenticated,service_role;

create function public.queue_buyer_reminders() returns void language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare s record; d date:=current_date; k text; m text;
begin
 for s in
  select ps.*,c.auth_user_id from public.payment_schedules ps
  join public.contracts k on k.tenant_id=ps.tenant_id and k.id=ps.contract_id
  join public.customers c on c.tenant_id=k.tenant_id and c.id=k.customer_id
  where (ps.due_on=d+3 or ps.due_on<=d) and k.status in ('signed','transferred')
  and ps.amount>coalesce((select sum(a.amount) from public.payment_allocations a where a.tenant_id=ps.tenant_id and a.schedule_id=ps.id),0)
 loop
  k:='schedule:'||s.id||':'||d;
  m:=case when s.due_on<d then 'Есть просроченный платёж. Проверьте график и свяжитесь с предпринимателем.' when s.due_on=d then 'Сегодня дата платежа. Сумма и график доступны в вашем кабинете.' else 'Через 3 дня наступит дата платежа. Проверьте график в вашем кабинете.' end;
  perform private.notify_user(s.tenant_id,s.auth_user_id,k,m);
  if s.due_on<d then perform private.notify_owners(s.tenant_id,k,'Есть просроченные платежи. Откройте отчёт о задолженности RAJAB FINANCE.'); end if;
  update private.telegram_deliveries set schedule_id=s.id,expires_at=(d+1)::timestamp at time zone 'Europe/Moscow' where tenant_id=s.tenant_id and event_key=k;
 end loop;
end $$;
create function private.notification_recipient_allowed(t uuid,u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members where tenant_id=t and user_id=u and active)
 or exists(select 1 from public.buyer_profiles b join public.customers c on c.auth_user_id=b.user_id where b.user_id=u and b.active and c.tenant_id=t);
$$;
create function public.claim_buyer_notifications() returns table(id uuid,lease uuid,telegram_id bigint,message text)
language sql security definer set search_path='' as $$
 with picked as (
 select d.id from private.telegram_deliveries d join private.telegram_accounts a on a.user_id=d.recipient
 where d.attempts<5 and d.next_attempt_at<=now() and (d.status in ('pending','failed') or (d.status='sending' and d.locked_at<now()-interval '5 minutes'))
 and (d.expires_at is null or d.expires_at>now())
 and (d.schedule_id is null or exists(select 1 from public.payment_schedules ps where ps.id=d.schedule_id and ps.amount>coalesce((select sum(a.amount) from public.payment_allocations a where a.schedule_id=ps.id and a.tenant_id=ps.tenant_id),0)))
 and private.notification_recipient_allowed(d.tenant_id,d.recipient)
 order by d.created_at for update of d skip locked limit 5
 ), claimed as (
 update private.telegram_deliveries d set status='sending',locked_at=now(),lease=gen_random_uuid(),attempts=attempts+1
 from picked p where d.id=p.id returning d.*
 ) select d.id,d.lease,a.telegram_id,d.message from claimed d join private.telegram_accounts a on a.user_id=d.recipient;
$$;
create function public.finish_buyer_notification(p_id uuid,p_lease uuid,p_success boolean) returns void language sql security definer set search_path='' as $$
 update private.telegram_deliveries set status=case when p_success then 'sent' else 'failed' end,
 sent_at=case when p_success then now() else null end,next_attempt_at=now()+interval '1 minute'*power(2,attempts),lease=null
 where id=p_id and lease=p_lease and status='sending';
$$;
create function public.notification_health() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('linked',exists(select 1 from private.telegram_accounts where user_id=auth.uid()),
 'pending',count(*) filter(where status in ('pending','sending') or (status='failed' and attempts<5)),
 'failed',count(*) filter(where status='failed' and attempts>=5),'sent',count(*) filter(where status='sent'))
 from private.telegram_deliveries where tenant_id=private.current_tenant() and private.current_role()='owner' and (expires_at is null or expires_at>now());
$$;
revoke all on function public.queue_buyer_reminders(),private.notification_recipient_allowed(uuid,uuid),public.claim_buyer_notifications(),public.finish_buyer_notification(uuid,uuid,boolean),public.notification_health() from public,anon,authenticated;
grant execute on function public.queue_buyer_reminders(),public.claim_buyer_notifications(),public.finish_buyer_notification(uuid,uuid,boolean) to service_role;
grant execute on function public.notification_health() to authenticated;

create or replace function public.buyer_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 return jsonb_build_object('profile',(select to_jsonb(b)-'phone_requested_at' from public.buyer_profiles b where user_id=auth.uid()),
 'sellers',coalesce((select jsonb_agg(to_jsonb(d) order by display_name) from public.seller_directory d
 where d.enabled or exists(select 1 from public.customers c where c.tenant_id=d.tenant_id and c.auth_user_id=auth.uid())),'[]'));
end $$;

-- Existing ledger, idempotency and purchase safeguards retained verbatim.
create or replace function public.app_command(p_action text,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
   if not ((a.status='draft' and p_payload->>'status'='review') or (a.status in ('review','clarification') and p_payload->>'status' in ('approved','rejected')) or (a.status='approved' and p_payload->>'status'='awaiting_purchase')) then raise exception 'Недопустимый переход статуса'; end if;
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
alter function public.app_command(text,jsonb,uuid) set timezone='Europe/Moscow';

create function private.delivery_state() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'tenant_id',d.tenant_id,'kind',split_part(d.event_key,':',1),
 'status',d.status,'message',d.message,'attempts',d.attempts,'created_at',d.created_at) order by d.created_at desc),'[]')
 from private.telegram_deliveries d where auth.uid() is not null and private.staff(d.tenant_id,array['owner'])
 and (d.expires_at is null or d.expires_at>now());
$$;
revoke all on function private.delivery_state() from public,anon;
grant execute on function private.delivery_state() to authenticated;
create or replace function public.app_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select public.app_state_base() || jsonb_build_object(
 'payment_claims',coalesce((select jsonb_agg(to_jsonb(c) order by created_at desc) from public.payment_claims c),'[]'),
 'application_messages',coalesce((select jsonb_agg(to_jsonb(m) order by created_at) from public.application_messages m),'[]'),
 'seller_directory',coalesce((select jsonb_agg(to_jsonb(d)) from public.seller_directory d),'[]'),
 'notifications',private.delivery_state());
$$;
