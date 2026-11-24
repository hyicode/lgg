-- Read-only export: run in Supabase SQL Editor, then Export -> JSON.
-- One result row contains ALL rows; the editor's row limit does not truncate tables.
-- No auth.users, passwords, tokens or credentials are exported.
select jsonb_build_object(
  'format', 'lgg-backup',
  'version', 1,
  'exportedAt', now(),
  'source', 'gsswdsuiytprekjgrjqs',
  'tables', jsonb_build_object(
    'players', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.players t),
    'matches', (select coalesce(jsonb_agg(to_jsonb(t) order by t.played_at, t.id), '[]'::jsonb) from public.matches t),
    'riot_accounts', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.riot_accounts t),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from public.profiles t),
    'player_stats', (select coalesce(jsonb_agg(to_jsonb(t) order by t.player_id), '[]'::jsonb) from public.player_stats t),
    'opgg_daily_snapshots', (select coalesce(jsonb_agg(to_jsonb(t) order by t.captured_at), '[]'::jsonb) from public.opgg_daily_snapshots t)
  )
) as backup;
