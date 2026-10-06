import type { RaidBoardKey, RaidType } from "../types";

export interface BoardInfo {
  key: RaidBoardKey;
  label: string;
  // Party count a new raid starts with on this board; boards without one use the
  // count chosen in the create form. Mirrors the server's PRESET_PARTY_COUNTS.
  presetParties?: number;
}

export const RAID_TYPE_LABELS: Record<RaidType, string> = {
  guild_league: "Guild League",
  polarity: "Polarity Zone",
};

// The boards (tabs) each raid type has, in tab order. Mirrors the server's RAID_TYPE_BOARDS.
export const RAID_TYPE_BOARDS: Record<RaidType, BoardInfo[]> = {
  guild_league: [
    { key: "main", label: "Main" },
    { key: "sub", label: "Sub" },
  ],
  polarity: [
    { key: "star", label: "Star Dungeon", presetParties: 10 },
    { key: "normal1", label: "Normal Dungeon 1", presetParties: 5 },
    { key: "normal2", label: "Normal Dungeon 2", presetParties: 5 },
    { key: "normal3", label: "Normal Dungeon 3", presetParties: 5 },
    { key: "normal4", label: "Normal Dungeon 4", presetParties: 5 },
  ],
};

export function boardLabel(key: RaidBoardKey) {
  return Object.values(RAID_TYPE_BOARDS).flat().find((b) => b.key === key)?.label ?? key;
}
