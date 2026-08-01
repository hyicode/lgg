export type TeamSide = "blue" | "red";

export type DateInput = Date | string | number | { toDate(): Date } | null | undefined;

export interface ChampionRef {
  slug: string;
  name: string;
}

export interface ParticipantStats {
  kills?: number | string | null;
  deaths?: number | string | null;
  assists?: number | string | null;
}

export interface MatchParticipant {
  playerId?: string | null;
  playerName?: string | null;
  team: TeamSide;
  positionLabel?: string | null;
  position?: string | null;
  laneLabel?: string | null;
  lane?: string | null;
  champion: ChampionRef;
  stats?: ParticipantStats | null;
}

export interface MatchRecord {
  playedAt: DateInput;
  winner: TeamSide;
  participants?: MatchParticipant[] | null;
}

export interface PlayerAggregate {
  playerId: string;
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
}

type AggregateField = Exclude<keyof PlayerAggregate, "playerId">;
type PersistedPlayerStats = Partial<PlayerAggregate> & { player_id?: string };

export function asDate(value: DateInput): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && "toDate" in value) return value.toDate();
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterMatchesByRange<T extends MatchRecord>(
  matches: T[],
  range: string,
  fromValue = "",
  toValue = "",
  now = new Date(),
): T[] {
  let from: Date | null = null;
  let to: Date | null = null;
  if (["7", "30"].includes(range)) {
    from = new Date(now);
    from.setDate(from.getDate() - Number(range));
  } else if (range === "custom") {
    if (fromValue) from = new Date(`${fromValue}T00:00:00`);
    if (toValue) to = new Date(`${toValue}T23:59:59.999`);
  }
  return matches.filter((match) => {
    const playedAt = asDate(match.playedAt);
    return playedAt && (!from || playedAt >= from) && (!to || playedAt <= to);
  });
}

function favorite(counts: Map<string, number>): string {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN"))[0]?.[0] || "—";
}

function numericStat(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

export function aggregatePlayerStats(matches: MatchRecord[]): Map<string, PlayerAggregate> {
  const players = new Map<string, PlayerAggregate>();
  for (const match of matches) {
    for (const slot of match.participants || []) {
      const playerId = typeof slot.playerId === "string" ? slot.playerId.trim() : "";
      if (!playerId) continue;
      let player = players.get(playerId);
      if (!player) {
        player = {
          playerId,
          games: 0,
          wins: 0,
          losses: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
        };
        players.set(playerId, player);
      }
      const won = slot.team === match.winner;
      player.games += 1;
      player.wins += won ? 1 : 0;
      player.losses += won ? 0 : 1;
      player.kills += numericStat(slot.stats?.kills);
      player.deaths += numericStat(slot.stats?.deaths);
      player.assists += numericStat(slot.stats?.assists);
    }
  }
  return players;
}

export function comparePlayerStats(
  matches: MatchRecord[],
  persistedStats: Map<string, PersistedPlayerStats> | PersistedPlayerStats[],
) {
  const expected = aggregatePlayerStats(matches);
  const persisted: Map<string, PersistedPlayerStats> = persistedStats instanceof Map
    ? persistedStats
    : new Map(
      (persistedStats || [])
        .map((row) => [row.player_id || row.playerId, row] as const)
        .filter((entry): entry is readonly [string, PersistedPlayerStats] => Boolean(entry[0])),
    );
  const fields: AggregateField[] = ["games", "wins", "losses", "kills", "deaths", "assists"];
  const discrepancies: Array<{
    playerId: string;
    changedFields: AggregateField[];
    expected?: PlayerAggregate;
    persisted?: PersistedPlayerStats;
  }> = [];
  for (const playerId of new Set([...expected.keys(), ...persisted.keys()])) {
    const expectedRow = expected.get(playerId);
    const persistedRow = persisted.get(playerId);
    const changedFields = fields.filter((field) => numericStat(expectedRow?.[field]) !== numericStat(persistedRow?.[field]));
    if (changedFields.length) discrepancies.push({ playerId, changedFields, expected: expectedRow, persisted: persistedRow });
  }
  return { expected, discrepancies };
}

interface PlayerLeaderboardSeed {
  playerId: string;
  name: string;
  games: number;
  wins: number;
  losses: number;
  currentStreak: number;
  bestStreak: number;
  positions: Map<string, number>;
  champions: Map<string, number>;
}

interface ChampionLeaderboardSeed {
  slug: string;
  name: string;
  picks: number;
  wins: number;
  bans: number;
  matchesPresent: number;
}

export function computeLeaderboards(matches: MatchRecord[]) {
  const chronological = [...matches].sort(
    (a, b) => (asDate(a.playedAt)?.getTime() ?? 0) - (asDate(b.playedAt)?.getTime() ?? 0),
  );
  const players = new Map<string, PlayerLeaderboardSeed>();
  const champions = new Map<string, ChampionLeaderboardSeed>();

  for (const match of chronological) {
    const presentChampions = new Set<string>();
    for (const slot of match.participants || []) {
      const won = slot.team === match.winner;
      const playerId = typeof slot.playerId === "string" ? slot.playerId.trim() : "";
      if (playerId) {
        let player = players.get(playerId);
        if (!player) {
          player = {
            playerId,
            name: slot.playerName || "—",
            games: 0,
            wins: 0,
            losses: 0,
            currentStreak: 0,
            bestStreak: 0,
            positions: new Map(),
            champions: new Map(),
          };
          players.set(playerId, player);
        }
        player.name = slot.playerName || player.name;
        player.games += 1;
        player.wins += won ? 1 : 0;
        player.losses += won ? 0 : 1;
        player.currentStreak = won ? player.currentStreak + 1 : 0;
        player.bestStreak = Math.max(player.bestStreak, player.currentStreak);
        const position = slot.positionLabel || slot.position || slot.laneLabel || slot.lane || "未知";
        player.positions.set(position, (player.positions.get(position) || 0) + 1);
        player.champions.set(slot.champion.name, (player.champions.get(slot.champion.name) || 0) + 1);
      }

      let champion = champions.get(slot.champion.slug);
      if (!champion) {
        champion = { slug: slot.champion.slug, name: slot.champion.name, picks: 0, wins: 0, bans: 0, matchesPresent: 0 };
        champions.set(slot.champion.slug, champion);
      }
      champion.name = slot.champion.name || champion.name;
      champion.picks += 1;
      champion.wins += won ? 1 : 0;
      presentChampions.add(slot.champion.slug);
    }
    for (const slug of presentChampions) {
      const champion = champions.get(slug);
      if (champion) champion.matchesPresent += 1;
    }
  }

  const playerRows = [...players.values()].map((player) => ({
    ...player,
    winRate: player.games ? (player.wins / player.games) * 100 : 0,
    favoritePosition: favorite(player.positions),
    favoriteChampion: favorite(player.champions),
  }));
  playerRows.sort((a, b) => b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name, "zh-CN"));

  const championRows = [...champions.values()].map((champion) => ({
    ...champion,
    winRate: champion.picks ? (champion.wins / champion.picks) * 100 : 0,
    presenceRate: matches.length ? (champion.matchesPresent / matches.length) * 100 : 0,
  }));
  championRows.sort((a, b) => b.picks - a.picks || b.bans - a.bans || a.name.localeCompare(b.name, "zh-CN"));

  const uniquePlayers = players.size;
  const blueWins = matches.filter((match) => match.winner === "blue").length;
  const recentCutoff = new Date();
  recentCutoff.setDate(recentCutoff.getDate() - 30);
  const recentMatches = matches.filter((match) => {
    const playedAt = asDate(match.playedAt);
    return playedAt !== null && playedAt >= recentCutoff;
  }).length;
  const mostActive = [...playerRows].sort((a, b) => b.games - a.games || b.wins - a.wins)[0];

  return {
    players: playerRows,
    champions: championRows,
    summary: {
      matches: matches.length,
      recentMatches,
      uniquePlayers,
      blueWinRate: matches.length ? (blueWins / matches.length) * 100 : 0,
      mostActive: mostActive?.name || "—",
    },
  };
}
