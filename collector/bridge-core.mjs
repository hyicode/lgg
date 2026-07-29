function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeTeam(value) {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "100" || normalized === "ORDER" || normalized === "BLUE") return "blue";
  if (normalized === "200" || normalized === "CHAOS" || normalized === "RED") return "red";
  return "";
}

function normalizeWin(value) {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value ?? "").toLowerCase();
  if (["win", "won", "victory", "true"].includes(normalized)) return true;
  if (["fail", "failed", "lose", "loss", "defeat", "false"].includes(normalized)) return false;
  return null;
}

function championSlug(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

function statsObject(value) {
  if (!Array.isArray(value)) return value || {};
  const result = {};
  for (const stat of value) {
    const key = String(stat?.name || "");
    if (!key) continue;
    result[key] = stat.value;
    result[key.replace(/[^a-z0-9]/gi, "").toLowerCase()] = stat.value;
  }
  return result;
}

function statValue(stats, ...names) {
  for (const name of names) {
    if (stats[name] !== undefined) return stats[name];
    const normalized = String(name).replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (stats[normalized] !== undefined) return stats[normalized];
  }
  return undefined;
}

function unwrapGame(raw) {
  const games = raw?.games?.games || raw?.games;
  if (Array.isArray(games) && games.length) return games[0];
  return raw?.game || raw?.statsBlock || raw;
}

function participantSources(raw, game) {
  const participants = [];
  for (const list of [
    game?.participants,
    game?.players,
    game?.playerStats,
    raw?.participants,
    raw?.players,
  ]) {
    if (Array.isArray(list)) participants.push(...list);
  }

  for (const teams of [game?.teams, raw?.teams]) {
    if (!Array.isArray(teams)) continue;
    for (const team of teams) {
      for (const player of team?.players || team?.participants || []) {
        participants.push({
          ...player,
          teamId: firstValue(player.teamId, team.teamId, team.id, team.team),
        });
      }
    }
  }
  return participants;
}

function participantName(player) {
  const gameName = firstValue(player.riotIdGameName, player.gameName);
  const tagLine = firstValue(player.riotIdTagLine, player.tagLine);
  return firstValue(
    player.riotId,
    gameName && tagLine ? `${gameName}#${tagLine}` : "",
    gameName,
    player.summonerName,
    player.playerName,
    player.name,
  ) || "未知玩家";
}

function normalizeParticipant(player) {
  const stats = statsObject(player.stats || player.statistics || player);
  const championName = firstValue(
    player.championName,
    player.champion?.name,
    player.skinName,
    stats.championName,
  ) || "";
  return {
    accountName: participantName(player),
    team: normalizeTeam(firstValue(player.teamId, player.team, stats.teamId)),
    position: firstValue(player.position, player.selectedPosition, player.individualPosition, statValue(stats, "position")) || "",
    championId: asNumber(firstValue(player.championId, player.champion?.id, stats.championId), 0),
    championName,
    championSlug: championSlug(championName),
    win: normalizeWin(firstValue(statValue(stats, "win", "gameOutcome"), player.win, player.gameOutcome, player.outcome)),
    stats: {
      kills: asNumber(statValue(stats, "kills", "championsKilled")),
      deaths: asNumber(statValue(stats, "deaths", "numDeaths")),
      assists: asNumber(statValue(stats, "assists")),
      creepScore: asNumber(statValue(stats, "creepScore", "minionsKilled"))
        + asNumber(statValue(stats, "neutralMinionsKilled")),
      goldEarned: asNumber(statValue(stats, "goldEarned")),
      visionScore: asNumber(statValue(stats, "visionScore", "wardScore")),
      damageDealt: asNumber(statValue(stats, "totalDamageDealtToChampions")),
      level: asNumber(firstValue(player.level, statValue(stats, "level", "champLevel"))),
    },
  };
}

function normalizePlayedAt(game) {
  const value = firstValue(
    game?.gameStartTimestamp,
    game?.gameCreation,
    game?.gameCreationDate,
    game?.createDate,
    game?.gameDate,
  );
  if (!value) return "";
  const date = new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function inferWinner(raw, game, participants) {
  for (const team of [...(game?.teams || []), ...(raw?.teams || [])]) {
    const won = normalizeWin(firstValue(team.win, team.isWinningTeam, team.outcome));
    if (won === true) return normalizeTeam(firstValue(team.teamId, team.id, team.team));
  }
  const winner = participants.find((participant) => participant.win === true && participant.team);
  return winner?.team || "";
}

export function normalizeLcuMatch(raw, source = "League Client API") {
  const game = unwrapGame(raw);
  const participants = participantSources(raw, game).map(normalizeParticipant);
  const unique = [];
  const seen = new Set();
  for (const participant of participants) {
    const key = [
      participant.accountName,
      participant.team,
      participant.championId,
      participant.championSlug,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(participant);
  }
  if (unique.length < 2) throw new Error("客户端返回的对局中没有完整玩家数据。");

  return {
    source,
    collectedAt: new Date().toISOString(),
    gameId: String(firstValue(game?.gameId, raw?.gameId, game?.id) || ""),
    playedAt: normalizePlayedAt(game),
    durationSeconds: asNumber(firstValue(game?.gameDuration, game?.gameLength, game?.gameTime)),
    gameMode: firstValue(game?.gameMode, game?.queueType, game?.gameType) || "",
    winner: inferWinner(raw, game, unique),
    participants: unique,
  };
}

export function normalizeLiveMatch(raw) {
  const participants = (raw?.allPlayers || []).map((player) => normalizeParticipant({
    ...player,
    teamId: player.team,
    stats: player.scores,
  }));
  if (participants.length < 2) throw new Error("实时对局中没有完整玩家数据。");
  return {
    source: "Live Client Data API（对局进行中）",
    collectedAt: new Date().toISOString(),
    gameId: "",
    playedAt: raw.gameData?.gameTime
      ? new Date(Date.now() - Number(raw.gameData.gameTime) * 1000).toISOString()
      : "",
    durationSeconds: asNumber(raw.gameData?.gameTime),
    gameMode: raw.gameData?.gameMode || "",
    winner: "",
    participants,
  };
}

export function extractGameId(raw) {
  const game = unwrapGame(raw);
  return String(firstValue(game?.gameId, game?.id, raw?.gameId) || "");
}
