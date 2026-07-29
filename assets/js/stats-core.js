export function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function filterMatchesByRange(matches, range, fromValue = "", toValue = "", now = new Date()) {
  let from = null;
  let to = null;
  if (range === "30") {
    from = new Date(now);
    from.setDate(from.getDate() - 30);
  } else if (range === "custom") {
    if (fromValue) from = new Date(`${fromValue}T00:00:00`);
    if (toValue) to = new Date(`${toValue}T23:59:59.999`);
  }
  return matches.filter((match) => {
    const playedAt = asDate(match.playedAt);
    return playedAt && (!from || playedAt >= from) && (!to || playedAt <= to);
  });
}

function favorite(counts) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), "zh-CN"))[0]?.[0] || "—";
}

export function computeLeaderboards(matches) {
  const chronological = [...matches].sort((a, b) => asDate(a.playedAt) - asDate(b.playedAt));
  const players = new Map();
  const champions = new Map();

  for (const match of chronological) {
    const presentChampions = new Set((match.bans || []).map((hero) => hero.slug));
    for (const slot of match.lineup || []) {
      const won = slot.team === match.winner;
      let player = players.get(slot.playerId);
      if (!player) {
        player = {
          playerId: slot.playerId,
          name: slot.playerName,
          games: 0,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          lanes: new Map(),
          champions: new Map(),
        };
        players.set(slot.playerId, player);
      }
      player.name = slot.playerName || player.name;
      player.games += 1;
      player.wins += won ? 1 : 0;
      player.losses += won ? 0 : 1;
      player.currentStreak = won ? player.currentStreak + 1 : 0;
      player.bestStreak = Math.max(player.bestStreak, player.currentStreak);
      player.lanes.set(slot.laneLabel || slot.lane, (player.lanes.get(slot.laneLabel || slot.lane) || 0) + 1);
      player.champions.set(slot.champion.name, (player.champions.get(slot.champion.name) || 0) + 1);

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
    for (const ban of match.bans || []) {
      let champion = champions.get(ban.slug);
      if (!champion) {
        champion = { slug: ban.slug, name: ban.name, picks: 0, wins: 0, bans: 0, matchesPresent: 0 };
        champions.set(ban.slug, champion);
      }
      champion.name = ban.name || champion.name;
      champion.bans += 1;
    }
    for (const slug of presentChampions) {
      const champion = champions.get(slug);
      if (champion) champion.matchesPresent += 1;
    }
  }

  const playerRows = [...players.values()].map((player) => ({
    ...player,
    winRate: player.games ? (player.wins / player.games) * 100 : 0,
    favoriteLane: favorite(player.lanes),
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
  const recentMatches = matches.filter((match) => asDate(match.playedAt) >= recentCutoff).length;
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
