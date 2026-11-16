-- Hosted Supabase only. The vault secret is provisioned separately; no tokens in source.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create table private.notification_reminder_runs(day date primary key);
alter table private.notification_reminder_runs enable row level security;
revoke all on private.notification_reminder_runs from public,anon,authenticated,service_role;
create function private.notification_tick() returns bigint language plpgsql security definer set search_path='' set timezone='Europe/Moscow' as $$
declare req bigint;
begin
 if extract(hour from now())>=9 then
  insert into private.notification_reminder_runs(day) values(current_date) on conflict do nothing;
  if found then perform public.queue_buyer_reminders(); end if;
 end if;
 if exists(select 1 from private.telegram_deliveries d join private.telegram_accounts a on a.user_id=d.recipient
 where d.attempts<8 and d.next_attempt_at<=now() and (d.status in ('pending','failed') or (d.status='sending' and d.locked_at<now()-interval '5 minutes'))
 and (d.expires_at is null or d.expires_at>now()) and private.notification_recipient_allowed(d.tenant_id,d.recipient)) then
  select net.http_post(url:='https://rajab-finance-mini.vercel.app/api/telegram/dispatch',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='hesap_notification_worker')),
  body:='{}'::jsonb,timeout_milliseconds:=55000) into req;
 end if;
 return req;
end $$;
revoke all on function private.notification_tick() from public,anon,authenticated,service_role;
select cron.schedule('hesap-notification-dispatch','* * * * *','select private.notification_tick()');
