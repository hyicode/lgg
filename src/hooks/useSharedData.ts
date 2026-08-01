import { useCallback, useEffect, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { normalizeClientPositionKey } from "../domain/collector";
import { emptySharedData, publishSharedData, subscribeSharedDataRefresh } from "../data/sharedData";
import type { Match, Player, SharedDataSnapshot, StoredParticipant } from "../data/models";
import { getSupabaseClient } from "../services/supabaseClient";

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
  const client = getSupabaseClient();
  const [snapshot, setSnapshot] = useState<SharedDataSnapshot>(emptySharedData);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    const [playersResult, matchesResult, accountsResult, statsResult] = await Promise.all([
      client.from("players").select("*").order("display_name", { ascending: true }),
      client.from("matches").select("id,played_at,created_at,winner,duration_seconds,note,blue_team,red_team,participants").order("played_at", { ascending: false }),
      client.from("riot_accounts").select("id, account_name"),
      client.from("player_stats").select("player_id, games, wins, losses, kills, deaths, assists"),
    ]);
    const firstError = playersResult.error || matchesResult.error || accountsResult.error || statsResult.error;
    if (firstError) {
      setError(`共享数据读取失败：${firstError.message}`);
      return;
    }

    setError(null);
    const riotAccounts = new Map((accountsResult.data || []).map((row) => [String(row.id), String(row.account_name)]));
    const matches = (matchesResult.data || []).map((row) => mapMatch(row as Record<string, unknown>));
    matches.forEach((match) => match.participants?.forEach((participant) => {
      if (!participant.accountName && participant.riotAccountId) {
        participant.accountName = riotAccounts.get(participant.riotAccountId) || "";
      }
    }));
    setSnapshot({
      players: (playersResult.data || []).map((row) => mapPlayer(row as Record<string, unknown>)),
      matches,
      riotAccounts,
      playerStats: new Map((statsResult.data || []).map((row) => [String(row.player_id), {
        playerId: String(row.player_id),
        games: Number(row.games || 0),
        wins: Number(row.wins || 0),
        losses: Number(row.losses || 0),
        kills: Number(row.kills || 0),
        deaths: Number(row.deaths || 0),
        assists: Number(row.assists || 0),
      }])),
    });
  }, [client, enabled]);

  useEffect(() => {
    if (!enabled || !client) {
      setSnapshot(emptySharedData());
      return;
    }
    void refresh();
    let channel: RealtimeChannel | null = client
      .channel("lgg-react-shared-data")
      .on("postgres_changes", { event: "*", schema: "public", table: "players" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "matches" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "riot_accounts" }, () => void refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "player_stats" }, () => void refresh())
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") setError("实时同步连接失败，刷新页面后会重新连接。");
      });
    const unsubscribeRefresh = subscribeSharedDataRefresh(() => void refresh());

    return () => {
      unsubscribeRefresh();
      if (channel) void client.removeChannel(channel);
      channel = null;
    };
  }, [client, enabled, refresh]);

  useEffect(() => {
    publishSharedData(snapshot);
  }, [snapshot]);

  return { error, refresh, snapshot };
}
