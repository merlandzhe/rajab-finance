create table public.notification_read_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  last_read_at timestamptz not null default '1970-01-01 00:00:00+00'::timestamptz,
  updated_at timestamptz not null default now(),
  constraint notification_read_state_pkey primary key (user_id, tenant_id)
);

comment on table public.notification_read_state is 'Per-staff read watermark for tenant-scoped in-app notifications. Does not change Telegram delivery.';

alter table public.notification_read_state enable row level security;

create policy "notification_read_state_select_own"
on public.notification_read_state
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.staff(tenant_id, array['owner'::text, 'manager'::text, 'cashier'::text])
);

create policy "notification_read_state_insert_own"
on public.notification_read_state
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.staff(tenant_id, array['owner'::text, 'manager'::text, 'cashier'::text])
);

create policy "notification_read_state_update_own"
on public.notification_read_state
for update to authenticated
using (
  user_id = (select auth.uid())
  and private.staff(tenant_id, array['owner'::text, 'manager'::text, 'cashier'::text])
)
with check (
  user_id = (select auth.uid())
  and private.staff(tenant_id, array['owner'::text, 'manager'::text, 'cashier'::text])
);

revoke all on public.notification_read_state from anon;
grant select, insert, update on public.notification_read_state to authenticated;

create index if not exists notifications_tenant_created_at_idx
on public.notifications (tenant_id, created_at desc);
