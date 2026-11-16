create table if not exists private.merchant_terms (
 tenant_id uuid primary key references public.organizations(id) on delete cascade,
 min_down_bps integer not null default 0 check(min_down_bps between 0 and 9500),
 default_down_bps integer not null default 0 check(default_down_bps between 0 and 9500),
 min_months integer not null default 1 check(min_months between 1 and 36),
 max_months integer not null default 36 check(max_months between 1 and 36),
 updated_at timestamptz not null default now(),
 updated_by uuid,
 constraint valid_merchant_terms check(default_down_bps>=min_down_bps and min_months<=max_months)
);
alter table private.merchant_terms enable row level security;
revoke all on private.merchant_terms from public, anon, authenticated;

create or replace function public.merchant_terms_get()
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=private.current_tenant(); r text:=private.current_role(); p private.merchant_terms;
begin
 if auth.uid() is null or t is null or r not in ('owner','manager') then
  raise exception 'Недостаточно прав' using errcode='42501';
 end if;
 select * into p from private.merchant_terms where tenant_id=t;
 return jsonb_build_object(
  'min_down_bps',coalesce(p.min_down_bps,0),
  'default_down_bps',coalesce(p.default_down_bps,0),
  'min_months',coalesce(p.min_months,1),
  'max_months',coalesce(p.max_months,36),
  'updated_at',p.updated_at
 );
end $$;
revoke all on function public.merchant_terms_get() from public,anon;
grant execute on function public.merchant_terms_get() to authenticated;

create or replace function public.merchant_terms_update(p_min_down_bps int,p_default_down_bps int,p_min_months int,p_max_months int)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=private.current_tenant(); r text:=private.current_role(); u uuid:=auth.uid(); p private.merchant_terms;
begin
 if u is null or t is null or r <> 'owner' then
  raise exception 'Тарифы может менять владелец магазина' using errcode='42501';
 end if;
 if p_min_down_bps is null or p_default_down_bps is null or p_min_months is null or p_max_months is null or
    p_min_down_bps<0 or p_default_down_bps>9500 or p_default_down_bps<p_min_down_bps or
    p_min_months<1 or p_max_months>36 or p_min_months>p_max_months then
    raise exception 'Проверьте первоначальный взнос и срок рассрочки';
 end if;
 perform 1 from public.organizations where id=t for update;
 insert into private.merchant_terms(tenant_id,min_down_bps,default_down_bps,min_months,max_months,updated_at,updated_by)
 values(t,p_min_down_bps,p_default_down_bps,p_min_months,p_max_months,now(),u)
 on conflict(tenant_id) do update set
 min_down_bps=excluded.min_down_bps,
 default_down_bps=excluded.default_down_bps,
 min_months=excluded.min_months,
 max_months=excluded.max_months,
 updated_at=excluded.updated_at,
 updated_by=excluded.updated_by
 returning * into p;
 insert into public.audit_logs(tenant_id,actor_id,action,entity_id,details)
 values(t,u,'merchant.terms.update',t,jsonb_build_object('min_down_bps',p.min_down_bps,'default_down_bps',p.default_down_bps,'min_months',p.min_months,'max_months',p.max_months));
 return jsonb_build_object('ok',true,'min_down_bps',p.min_down_bps,'default_down_bps',p.default_down_bps,'min_months',p.min_months,'max_months',p.max_months);
end $$;
revoke all on function public.merchant_terms_update(int,int,int,int) from public,anon;
grant execute on function public.merchant_terms_update(int,int,int,int) to authenticated;

create or replace function private.enforce_merchant_terms_on_application()
returns trigger language plpgsql set search_path='' as $$
declare p private.merchant_terms; sale_price bigint; min_amount bigint;
begin
 select * into p from private.merchant_terms where tenant_id=new.tenant_id;
 if not found then return new; end if;
 if new.months<p.min_months or new.months>p.max_months then
   raise exception 'Магазин оформляет рассрочку на срок от % до % месяцев', p.min_months,p.max_months;
 end if;
 sale_price:=coalesce(nullif(new.final_quote->>'sale_price','')::bigint,new.estimated_cost);
 min_amount:=ceil(sale_price::numeric*p.min_down_bps/10000)::bigint;
 if new.down_payment<min_amount then
   raise exception 'Минимальный первоначальный взнос в этом магазине — % %% (не меньше % руб.)',
     p.min_down_bps::numeric/100,ceil(min_amount::numeric/100);
 end if;
 return new;
end $$;
drop trigger if exists zz_merchant_terms_validate on public.applications;
create trigger zz_merchant_terms_validate before insert on public.applications
for each row execute function private.enforce_merchant_terms_on_application();

create or replace function public.public_terms(p_tenant uuid)
returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'mode',s.mode,'fixed_bps',s.fixed_bps,'term_rates',s.term_rates,'version',s.version,
 'min_down_bps',coalesce(t.min_down_bps,0),
 'default_down_bps',coalesce(t.default_down_bps,0),
 'min_months',coalesce(t.min_months,1),
 'max_months',coalesce(t.max_months,36))
from public.organization_settings s
left join private.merchant_terms t on t.tenant_id=s.tenant_id
where s.tenant_id=p_tenant order by s.version desc limit 1;
$$;
