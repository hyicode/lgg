import type { MatchRecord, MatchParticipant, PlayerAggregate, TeamSide } from "../domain/stats";

export interface Player {
  id: string;
  displayName: string;
  normalizedName: string;
  defaultCost: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredParticipant extends MatchParticipant {
  riotAccountId?: string;
  accountName?: string;
  champion: MatchParticipant["champion"] & { id?: number; image?: string };
}

export interface Match extends MatchRecord {
  id: string;
  playedAt: string;
  createdAt: string;
  updatedAt?: string;
  winner: TeamSide;
  durationSeconds?: number | null;
  note?: string | null;
  blueTeam: string;
  redTeam: string;
  participants?: StoredParticipant[];
}

export type PersistedPlayerStats = PlayerAggregate;

export interface SharedDataSnapshot {
  players: Player[];
  matches: Match[];
  riotAccounts: Map<string, string>;
  playerStats: Map<string, PersistedPlayerStats>;
}
