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
  played_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  winner text not null check (winner in ('blue', 'red')),
  duration_seconds integer,
  note text not null default '' check (char_length(note) <= 500),
  blue_team text not null default '蓝方',
  red_team text not null default '红方',
  participants jsonb not null
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
    or new.participants is distinct from old.participants
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

drop policy if exists "players inserted by members" on public.players;
create policy "players inserted by members"
on public.players for insert
to authenticated
with check (public.is_active_member());

drop policy if exists "matches read by members" on public.matches;
create policy "matches read by members"
on public.matches for select
to authenticated
using (public.is_active_member());

drop policy if exists "matches inserted by members" on public.matches;
create policy "matches inserted by members"
on public.matches for insert
to authenticated
with check (public.is_active_member());

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

-- 选手战绩汇总（每提交一场比赛自动更新）
-- 连胜由前端从 matches 列表计算，不在此表中存储
create table if not exists public.player_stats (
  player_id uuid primary key references public.players(id) on delete cascade,
  games int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  kills int not null default 0,
  deaths int not null default 0,
  assists int not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.player_stats enable row level security;

drop policy if exists "player_stats read by members" on public.player_stats;
create policy "player_stats read by members"
on public.player_stats for select
to authenticated
using (public.is_active_member());

drop policy if exists "player_stats managed by members" on public.player_stats;
create policy "player_stats managed by members"
on public.player_stats for all
to authenticated
using (public.is_active_member())
with check (public.is_active_member());

-- 从所有 matches 的 participants JSONB 中重算全部选手战绩
create or replace function public.recalc_player_stats()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
begin
  delete from public.player_stats where true;

  for rec in
    select
      (p ->> 'playerId')::uuid as pid,
      count(*) as games,
      count(*) filter (where p ->> 'team' = m.winner) as wins,
      count(*) filter (where p ->> 'team' <> m.winner) as losses,
      coalesce(sum(((p -> 'stats' ->> 'kills')::int)), 0) as kills,
      coalesce(sum(((p -> 'stats' ->> 'deaths')::int)), 0) as deaths,
      coalesce(sum(((p -> 'stats' ->> 'assists')::int)), 0) as assists
    from public.matches m,
         jsonb_array_elements(m.participants) p
    where p ->> 'playerId' is not null
    group by pid
  loop
    insert into public.player_stats (player_id, games, wins, losses, kills, deaths, assists, updated_at)
    values (rec.pid, rec.games, rec.wins, rec.losses, rec.kills, rec.deaths, rec.assists, now())
    on conflict (player_id) do update set
      games = excluded.games, wins = excluded.wins, losses = excluded.losses,
      kills = excluded.kills, deaths = excluded.deaths, assists = excluded.assists,
      updated_at = now();
  end loop;
end;
$$;

-- 触发器：matches 变更时自动重算战绩
create or replace function public.on_match_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recalc_player_stats();
  return null;
end;
$$;

drop trigger if exists trg_match_changed on public.matches;
create trigger trg_match_changed
after insert or update or delete on public.matches
for each statement execute function public.on_match_changed();

-- 客户端玩家账号（Riot ID），避免在每个 match.participants 中重复存储
create table if not exists public.riot_accounts (
  id uuid primary key default gen_random_uuid(),
  account_name text not null,
  normalized_name text not null unique,
  created_at timestamptz not null default now()
);

alter table public.riot_accounts enable row level security;

drop policy if exists "riot_accounts read by members" on public.riot_accounts;
create policy "riot_accounts read by members"
on public.riot_accounts for select
to authenticated
using (exists (select 1 from public.profiles where id = auth.uid() and active = true));

drop policy if exists "riot_accounts inserted by members" on public.riot_accounts;
create policy "riot_accounts inserted by members"
on public.riot_accounts for insert
to authenticated
with check (exists (select 1 from public.profiles where id = auth.uid() and active = true));

revoke all on public.profiles, public.players, public.matches, public.riot_accounts, public.player_stats from anon;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.players to authenticated;
grant select, insert, update, delete on public.matches to authenticated;
grant select, insert on public.riot_accounts to authenticated;
grant select on public.player_stats to authenticated;

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

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'riot_accounts'
  ) then
    alter publication supabase_realtime add table public.riot_accounts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'player_stats'
  ) then
    alter publication supabase_realtime add table public.player_stats;
  end if;
end
$$;
