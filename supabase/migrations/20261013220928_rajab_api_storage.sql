create function public.session_context() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('user_id',auth.uid(),'tenant_id',private.current_tenant(),'role',private.current_role(),'name',(select display_name from public.profiles where id=auth.uid()),'platform_admin',private.platform_admin());
$$;
create function public.app_state() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'organizations',coalesce((select jsonb_agg(to_jsonb(x)) from public.organizations x),'[]'),
 'customers',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.customers x),'[]'),
 'applications',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.applications x),'[]'),
 'purchases',coalesce((select jsonb_agg(to_jsonb(x)) from public.purchases x),'[]'),
 'documents',coalesce((select jsonb_agg(to_jsonb(x)) from public.documents x),'[]'),
 'contracts',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.contracts x),'[]'),
 'contract_items',coalesce((select jsonb_agg(to_jsonb(x)) from public.contract_items x),'[]'),
 'contract_versions',coalesce((select jsonb_agg(to_jsonb(x)) from public.contract_versions x),'[]'),
 'payment_schedules',coalesce((select jsonb_agg(to_jsonb(x) order by due_on,sequence) from public.payment_schedules x),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.payments x),'[]'),
 'payment_allocations',coalesce((select jsonb_agg(to_jsonb(x)) from public.payment_allocations x),'[]'),
 'cash_accounts',coalesce((select jsonb_agg(to_jsonb(x)) from public.cash_accounts x),'[]'),
 'cash_transactions',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.cash_transactions x),'[]'),
 'settings',coalesce((select jsonb_agg(to_jsonb(x) order by version desc) from public.organization_settings x),'[]'),
 'notifications',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.notifications x),'[]'),
 'audit_logs',coalesce((select jsonb_agg(to_jsonb(x) order by created_at desc) from public.audit_logs x),'[]'),
 'members',coalesce((select jsonb_agg(to_jsonb(x)) from public.organization_members x),'[]'),
 'subscriptions',coalesce((select jsonb_agg(to_jsonb(x)) from public.subscriptions x),'[]')
 );
$$;
revoke all on function public.app_state(),public.session_context() from public;
grant execute on function public.app_state(),public.session_context() to authenticated;

create function public.public_terms(p_tenant uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('mode',mode,'fixed_bps',fixed_bps,'term_rates',term_rates,'version',version) from public.organization_settings where tenant_id=p_tenant order by version desc limit 1;
$$;
revoke all on function public.public_terms(uuid) from public;
grant execute on function public.public_terms(uuid) to anon,authenticated;

create function public.consume_rate_limit(p_key text,p_limit int,p_seconds int) returns boolean language plpgsql security definer set search_path='' as $$declare n int; begin
 insert into private.rate_limits(key,window_start,hits) values(p_key,now(),1)
 on conflict(key) do update set hits=case when private.rate_limits.window_start < now()-make_interval(secs=>p_seconds) then 1 else private.rate_limits.hits+1 end, window_start=case when private.rate_limits.window_start < now()-make_interval(secs=>p_seconds) then now() else private.rate_limits.window_start end returning hits into n;
 return n<=p_limit;
end$$;
create function public.public_intake(p_tenant uuid,p_payload jsonb,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare cid uuid; aid uuid; op public.operations; begin
 perform 1 from public.organizations where id=p_tenant for update;
 if not found then raise exception 'Организация не найдена'; end if;
 select * into op from public.operations where tenant_id=p_tenant and operation_key=p_key;
 if found then if op.action<>'public_intake' or op.payload<>p_payload then raise exception 'Повторный ключ с другими данными'; end if; return op.result; end if;
 if length(p_payload->>'name') not between 2 and 120 or p_payload->>'phone' !~ '^\+?[0-9 ()-]{7,24}$' or length(p_payload->>'product_name') not between 2 and 160 then raise exception 'Проверьте данные заявки'; end if;
 insert into public.customers(tenant_id,name,phone,email,notes) values(p_tenant,p_payload->>'name',p_payload->>'phone',nullif(p_payload->>'email',''),'Публичная заявка. Согласие: '||coalesce(p_payload->>'consent_version','demo-v1')) returning id into cid;
 insert into public.applications(tenant_id,customer_id,product_name,product_url,supplier,estimated_cost,down_payment,months,notes) values(p_tenant,cid,p_payload->>'product_name',p_payload->>'product_url',coalesce(p_payload->>'supplier',''),private.cents(p_payload->>'estimated_cost'),private.cents(p_payload->>'down_payment'),(p_payload->>'months')::int,left(coalesce(p_payload->>'notes',''),2000)) returning id into aid;
 insert into public.audit_logs(tenant_id,action,entity_id,details) values(p_tenant,'application.public',aid,jsonb_build_object('consent_version',p_payload->>'consent_version'));
 insert into public.notifications(tenant_id,kind,dedupe_key,message) values(p_tenant,'application','application:'||aid,'Новая заявка '||left(aid::text,8)||'. Откройте CRM.');
 insert into public.operations(tenant_id,operation_key,action,payload,result) values(p_tenant,p_key,'public_intake',p_payload,jsonb_build_object('id',aid,'ok',true));
 return jsonb_build_object('id',aid,'ok',true);
end$$;
create function public.queue_reminders(p_tenant uuid) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(tenant_id,kind,dedupe_key,message)
 select s.tenant_id,case when s.due_on<current_date then 'overdue' else 'due' end,
 'schedule:'||s.id||':'||current_date,
 case when s.due_on<current_date then 'Есть просроченный платёж по ' else 'Приближается платёж по ' end||c.number||'. Подробности в CRM.'
 from public.payment_schedules s join public.contracts c on c.id=s.contract_id and c.tenant_id=s.tenant_id
 where s.tenant_id=p_tenant and s.due_on<=current_date+1 and s.amount>coalesce((select sum(a.amount) from public.payment_allocations a where a.tenant_id=s.tenant_id and a.schedule_id=s.id),0)
 on conflict(tenant_id,dedupe_key) do nothing;
$$;
create function public.claim_notifications(p_tenant uuid) returns setof public.notifications language sql security definer set search_path='' as $$
 update public.notifications n set status='sending',locked_at=now(),attempts=attempts+1 where id in (
 select id from public.notifications where tenant_id=p_tenant and attempts<5 and (status in ('pending','failed') or (status='sending' and locked_at<now()-interval '10 minutes')) order by created_at for update skip locked limit 5) returning n.*;
$$;
revoke all on function public.consume_rate_limit(text,int,int),public.public_intake(uuid,jsonb,uuid),public.queue_reminders(uuid),public.claim_notifications(uuid) from public;
grant execute on function public.consume_rate_limit(text,int,int),public.public_intake(uuid,jsonb,uuid),public.queue_reminders(uuid),public.claim_notifications(uuid) to service_role;
grant all on all tables in schema public to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('deal-documents','deal-documents',false,5242880,array['application/pdf','image/png','image/jpeg']) on conflict(id) do nothing;
-- Uploads go through validated server endpoint. No anon/authenticated INSERT/UPDATE/DELETE.
create policy deal_document_read on storage.objects for select to authenticated using(bucket_id='deal-documents' and exists(select 1 from public.documents d where d.storage_path=name and private.staff(d.tenant_id,array['owner','manager'])));
alter function public.app_command(text,jsonb,uuid) set timezone='Europe/Moscow';
alter function public.queue_reminders(uuid) set timezone='Europe/Moscow';
