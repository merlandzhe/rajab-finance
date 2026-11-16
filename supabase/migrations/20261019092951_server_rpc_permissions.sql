revoke execute on function public.claim_notifications(uuid), public.queue_reminders(uuid), public.consume_rate_limit(text,integer,integer), public.public_intake(uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.claim_notifications(uuid), public.queue_reminders(uuid), public.consume_rate_limit(text,integer,integer), public.public_intake(uuid,jsonb,uuid) to service_role;
revoke execute on function public.app_command(text,jsonb,uuid) from public,anon;
grant execute on function public.app_command(text,jsonb,uuid) to authenticated;
