create or replace function public.platform_access_state() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.platform_admin() then raise exception 'FORBIDDEN' using errcode='42501'; end if;
 return jsonb_build_object('requests',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from public.merchant_requests r),'[]'),
 'companies',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'status',coalesce(a.status,'active'),'expires_at',a.expires_at,
 'archived',exists(select 1 from private.platform_archives x where x.target='company:'||o.id and x.deleted_at is not null),
 'linked',exists(select 1 from public.organization_members m join private.telegram_accounts t on t.user_id=m.user_id where m.tenant_id=o.id and m.role='owner' and m.active))) from public.organizations o left join public.company_access a on a.tenant_id=o.id),'[]'),
 'codes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'tenant_id',c.tenant_id,'expires_at',c.expires_at,'used_at',c.used_at,'revoked_at',c.revoked_at)) from private.merchant_codes c),'[]'),
 'delivery',(select jsonb_build_object(
   'pending',count(*) filter(where a.user_id is not null and d.attempts<8),
   'waiting_connection',count(*) filter(where a.user_id is null and d.attempts<8),
   'failed',count(*) filter(where d.status='failed' and d.attempts>=8))
 from private.telegram_deliveries d left join private.telegram_accounts a on a.user_id=d.recipient
 where d.status<>'sent' and (d.expires_at is null or d.expires_at>now())
 and private.notification_recipient_allowed(d.tenant_id,d.recipient)
 and (d.schedule_id is null or exists(select 1 from public.payment_schedules ps where ps.id=d.schedule_id
 and ps.amount>coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.schedule_id=ps.id and pa.tenant_id=ps.tenant_id),0)))));
end $$;
