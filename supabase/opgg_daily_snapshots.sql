-- Apply once to an existing project via Supabase SQL Editor.
-- Daily OPGG archives are accessible only to the backend service role.
begin;
create table if not exists public.opgg_daily_snapshots (
  captured_at date primary key,
  generated_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  check (payload ->> 'capturedAt' = captured_at::text)
);
alter table public.opgg_daily_snapshots enable row level security;
revoke all on public.opgg_daily_snapshots from public, anon, authenticated;
grant select, insert, update on public.opgg_daily_snapshots to service_role;
commit;
