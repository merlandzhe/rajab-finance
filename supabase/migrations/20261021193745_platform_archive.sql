create table private.platform_archives (
 target text primary key, deleted_at timestamptz, deleted_by uuid references auth.users(id), previous_active boolean
);
alter table private.platform_archives enable row level security;
revoke all on private.platform_archives from public,anon,authenticated,service_role;
create table private.platform_archive_events (
 id bigint generated always as identity primary key, target text not null, actor uuid not null references auth.users(id), restored boolean not null, created_at timestamptz not null default now()
);
alter table private.platform_archive_events enable row level security;
revoke all on private.platform_archive_events from public,anon,authenticated,service_role;
create function public.platform_archive(p_target text,p_restore boolean,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare kind text; entity uuid; previous boolean; c public.customers;
begin
 if auth.uid() is null or not coalesce(private.platform_admin(),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_confirm is distinct from true or p_restore is null or p_target is null or p_target !~ '^(company|user|customer):[0-9a-f-]{36}$' then raise exception 'INVALID_INPUT'; end if;
 kind:=split_part(p_target,':',1); entity:=split_part(p_target,':',2)::uuid;
 perform pg_advisory_xact_lock(hashtextextended(p_target,0));
 if p_restore and not exists(select 1 from private.platform_archives where target=p_target and deleted_at is not null) then return; end if;
 if not p_restore and exists(select 1 from private.platform_archives where target=p_target and deleted_at is not null) then return; end if;
 if kind='company' then
  perform 1 from public.organizations where id=entity for update;
  if not found then raise exception 'Компания не найдена'; end if;
  if not p_restore and exists(select 1 from public.contracts where tenant_id=entity and status in ('signed','transferred')) then raise exception 'Сначала завершите действующие договоры компании'; end if;
  perform public.platform_company_access(entity,'blocked',(select expires_at from public.company_access where tenant_id=entity));
  if not p_restore then
   update public.seller_directory set enabled=false where tenant_id=entity;
  end if;
 elsif kind='user' then
  if entity=auth.uid() or exists(select 1 from public.profiles where id=entity and platform_admin) or exists(select 1 from public.organization_members where user_id=entity and role<>'client') then raise exception 'Нельзя удалить учётную запись сотрудника или владельца'; end if;
  select active into previous from public.buyer_profiles where user_id=entity for update;
  if not found then raise exception 'Клиент не найден'; end if;
  if not p_restore and exists(select 1 from public.contracts k join public.customers u on u.id=k.customer_id and u.tenant_id=k.tenant_id where u.auth_user_id=entity and k.status in ('signed','transferred')) then raise exception 'Сначала завершите действующие договоры клиента'; end if;
  if exists(select 1 from public.organization_members where user_id=entity and active) then raise exception 'У клиента есть отдельный доступ к компании. Сначала отключите его в компании'; end if;
  update public.buyer_profiles set active=case when p_restore then coalesce((select previous_active from private.platform_archives where target=p_target),true) else false end where user_id=entity;
 else
  select * into c from public.customers where id=entity for update;
  if not found then raise exception 'Клиент не найден'; end if;
  if c.auth_user_id is not null then raise exception 'Удалите зарегистрированного покупателя через его профиль в списке'; end if;
  if not p_restore and exists(select 1 from public.contracts where customer_id=entity and status in ('signed','transferred')) then raise exception 'Сначала завершите действующие договоры клиента'; end if;
 end if;
 if p_restore then
  update private.platform_archives set deleted_at=null where target=p_target;
 else
  insert into private.platform_archives(target,deleted_at,deleted_by,previous_active) values(p_target,now(),auth.uid(),previous)
  on conflict(target) do update set deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,previous_active=case when platform_archives.deleted_at is null then excluded.previous_active else platform_archives.previous_active end;
 end if;
 insert into private.platform_archive_events(target,actor,restored) values(p_target,auth.uid(),p_restore);
end $$;
revoke all on function public.platform_archive(text,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.platform_archive(text,boolean,boolean) to authenticated;
create or replace function private.company_enabled(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.company_access where tenant_id=t and (status<>'active' or expires_at<=now()))
 and not exists(select 1 from private.platform_archives where target='company:'||t and deleted_at is not null);
$$;
create or replace function public.platform_access_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from public.merchant_requests r),'[]'),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',coalesce(a.status,'active'),'expires_at',a.expires_at,
 'archived',exists(select 1 from private.platform_archives x where x.target='company:'||o.id and x.deleted_at is not null),
 'linked',exists(select 1 from public.organization_members m join private.telegram_accounts t on t.user_id=m.user_id where m.tenant_id=o.id and m.role='owner' and m.active))) from public.organizations o left join public.company_access a on a.tenant_id=o.id),'[]'),
 'codes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'expires_at',c.expires_at,'used_at',c.used_at,'revoked_at',c.revoked_at)) from private.merchant_codes c),'[]'),
 'delivery',jsonb_build_object('pending',(select count(*) from private.telegram_deliveries where status<>'sent' and attempts<8),'failed',(select count(*) from private.telegram_deliveries where status='failed' and attempts>=8)));
end $$;

create function public.platform_customer_directory(p_query text default '', p_offset int default 0, p_archived boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; q text:=lower(trim(coalesce(p_query,'')));
begin
 if auth.uid() is null or not coalesce(private.platform_admin(),false) then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or length(q)>120 then raise exception 'INVALID_INPUT'; end if;
 with identities as (
 select 'user:'||b.user_id as id,b.user_id,b.name,b.phone,b.city,b.created_at,null::uuid customer_id from public.buyer_profiles b
 union all
 select 'customer:'||c.id,c.auth_user_id,c.name,c.phone,c.city,c.created_at,c.id from public.customers c
 where not exists(select 1 from public.buyer_profiles b where b.user_id=c.auth_user_id)
 ), clients as (
 select i.*, coalesce((select jsonb_agg(distinct o.name) from public.customers c join public.organizations o on o.id=c.tenant_id
 where (i.customer_id is not null and c.id=i.customer_id) or (i.customer_id is null and c.auth_user_id=i.user_id)), '[]'::jsonb) companies
 from identities i
 ), page as (
 select id,name,phone,city,created_at,companies from clients
 where (exists(select 1 from private.platform_archives x where x.target=clients.id and x.deleted_at is not null))=p_archived and (q='' or strpos(lower(name),q)>0 or strpos(lower(coalesce(phone,'')),q)>0
 or (length(regexp_replace(q,'[^0-9]','','g'))>=3 and regexp_replace(q,'[^0-9]','','g')=q and strpos(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),q)>0)
 or strpos(lower(companies::text),q)>0)
 order by created_at desc,id limit 51 offset p_offset
 )
 select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id),'[]'::jsonb) into result from page;
 return result;
end $$;
revoke all on function public.platform_customer_directory(text,int,boolean) from public,anon,authenticated,service_role;
grant execute on function public.platform_customer_directory(text,int,boolean) to authenticated;

create or replace function public.platform_customers(p_query text default '',p_offset int default 0) returns jsonb language sql stable security invoker set search_path='' as $$ select public.platform_customer_directory(p_query,p_offset,false); $$;
