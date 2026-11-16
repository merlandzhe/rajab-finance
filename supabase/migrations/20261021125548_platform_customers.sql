create function public.platform_customers(p_query text default '', p_offset int default 0) returns jsonb
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
 where q='' or strpos(lower(name),q)>0 or strpos(lower(coalesce(phone,'')),q)>0
 or (length(regexp_replace(q,'[^0-9]','','g'))>=3 and regexp_replace(q,'[^0-9]','','g')=q and strpos(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),q)>0)
 or strpos(lower(companies::text),q)>0
 order by created_at desc,id limit 51 offset p_offset
 )
 select coalesce(jsonb_agg(to_jsonb(page) order by created_at desc,id),'[]'::jsonb) into result from page;
 return result;
end $$;
revoke all on function public.platform_customers(text,int) from public,anon,authenticated,service_role;
grant execute on function public.platform_customers(text,int) to authenticated;
