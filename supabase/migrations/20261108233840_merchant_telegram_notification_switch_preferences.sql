create table if not exists private.merchant_telegram_preferences (
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,user_id)
);
alter table private.merchant_telegram_preferences enable row level security;
revoke all on private.merchant_telegram_preferences from public,anon,authenticated;
comment on table private.merchant_telegram_preferences
  is 'Per-company, per-merchant Telegram notification opt-in/out. In-app notifications and buyer Telegram messages are unaffected.';

create or replace function public.merchant_telegram_preference()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  u uuid:=auth.uid();
  t uuid:=private.current_tenant();
  flag boolean;
  linked boolean;
  started boolean;
begin
  if u is null or t is null or not exists (
    select 1 from public.organization_members m
    where m.user_id=u and m.tenant_id=t and m.active
      and m.role in ('owner','manager','cashier')
  ) then raise exception 'Доступ запрещён' using errcode='42501'; end if;
  select p.enabled into flag from private.merchant_telegram_preferences p
    where p.tenant_id=t and p.user_id=u;
  select exists(select 1 from private.telegram_accounts a where a.user_id=u),
         exists(select 1 from private.telegram_accounts a where a.user_id=u
           and a.bot_started_at is not null)
    into linked, started;
  return jsonb_build_object(
    'enabled',coalesce(flag,true),'linked',linked,'bot_started',started
  );
end $$;

create or replace function public.set_merchant_telegram_preference(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  u uuid:=auth.uid();
  t uuid:=private.current_tenant();
begin
  if p_enabled is null then raise exception 'Не указана настройка'; end if;
  if u is null or t is null or not exists (
    select 1 from public.organization_members m
    where m.user_id=u and m.tenant_id=t and m.active
      and m.role in ('owner','manager','cashier')
  ) then raise exception 'Доступ запрещён' using errcode='42501'; end if;

  insert into private.merchant_telegram_preferences(tenant_id,user_id,enabled,updated_at)
  values(t,u,p_enabled,now())
  on conflict(tenant_id,user_id) do update
    set enabled=excluded.enabled,updated_at=excluded.updated_at;
  -- Backlog from a muted interval must not flood Telegram when turning back on.
  -- Expiration affects only pending/failed Telegram deliveries for this merchant.
  update private.telegram_deliveries d
    set expires_at=now()
    where d.tenant_id=t and d.recipient=u
      and d.status in ('pending','failed')
      and (d.expires_at is null or d.expires_at>now());
  return public.merchant_telegram_preference();
end $$;

revoke all on function public.merchant_telegram_preference() from public,anon,authenticated;
revoke all on function public.set_merchant_telegram_preference(boolean) from public,anon,authenticated;
grant execute on function public.merchant_telegram_preference() to authenticated;
grant execute on function public.set_merchant_telegram_preference(boolean) to authenticated;

-- Merchant preference is enforced at the point of actual Telegram delivery.
-- Buyer recipients and in-app notifications remain independent.
create or replace function public.claim_buyer_notifications()
returns table(id uuid,lease uuid,telegram_id bigint,message text)
language sql security definer set search_path=''
as $$
with picked as (
 select d.id from private.telegram_deliveries d
 join private.telegram_accounts a on a.user_id=d.recipient
 where d.attempts<8 and d.next_attempt_at<=now()
   and (d.status in ('pending','failed')
     or (d.status='sending' and d.locked_at<now()-interval '5 minutes'))
   and (d.expires_at is null or d.expires_at>now())
   and (d.schedule_id is null or exists (
     select 1 from public.payment_schedules ps where ps.id=d.schedule_id
       and ps.amount>coalesce((
         select sum(alloc.amount) from public.payment_allocations alloc
         where alloc.schedule_id=ps.id and alloc.tenant_id=ps.tenant_id
       ),0)
   ))
   and private.notification_recipient_allowed(d.tenant_id,d.recipient)
   and (
     d.tenant_id is null
     or not exists (
       select 1 from public.organization_members m
       where m.tenant_id=d.tenant_id and m.user_id=d.recipient and m.active
     )
     or coalesce((
       select pref.enabled from private.merchant_telegram_preferences pref
       where pref.tenant_id=d.tenant_id and pref.user_id=d.recipient
     ),true)
   )
 order by d.created_at for update of d skip locked limit 5
), claimed as (
 update private.telegram_deliveries d
  set status='sending',locked_at=now(),lease=gen_random_uuid(),attempts=attempts+1
  from picked p where d.id=p.id returning d.*
)
select d.id,d.lease,a.telegram_id,replace(d.message,'RAJAB FINANCE','HESAP')
  from claimed d join private.telegram_accounts a on a.user_id=d.recipient;
$$;
