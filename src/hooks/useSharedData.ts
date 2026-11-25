import { useCallback, useEffect, useState } from "react";
import { aggregatePlayerStats } from "../domain/stats";
import { LOCAL_DATA_EVENT, LOCAL_DATA_KEY, validateBackup } from "../data/localStore";
import { CLOUD_DATA_EVENT } from "../data/cloudClient";
import { cloudSession, getDataClient } from "../auth/cloudSession";
import { normalizeClientPositionKey } from "../domain/collector";
import { emptySharedData, publishSharedData, subscribeSharedDataRefresh } from "../data/sharedData";
import type { Match, Player, SharedDataSnapshot, StoredParticipant } from "../data/models";

const positionLabels: Readonly<Record<string, string>> = {
  top: "上单",
  jungle: "打野",
  middle: "中路",
  bottom: "下路",
  support: "辅助",
};

function mapPlayer(row: Record<string, unknown>): Player {
  return {
    id: String(row.id),
    displayName: String(row.display_name || ""),
    normalizedName: String(row.normalized_name || ""),
    defaultCost: Number(row.default_cost || 0),
    active: Boolean(row.active),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function normalizeParticipant(value: unknown): StoredParticipant {
  const participant = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const storedPosition = String(participant.position || participant.lane || "");
  const position = normalizeClientPositionKey(storedPosition) || storedPosition;
  return {
    ...participant,
    playerId: typeof participant.playerId === "string" ? participant.playerId : null,
    playerName: typeof participant.playerName === "string" ? participant.playerName : null,
    team: participant.team === "red" ? "red" : "blue",
    position,
    positionLabel: String(participant.positionLabel || participant.laneLabel || positionLabels[position] || "未知"),
    champion: (participant.champion && typeof participant.champion === "object"
      ? participant.champion
      : { slug: "", name: "" }) as StoredParticipant["champion"],
  } as StoredParticipant;
}

function mapMatch(row: Record<string, unknown>): Match {
  return {
    id: String(row.id),
    playedAt: String(row.played_at || ""),
    createdAt: String(row.created_at || ""),
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
    winner: row.winner === "red" ? "red" : "blue",
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    note: row.note == null ? null : String(row.note),
    blueTeam: String(row.blue_team || "蓝方"),
    redTeam: String(row.red_team || "红方"),
    participants: Array.isArray(row.participants) ? row.participants.map(normalizeParticipant) : [],
  };
}

export function useSharedData(enabled: boolean) {
  const [client] = useState(getDataClient);
  const [snapshot, setSnapshot] = useState<SharedDataSnapshot>(emptySharedData);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const { tables } = validateBackup(await client.readBackup());
      const riotAccounts = new Map(tables.riot_accounts.map(row => [String(row.id), String(row.account_name)]));
      const matches = tables.matches.map(mapMatch).sort((a, b) => b.playedAt.localeCompare(a.playedAt));
      matches.forEach(match => match.participants?.forEach(participant => {
        if (!participant.accountName && participant.riotAccountId) {
          participant.accountName = riotAccounts.get(participant.riotAccountId) || "";
        }
      }));
      const next = {
        players: tables.players.map(mapPlayer).sort((a, b) => a.displayName.localeCompare(b.displayName, "zh-CN")),
        matches, riotAccounts, playerStats: aggregatePlayerStats(matches),
      };
      setSnapshot(next);
      publishSharedData(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "数据读取失败。");
    }
  }, [enabled, client]);
  useEffect(() => {
    void refresh();
    const changed = () => void refresh();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === LOCAL_DATA_KEY || event.key === null) changed();
    };
    const eventName = cloudSession ? CLOUD_DATA_EVENT : LOCAL_DATA_EVENT;
    window.addEventListener(eventName, changed);
    if (!cloudSession) window.addEventListener("storage", storageChanged);
    const unsubscribe = subscribeSharedDataRefresh(refresh);
    return () => {
      unsubscribe();
      window.removeEventListener(eventName, changed);
      window.removeEventListener("storage", storageChanged);
    };
  }, [refresh]);
  return { error, refresh, snapshot };
}
