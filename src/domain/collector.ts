export type ClientTeam = "blue" | "red";
export type ClientPosition = "top" | "jungle" | "middle" | "bottom" | "support";

export interface ClientPlayer {
  riotIdGameName?: unknown;
  gameName?: unknown;
  riotIdTagLine?: unknown;
  tagLine?: unknown;
  riotId?: unknown;
  summonerName?: unknown;
}

export interface CollectedParticipant {
  team?: string;
  position?: string;
  lane?: string;
  role?: string;
  accountName?: string;
  championId?: number | string;
  championName?: string;
  championSlug?: string;
}

export interface CollectedMatch {
  gameId?: string | number;
  playedAt?: string | number | Date;
  mapId?: string | number;
  gameMode?: string;
  winner?: string;
  participants?: CollectedParticipant[];
}

export interface DraftResult {
  team: string;
  champion: { id?: number | string; slug?: string };
  player: { name?: string };
}

function normalize(value: unknown = ""): string {
  return String(value).normalize("NFKC").trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export const CLIENT_POSITION_KEYS: readonly ClientPosition[] = ["top", "jungle", "middle", "bottom", "support"];

export function normalizeClientPositionKey(position: unknown = "", lane: unknown = "", role: unknown = ""): ClientPosition | "" {
  const normalizeCode = (value: unknown): string => String(value || "")
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

export function normalizeClientTeam(teamId: unknown, team: unknown = ""): ClientTeam | "" {
  const numericTeamId = Number(teamId || 0);
  const teamCode = String(team || "").trim().toUpperCase();
  if (numericTeamId === 100 || teamCode === "ORDER" || teamCode === "BLUE") return "blue";
  if (numericTeamId === 200 || teamCode === "CHAOS" || teamCode === "RED") return "red";
  return "";
}

export function assignParticipantsToFixedSlots(participants: CollectedParticipant[] = []) {
  return (["blue", "red"] as const).flatMap((team) => {
    const teamParticipants = participants
      .map((participant, participantIdx) => ({ participant, participantIdx }))
      .filter(({ participant }) => participant.team === team);
    const positionCounts = new Map<ClientPosition, number>();
    for (const { participant } of teamParticipants) {
      const position = normalizeClientPositionKey(participant.position, participant.lane, participant.role);
      if (position) positionCounts.set(position, (positionCounts.get(position) || 0) + 1);
    }

    const assigned = new Map<ClientPosition, number>();
    const usedParticipants = new Set<number>();
    for (const position of CLIENT_POSITION_KEYS) {
      if (positionCounts.get(position) !== 1) continue;
      const entry = teamParticipants.find(({ participant }) =>
        normalizeClientPositionKey(participant.position, participant.lane, participant.role) === position);
      if (entry) {
        assigned.set(position, entry.participantIdx);
        usedParticipants.add(entry.participantIdx);
      }
    }

    const remainingParticipants = teamParticipants
      .map(({ participantIdx }) => participantIdx)
      .filter((participantIdx) => !usedParticipants.has(participantIdx));
    const remainingPositions = CLIENT_POSITION_KEYS.filter((position) => !assigned.has(position));
    remainingPositions.forEach((position, index) => assigned.set(position, remainingParticipants[index] ?? -1));

    return CLIENT_POSITION_KEYS.map((position) => ({
      team,
      position,
      participantIdx: assigned.get(position) ?? -1,
    }));
  });
}

export function riotIdFromClientPlayer(player: ClientPlayer = {}): string {
  const gameName = String(player.riotIdGameName || player.gameName || "").trim();
  const tagLine = String(player.riotIdTagLine || player.tagLine || "").trim();
  if (gameName && tagLine) return `${gameName}#${tagLine}`;
  const riotId = String(player.riotId || "").trim();
  if (riotId) return riotId;
  return String(player.summonerName || gameName || "").trim();
}

export function collectedMatchProblems(
  match: CollectedMatch | null | undefined,
  { requireWinner = false, requirePositions = true }: { requireWinner?: boolean; requirePositions?: boolean } = {},
): string[] {
  const problems: string[] = [];
  const participants = Array.isArray(match?.participants) ? match.participants : [];
  const mapId = Number(match?.mapId || 0);
  const gameMode = String(match?.gameMode || "").trim().toUpperCase();

  if (!match?.gameId) problems.push("缺少对局 ID");
  if (!match?.playedAt || Number.isNaN(new Date(match.playedAt).getTime())) problems.push("缺少有效比赛时间");
  if (mapId && mapId !== 11) problems.push(`地图不是召唤师峡谷（地图 ID ${mapId}）`);
  if (!mapId && gameMode !== "CLASSIC") problems.push(`游戏模式不是召唤师峡谷经典模式（${gameMode || "未知"}）`);
  if (requireWinner && !["blue", "red"].includes(match?.winner ?? "")) problems.push("无法从客户端确认胜方");
  if (participants.length !== 10) problems.push(`参与者不是 10 人（实际 ${participants.length} 人）`);

  const teamCounts: Record<ClientTeam, number> = { blue: 0, red: 0 };
  const teamPositions: Record<ClientTeam, Set<ClientPosition>> = { blue: new Set(), red: new Set() };
  const accounts = new Set<string>();
  participants.forEach((participant, index) => {
    const row = index + 1;
    if (!participant || !["blue", "red"].includes(participant.team ?? "")) {
      problems.push(`第 ${row} 名参与者缺少有效队伍`);
      return;
    }
    const team = participant.team as ClientTeam;
    teamCounts[team] += 1;
    if (requirePositions && !CLIENT_POSITION_KEYS.includes(participant.position as ClientPosition)) {
      problems.push(`第 ${row} 名参与者缺少有效位置`);
    } else if (CLIENT_POSITION_KEYS.includes(participant.position as ClientPosition)) {
      teamPositions[team].add(participant.position as ClientPosition);
    }
    const accountKey = normalize(participant.accountName);
    if (!accountKey) problems.push(`第 ${row} 名参与者缺少游戏 ID`);
    else if (accounts.has(accountKey)) problems.push(`游戏 ID 重复：${participant.accountName}`);
    else accounts.add(accountKey);
    if (!Number(participant.championId || 0) || !String(participant.championName || "").trim()) {
      problems.push(`第 ${row} 名参与者缺少英雄数据`);
    }
  });

  for (const team of ["blue", "red"] as const) {
    if (teamCounts[team] !== 5) problems.push(`${team === "blue" ? "蓝方" : "红方"}不是 5 人`);
    if (requirePositions && teamPositions[team].size !== 5) problems.push(`${team === "blue" ? "蓝方" : "红方"}位置数据不完整或重复`);
  }
  return [...new Set(problems)];
}

export function championSlug(value: unknown = ""): string {
  return String(value).normalize("NFKD").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function participantScore(result: DraftResult, participant: CollectedParticipant): number {
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

export function matchCollectedParticipants(results: DraftResult[], participants: CollectedParticipant[]) {
  const remaining = [...participants];
  const rows: Array<{ result: DraftResult; participant: CollectedParticipant }> = [];
  const unmatched: DraftResult[] = [];

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
