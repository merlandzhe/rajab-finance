-- Telegram identities and bearer invitation hashes are never exposed by the Data API.
create table private.telegram_accounts (
  telegram_id bigint primary key check (telegram_id > 0 and telegram_id <= 9007199254740991),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  linked_at timestamptz not null default now()
);
create table private.telegram_invites (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references public.organizations(id) on delete cascade,
  expected_role text,
  issued_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 minutes',
  used_at timestamptz
);
create index telegram_invites_user on private.telegram_invites(user_id);
create table private.telegram_auth_replays (
  digest text primary key check (digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create index telegram_replay_expiry on private.telegram_auth_replays(expires_at);
alter table private.telegram_accounts enable row level security;
alter table private.telegram_invites enable row level security;
alter table private.telegram_auth_replays enable row level security;
revoke all on private.telegram_accounts,private.telegram_invites,private.telegram_auth_replays from public,anon,authenticated,service_role;

-- Owners can invite an existing client account of their own organization.
-- Every active member may link their own account. No role is supplied by Telegram.
create function private.telegram_target(p_customer uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_target uuid; v_tenant uuid;
begin
  if v_user is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  if p_customer is null then
    if not exists(select 1 from public.organization_members where user_id=v_user and active)
      and not exists(select 1 from public.profiles where id=v_user and platform_admin)
      then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    return v_user;
  end if;
  select tenant_id into v_tenant from public.organization_members
    where user_id=v_user and active and role='owner';
  select c.auth_user_id into v_target from public.customers c
    join public.organization_members m on m.user_id=c.auth_user_id and m.tenant_id=c.tenant_id
    where c.id=p_customer and c.tenant_id=v_tenant and m.active and m.role='client';
  if v_target is null then raise exception 'TELEGRAM_ACCOUNT_REQUIRED'; end if;
  return v_target;
end $$;
revoke all on function private.telegram_target(uuid) from public,anon,authenticated;

create function public.telegram_invite(p_token_hash text, p_customer uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_target uuid; v_tenant uuid; v_role text; v_expiry timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'TELEGRAM_INVALID'; end if;
  v_target := private.telegram_target(p_customer);
  perform 1 from public.profiles where id=v_target for update;
  if exists(select 1 from private.telegram_accounts where user_id=v_target)
    then raise exception 'TELEGRAM_ALREADY_LINKED'; end if;
  select tenant_id,role::text into v_tenant,v_role from public.organization_members where user_id=v_target and active;
  delete from private.telegram_invites where user_id=v_target;
  insert into private.telegram_invites(token_hash,user_id,tenant_id,expected_role,issued_by)
    values(p_token_hash,v_target,v_tenant,v_role,auth.uid()) returning expires_at into v_expiry;
  return jsonb_build_object('expires_at',v_expiry);
end $$;

create function public.telegram_cancel_invite(p_customer uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target uuid;
begin
  v_target := private.telegram_target(p_customer);
  perform 1 from public.profiles where id=v_target for update;
  delete from private.telegram_invites where user_id=v_target and used_at is null;
end $$;
revoke all on function public.telegram_invite(text,uuid),public.telegram_cancel_invite(uuid) from public,anon;
grant execute on function public.telegram_invite(text,uuid),public.telegram_cancel_invite(uuid) to authenticated;

-- Called only by the server AFTER HMAC and freshness validation. One transaction
-- checks membership, consumes the invitation and rejects replayed signed data.
create function public.telegram_exchange(p_telegram_id bigint,p_digest text,p_invite_hash text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_invite private.telegram_invites%rowtype; v_inserted text;
begin
  if p_telegram_id is null or p_telegram_id <= 0 or p_telegram_id > 9007199254740991
    or p_digest is null or p_digest !~ '^[a-f0-9]{64}$' then raise exception 'TELEGRAM_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(p_telegram_id);
  select user_id into v_user from private.telegram_accounts where telegram_id=p_telegram_id;
  if v_user is null then
    if p_invite_hash is null then raise exception 'TELEGRAM_INVITE_REQUIRED'; end if;
    select user_id into v_user from private.telegram_invites where token_hash=p_invite_hash;
    if v_user is null then raise exception 'TELEGRAM_INVITE_INVALID'; end if;
    -- Same lock order as issuance/cancellation prevents simultaneous redemption.
    perform 1 from public.profiles where id=v_user for update;
    select * into v_invite from private.telegram_invites where token_hash=p_invite_hash for update;
    if not found or v_invite.used_at is not null or v_invite.expires_at <= now()
      or exists(select 1 from private.telegram_accounts where user_id=v_user)
      then raise exception 'TELEGRAM_INVITE_INVALID'; end if;
    if v_invite.issued_by <> v_user and not exists(
      select 1 from public.organization_members where user_id=v_invite.issued_by
        and tenant_id=v_invite.tenant_id and role='owner' and active
    ) then raise exception 'TELEGRAM_INVITE_INVALID'; end if;
    if v_invite.tenant_id is not null and not exists(
      select 1 from public.organization_members where user_id=v_user and tenant_id=v_invite.tenant_id
        and role::text=v_invite.expected_role and active
    ) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    insert into private.telegram_accounts(telegram_id,user_id) values(p_telegram_id,v_user);
    update private.telegram_invites set used_at=now() where token_hash=p_invite_hash;
  end if;
  if not exists(select 1 from public.organization_members where user_id=v_user and active)
    and not exists(select 1 from public.profiles where id=v_user and platform_admin)
    then raise exception 'FORBIDDEN' using errcode='42501'; end if;
  delete from private.telegram_auth_replays where expires_at < now();
  insert into private.telegram_auth_replays(digest) values(p_digest)
    on conflict do nothing returning digest into v_inserted;
  if v_inserted is null then raise exception 'TELEGRAM_REPLAY'; end if;
  return v_user;
end $$;
revoke all on function public.telegram_exchange(bigint,text,text) from public,anon,authenticated;
grant execute on function public.telegram_exchange(bigint,text,text) to service_role;
