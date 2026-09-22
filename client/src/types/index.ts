export interface Player {
  id: number;
  ign: string;
  level: number | null;
  class: string | null;
  title: string | null;
  gender: string | null;
  position: string | null;
  gear_score: number | null;
  weekly: number | null;
  weekly_contribution: number | null;
  total_contribution: number | null;
  online_status: string | null;
  active: number;
}

export interface RaidSummary {
  id: number;
  name: string;
  party_count: number;
  created_at: string;
  updated_at: string;
  created_by_username: string | null;
}

export type RaidBoardKey = "main" | "sub";

export interface RaidBoard {
  parties: (Player | null)[][];
  partyNames: (string | null)[];
}

export interface RaidDetail extends RaidSummary {
  boards: Record<RaidBoardKey, RaidBoard>;
}

export interface ImportSummary {
  added: number;
  updated: number;
  flaggedInactive: number;
  activeTotal: number;
}

export interface User {
  id: number;
  username: string;
}
