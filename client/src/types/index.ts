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
  in_discord: number;
  ultimate: number;
}

// Officer-editable yes/no fields on a player, shown as roster checkboxes.
export type PlayerFlag = "in_discord" | "ultimate";

export interface RaidSummary {
  id: number;
  name: string;
  mainPartyCount: number;
  subPartyCount: number;
  created_at: string;
  updated_at: string;
}

export type RaidBoardKey = "main" | "sub";

export interface RaidBoard {
  parties: (Player | null)[][];
  partyNames: (string | null)[];
}

export interface RaidDetail extends RaidSummary {
  boards: Record<RaidBoardKey, RaidBoard>;
  notes: string | null;
  notes_updated_at: string | null;
}

// A saved group of up to 5 players that can be dropped into any raid's parties.
export interface PermaParty {
  id: number;
  name: string;
  members: Player[];
}

// Which party (0-based) on the chosen board a perma party should fill.
export interface PermaPartyAssignment {
  permaPartyId: number;
  partyIndex: number;
}

export interface ApplyPermaPartiesResult {
  raid: RaidDetail;
  skipped: string[];
  alreadyPlaced: string[];
}

export interface DiscordSyncSummary {
  matched: number;
  missing: number;
  discordMembers: number;
}

export interface ImportSummary {
  added: number;
  updated: number;
  flaggedInactive: number;
  activeTotal: number;
}
