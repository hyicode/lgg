function normalize(value = "") {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export const CLIENT_POSITION_KEYS = ["top", "jungle", "middle", "bottom", "support"];

export function normalizeClientPositionKey(position = "", lane = "", role = "") {
  const normalizeCode = (value) => String(value || "")
    .trim()
    .toUpperCase()
    .replace(/_LANE$/, "");
  const rawPosition = normalizeCode(position);
  const rawLane = normalizeCode(lane);
  const rawRole = normalizeCode(role);
  const positionCode = ["", "NONE", "UNSELECTED", "FILL"].includes(rawPosition)
    ? rawLane
    : rawPosition;
  if (positionCode === "TOP") return "top";
  if (positionCode === "JUNGLE") return "jungle";
  if (["MID", "MIDDLE", "CENTER"].includes(positionCode)) return "middle";
  if (["UTILITY", "SUPPORT"].includes(positionCode)) return "support";
  if (["BOT", "BOTTOM"].includes(positionCode)) {
    return ["UTILITY", "SUPPORT", "DUO_SUPPORT"].includes(rawRole) ? "support" : "bottom";
  }
  return "";
}

export function normalizeClientTeam(teamId, team = "") {
  const numericTeamId = Number(teamId || 0);
  const teamCode = String(team || "").trim().toUpperCase();
  if (numericTeamId === 100 || teamCode === "ORDER" || teamCode === "BLUE") return "blue";
  if (numericTeamId === 200 || teamCode === "CHAOS" || teamCode === "RED") return "red";
  return "";
}

export function riotIdFromClientPlayer(player = {}) {
  const gameName = String(player.riotIdGameName || player.gameName || "").trim();
  const tagLine = String(player.riotIdTagLine || player.tagLine || "").trim();
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  const riotId = String(player.riotId || "").trim();
  if (riotId) return riotId;
  return String(player.summonerName || gameName || "").trim();
}

export function collectedMatchProblems(match, { requireWinner = false } = {}) {
  const problems = [];
  const participants = Array.isArray(match?.participants) ? match.participants : [];
  const mapId = Number(match?.mapId || 0);
  const gameMode = String(match?.gameMode || "").trim().toUpperCase();

  if (!match?.gameId) problems.push("缺少对局 ID");
  if (!match?.playedAt || Number.isNaN(new Date(match.playedAt).getTime())) problems.push("缺少有效比赛时间");
  if (mapId && mapId !== 11) problems.push(`地图不是召唤师峡谷（地图 ID ${mapId}）`);
  if (!mapId && gameMode !== "CLASSIC") problems.push(`游戏模式不是召唤师峡谷经典模式（${gameMode || "未知"}）`);
  if (requireWinner && !["blue", "red"].includes(match?.winner)) problems.push("无法从客户端确认胜方");
  if (participants.length !== 10) problems.push(`参与者不是 10 人（实际 ${participants.length} 人）`);

  const teamCounts = { blue: 0, red: 0 };
  const teamPositions = { blue: new Set(), red: new Set() };
  const accounts = new Set();
  participants.forEach((participant, index) => {
    const row = index + 1;
    if (!participant || !["blue", "red"].includes(participant.team)) {
      problems.push(`第 ${row} 名参与者缺少有效队伍`);
      return;
    }
    teamCounts[participant.team] += 1;
    if (!CLIENT_POSITION_KEYS.includes(participant.position)) {
      problems.push(`第 ${row} 名参与者缺少有效位置`);
    } else {
      teamPositions[participant.team].add(participant.position);
    }
    const accountKey = normalize(participant.accountName);
    if (!accountKey) problems.push(`第 ${row} 名参与者缺少游戏 ID`);
    else if (accounts.has(accountKey)) problems.push(`游戏 ID 重复：${participant.accountName}`);
    else accounts.add(accountKey);
    if (!Number(participant.championId || 0) || !String(participant.championName || "").trim()) {
      problems.push(`第 ${row} 名参与者缺少英雄数据`);
    }
  });

  for (const team of ["blue", "red"]) {
    if (teamCounts[team] !== 5) problems.push(`${team === "blue" ? "蓝方" : "红方"}不是 5 人`);
    if (teamPositions[team].size !== 5) problems.push(`${team === "blue" ? "蓝方" : "红方"}位置数据不完整或重复`);
  }
  return [...new Set(problems)];
}

export function championSlug(value = "") {
  return String(value).normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function participantScore(result, participant) {
  const sameTeam = result.team === participant.team;
  const draftChampionId = Number(result.champion.id || 0);
  const sameChampionId = draftChampionId > 0
    && draftChampionId === Number(participant.championId || 0);
  const sameChampionSlug = championSlug(result.champion.slug)
    && championSlug(result.champion.slug) === championSlug(participant.championSlug || participant.championName);
  const draftName = normalize(result.player.name);
  const accountName = normalize(participant.accountName).split("#")[0];
  const sameName = draftName === accountName || normalize(participant.accountName) === draftName;

  if (!sameName && !(sameTeam && (sameChampionId || sameChampionSlug))) return -1;
  return (sameName ? 200 : 0)
    + (sameTeam ? 80 : 0)
    + (sameChampionId ? 140 : 0)
    + (sameChampionSlug ? 120 : 0);
}

export function matchCollectedParticipants(results, participants) {
  const remaining = [...participants];
  const rows = [];
  const unmatched = [];

  for (const result of results) {
    const ranked = remaining
      .map((participant, index) => ({ participant, index, score: participantScore(result, participant) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 0) {
      unmatched.push(result);
      continue;
    }
    remaining.splice(best.index, 1);
    rows.push({ result, participant: best.participant });
  }

  return { rows, unmatched, unused: remaining };
}
