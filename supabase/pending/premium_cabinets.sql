-- Pending release: apply in one transaction after database access is restored.
-- No financial records are removed or rewritten.
create table public.seller_payment_methods (
 tenant_id uuid primary key references public.organizations(id),
 sbp_phone text not null default '' check(sbp_phone='' or sbp_phone ~ '^\+7[0-9]{10}$'),
 bank_name text not null default '' check(length(bank_name)<=120),
 recipient_name text not null default '' check(length(recipient_name)<=120),
 cash_enabled boolean not null default true,
 cash_instructions text not null default '' check(length(cash_instructions)<=500),
 updated_at timestamptz not null default now()
);
alter table public.seller_payment_methods enable row level security;
revoke all on public.seller_payment_methods from public,anon,authenticated;
grant select on public.seller_payment_methods to authenticated;
create policy seller_payment_read on public.seller_payment_methods for select to authenticated
 using(tenant_id=private.current_tenant());

create function public.save_seller_payment_methods(p_phone text,p_bank text,p_recipient text,p_cash boolean,p_instructions text)
returns void language plpgsql security definer set search_path='' as $$
declare t uuid:=private.current_tenant();
begin
 if auth.uid() is null or not private.staff(t,array['owner']) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_phone is null or p_bank is null or p_recipient is null or p_cash is null or p_instructions is null
   or (p_phone<>'' and (p_phone !~ '^\+7[0-9]{10}$' or length(trim(p_bank))<2 or length(trim(p_recipient))<2))
   then raise exception 'Проверьте реквизиты СБП'; end if;
 insert into public.seller_payment_methods(tenant_id,sbp_phone,bank_name,recipient_name,cash_enabled,cash_instructions)
 values(t,p_phone,trim(p_bank),trim(p_recipient),p_cash,trim(p_instructions))
 on conflict(tenant_id) do update set sbp_phone=excluded.sbp_phone,bank_name=excluded.bank_name,
 recipient_name=excluded.recipient_name,cash_enabled=excluded.cash_enabled,cash_instructions=excluded.cash_instructions,updated_at=now();
end $$;
revoke all on function public.save_seller_payment_methods(text,text,text,boolean,text) from public,anon;
grant execute on function public.save_seller_payment_methods(text,text,text,boolean,text) to authenticated;

-- Platform administrators issue one-time codes for existing owners. Reuses the
-- existing atomically consumed invitation table and Telegram identity checks.
create function public.platform_owner_invite(p_owner uuid,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid; expiry timestamptz;
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'TELEGRAM_INVALID'; end if;
 perform 1 from public.profiles where id=p_owner for update;
 select tenant_id into t from public.organization_members where user_id=p_owner and active and role='owner';
 if t is null then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if exists(select 1 from private.telegram_accounts where user_id=p_owner) then raise exception 'TELEGRAM_ALREADY_LINKED'; end if;
 delete from private.telegram_invites where user_id=p_owner and used_at is null;
 insert into private.telegram_invites(token_hash,user_id,tenant_id,expected_role,issued_by,expires_at)
 values(p_hash,p_owner,t,'owner',p_owner,now()+interval '24 hours') returning expires_at into expiry;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details)
 values(t,auth.uid(),'platform.owner_invite',p_owner,'{}');
 return jsonb_build_object('expires_at',expiry);
end $$;
revoke all on function public.platform_owner_invite(uuid,text) from public,anon;
grant execute on function public.platform_owner_invite(uuid,text) to authenticated;

-- A server-provisioned Auth account receives an isolated organization only
-- when the caller is an authenticated platform administrator.
create function public.platform_create_merchant(p_user uuid,p_name text,p_owner text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t uuid; invitation jsonb;
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if length(trim(p_name)) not between 2 and 120 or length(trim(p_owner)) not between 2 and 120 then raise exception 'Проверьте название и имя'; end if;
 if not exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'rajab_pending_merchant'='true')
 or exists(select 1 from public.profiles where id=p_user) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 insert into public.organizations(name,slug) values(trim(p_name),'merchant-'||p_user::text) returning id into t;
 insert into public.profiles(id,display_name) values(p_user,trim(p_owner));
 insert into public.organization_members(tenant_id,user_id,role) values(t,p_user,'owner');
 insert into public.organization_settings(tenant_id,version,mode,fixed_bps,term_rates,created_by)
 values(t,1,'individual',0,'{}',auth.uid());
 insert into public.cash_accounts(tenant_id,name) values(t,'СБП'),(t,'Наличные');
 insert into public.seller_directory(tenant_id,display_name,enabled) values(t,trim(p_name),false);
 invitation:=public.platform_owner_invite(p_user,p_hash);
 return invitation||jsonb_build_object('tenant_id',t,'owner_id',p_user);
end $$;
revoke all on function public.platform_create_merchant(uuid,text,text,text) from public,anon;
grant execute on function public.platform_create_merchant(uuid,text,text,text) to authenticated;
