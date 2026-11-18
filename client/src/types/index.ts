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

// Guild League raids have Main/Sub boards; Polarity Zone raids have one board per dungeon.
export type RaidType = "guild_league" | "polarity";

export type RaidBoardKey = "main" | "sub" | "star" | "normal1" | "normal2" | "normal3" | "normal4";

export interface RaidSummary {
  id: number;
  name: string;
  type: RaidType;
  // Only the boards this raid's type has.
  partyCounts: Partial<Record<RaidBoardKey, number>>;
  created_at: string;
  updated_at: string;
}

export interface RaidBoard {
  parties: (Player | null)[][];
  partyNames: (string | null)[];
}

export interface RaidDetail extends Omit<RaidSummary, "partyCounts"> {
  boards: Partial<Record<RaidBoardKey, RaidBoard>>;
  notes: string | null;
  notes_updated_at: string | null;
}

export type LeagueResult = "victory" | "defeat";

// Which battlefield an uploaded battle record is from.
export type LeagueField = "main" | "sub";

export interface League {
  id: number;
  date: string;
  field: LeagueField;
  opponent: string | null;
  result: LeagueResult | null;
  participants: number | null;
  total_kills: number | null;
  towers: number | null;
  recorded: number;
}

export type LeagueStatKey =
  | "kills"
  | "assists"
  | "playerDamage"
  | "buildingDamage"
  | "heal"
  | "endure"
  | "deaths"
  | "revives"
  | "monsters"
  | "flagRepairs"
  | "bossKills"
  | "bossDamage";

// One player's line in a battle record. null = not recorded (leagues imported
// before the .xlsx export added that column).
export type LeagueStatLine = { [K in LeagueStatKey]: number | null };

export interface LeaguePlayerStat extends LeagueStatLine {
  playerId: number;
  rosterIgn: string;
  class: string | null;
  ign: string;
  job: string | null;
}

export interface LeagueDetail extends Omit<League, "recorded"> {
  stats: LeaguePlayerStat[];
}

// One row of the battle-record .xlsx, as text.
export type RawLeagueRow = { guild: string; ign: string; job: string } & { [K in LeagueStatKey]: string };

// One of our guild's battle-record rows, with the roster player it was matched to.
export interface LeaguePreviewRow extends LeagueStatLine {
  ign: string;
  job: string | null;
  playerId: number | null;
  error: string | null;
}

export interface LeagueSaveRow extends LeagueStatLine {
  playerId: number;
  ign: string;
  job: string | null;
}

export interface TrackerFieldSummary {
  played: number;
  totals: LeagueStatLine;
  averages: LeagueStatLine;
}

export interface TrackerHistoryLine extends LeagueStatLine {
  leagueId: number;
  date: string;
  field: LeagueField;
  opponent: string | null;
  ign: string;
  job: string | null;
}

export interface TrackerPlayer {
  id: number;
  ign: string;
  class: string | null;
  active: number;
  // Guild league dates attended, in either field.
  attended: number;
  missedLatest: boolean;
  lastAttended: string | null;
  fields: Record<LeagueField, TrackerFieldSummary>;
  history: TrackerHistoryLine[];
}

export interface TrackerData {
  leagueDates: number;
  fieldCounts: Record<LeagueField, number>;
  players: TrackerPlayer[];
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
}

// Support roles the raid builder can auto-assign one of per party.
export type AutoAssignRole = "priest" | "clown_gypsy";

// Party numbers (1-based) are listed for parties auto-assign couldn't fill.
export interface AutoAssignResult {
  raid: RaidDetail;
  assigned: number;
  full: number[];
  noneLeft: number[];
}

// Parties (1-based) that auto-assign couldn't complete, with what each still lacks.
export interface AutoAssignPartiesResult {
  raid: RaidDetail;
  assigned: number;
  incomplete: { party: number; missing: string[] }[];
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

// The guild the current invite code opened.
export interface Guild {
  id: number;
  name: string;
  // The guild turned on "Sync with Discord" in Guild settings.
  discordSyncEnabled: boolean;
  discordGuildId: string | null;
  // The site has a Discord bot token configured.
  discordBotAvailable: boolean;
  // Bot token and this guild's server ID are both set, so "Sync with Discord" works.
  discordReady: boolean;
}

// A guild as the site admin page lists it.
export interface AdminGuild {
  id: number;
  name: string;
  inviteCode: string;
  // Set only while the guild has Discord sync turned on.
  discordGuildId: string | null;
  createdAt: string;
  activePlayers: number;
  raids: number;
}
