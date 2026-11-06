-- MANUAL, only after creating an Owner in Supabase Auth and after deployment approval.
-- Replace the UUID below with the VERIFIED auth.users ID, never an email or a client parameter.
-- Do not run demo seed scripts in the live database.
begin;
do $$
declare owner_id uuid := '00000000-0000-0000-0000-000000000000'; tenant uuid; begin
 if not exists(select 1 from auth.users where id=owner_id) then raise exception 'Set the verified Owner auth UUID first'; end if;
 if exists(select 1 from public.organizations where slug='rajab') then raise exception 'Organization already exists; do not duplicate'; end if;
 insert into public.organizations(name,slug) values('RAJAB FINANCE','rajab') returning id into tenant;
 insert into public.profiles(id,display_name) values(owner_id,'Раджап');
 insert into public.organization_members(tenant_id,user_id,role) values(tenant,owner_id,'owner');
 insert into public.organization_settings(tenant_id,version,mode,fixed_bps,term_rates) values(tenant,1,'term',1800,'{"3":600,"6":1200,"9":1800,"12":2400}');
 insert into public.document_templates(tenant_id,version,name) values(tenant,1,'Демонстрационный договор v1');
 insert into public.cash_accounts(tenant_id,name) values(tenant,'Основная касса'),(tenant,'Расчётный счёт');
end $$;
commit;
