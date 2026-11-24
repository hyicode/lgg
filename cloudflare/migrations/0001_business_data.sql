-- D1 stores business data only. Supabase credentials/profiles are not migrated.
CREATE TABLE players (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 24),
  normalized_name TEXT NOT NULL UNIQUE,
  default_cost REAL NOT NULL DEFAULT 1 CHECK(default_cost >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE riot_accounts (
  id TEXT PRIMARY KEY NOT NULL,
  account_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE matches (
  id TEXT PRIMARY KEY NOT NULL,
  played_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  winner TEXT NOT NULL CHECK(winner IN ('blue', 'red')),
  duration_seconds INTEGER,
  note TEXT,
  blue_team TEXT NOT NULL DEFAULT '蓝方',
  red_team TEXT NOT NULL DEFAULT '红方',
  participants TEXT NOT NULL CHECK(json_valid(participants) AND json_type(participants) = 'array'),
  game_id TEXT
);
CREATE UNIQUE INDEX matches_game_id ON matches(game_id) WHERE game_id IS NOT NULL AND game_id <> '';
CREATE INDEX matches_played_at ON matches(played_at);
