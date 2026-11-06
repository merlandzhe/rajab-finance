-- Operator-approved IDs only. Never writable through the public Data API.
create table private.telegram_admin_bootstrap (
 telegram_id bigint primary key,
 expires_at timestamptz not null default now()+interval '7 days',
 consumed_by uuid references auth.users(id),
 consumed_at timestamptz
);
alter table private.telegram_admin_bootstrap enable row level security;
revoke all on private.telegram_admin_bootstrap from public,anon,authenticated,service_role;
create function public.telegram_admin_bootstrap(p_telegram_id bigint,p_user uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare approved private.telegram_admin_bootstrap%rowtype;
begin
 select * into approved from private.telegram_admin_bootstrap where telegram_id=p_telegram_id for update;
 if not found or approved.consumed_at is not null or approved.expires_at<=now() then return false; end if;
 if p_user is null then return true; end if;
 if not exists(select 1 from private.telegram_accounts where telegram_id=p_telegram_id and user_id=p_user)
 or exists(select 1 from public.organization_members where user_id=p_user)
 then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update public.profiles set platform_admin=true,display_name='Мерлан' where id=p_user;
 if not found then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 update public.buyer_profiles set active=false where user_id=p_user;
 update private.telegram_admin_bootstrap set consumed_by=p_user,consumed_at=now() where telegram_id=p_telegram_id;
 return true;
end $$;
revoke all on function public.telegram_admin_bootstrap(bigint,uuid) from public,anon,authenticated;
grant execute on function public.telegram_admin_bootstrap(bigint,uuid) to service_role;
