-- LGG Supabase schema
-- Run in the Supabase SQL Editor when creating or restoring the project.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null,
  role text not null default 'member' check (role in ('admin', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(display_name) between 1 and 24),
  normalized_name text not null unique,
  default_cost numeric(8, 2) not null default 1 check (default_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1,
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  submitted_by_player_id uuid references public.players(id),
  submitted_by_name text,
  winner text not null check (winner in ('blue', 'red')),
  score jsonb not null default '{"blue": null, "red": null}'::jsonb,
  note text not null default '' check (char_length(note) <= 500),
  teams jsonb not null,
  lineup jsonb not null,
  bans jsonb not null,
  options jsonb not null,
  data_version jsonb not null
);

create index if not exists matches_played_at_desc_idx
  on public.matches (played_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
before update on public.players
for each row execute function public.set_updated_at();

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

create or replace function public.protect_match_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.schema_version is distinct from old.schema_version
    or new.created_by is distinct from old.created_by
    or new.teams is distinct from old.teams
    or new.lineup is distinct from old.lineup
    or new.bans is distinct from old.bans
    or new.options is distinct from old.options
    or new.data_version is distinct from old.data_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'match snapshot fields are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists matches_protect_snapshot on public.matches;
create trigger matches_protect_snapshot
before update on public.matches
for each row execute function public.protect_match_snapshot();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(coalesce(new.email, ''));
  profile_username text;
  profile_role text := 'member';
  profile_active boolean := false;
begin
  if normalized_email = 'lgg_admin@lgg.app' then
    profile_username := 'lgg_admin';
    profile_role := 'admin';
    profile_active := true;
  elsif normalized_email = 'lgg@lgg.app' then
    profile_username := 'lgg';
    profile_active := true;
  else
    profile_username := 'user_' || replace(new.id::text, '-', '');
  end if;

  insert into public.profiles (id, username, display_name, role, active)
  values (new.id, profile_username, profile_username, profile_role, profile_active)
  on conflict (id) do update
    set username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        active = excluded.active;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, username, display_name, role, active)
select
  id,
  case lower(email)
    when 'lgg_admin@lgg.app' then 'lgg_admin'
    when 'lgg@lgg.app' then 'lgg'
  end,
  case lower(email)
    when 'lgg_admin@lgg.app' then 'lgg_admin'
    when 'lgg@lgg.app' then 'lgg'
  end,
  case lower(email)
    when 'lgg_admin@lgg.app' then 'admin'
    else 'member'
  end,
  true
from auth.users
where lower(email) in ('lgg_admin@lgg.app', 'lgg@lgg.app')
on conflict (id) do update
  set username = excluded.username,
      display_name = excluded.display_name,
      role = excluded.role,
      active = excluded.active;

create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and active and role = 'admin'
  );
$$;

revoke all on function public.is_active_member() from public;
revoke all on function public.is_admin() from public;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;

drop policy if exists "profiles read by members" on public.profiles;
create policy "profiles read by members"
on public.profiles for select
to authenticated
using (public.is_active_member());

drop policy if exists "profiles managed by admins" on public.profiles;
create policy "profiles managed by admins"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "players read by members" on public.players;
create policy "players read by members"
on public.players for select
to authenticated
using (public.is_active_member());

drop policy if exists "players managed by admins" on public.players;
create policy "players managed by admins"
on public.players for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "matches read by members" on public.matches;
create policy "matches read by members"
on public.matches for select
to authenticated
using (public.is_active_member());

drop policy if exists "matches inserted by members" on public.matches;
create policy "matches inserted by members"
on public.matches for insert
to authenticated
with check (public.is_active_member() and created_by = auth.uid());

drop policy if exists "matches updated by admins" on public.matches;
create policy "matches updated by admins"
on public.matches for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "matches deleted by admins" on public.matches;
create policy "matches deleted by admins"
on public.matches for delete
to authenticated
using (public.is_admin());

revoke all on public.profiles, public.players, public.matches from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.players to authenticated;
grant select, insert, update, delete on public.matches to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'players'
  ) then
    alter publication supabase_realtime add table public.players;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end
$$;
