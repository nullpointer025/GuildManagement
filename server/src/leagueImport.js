import { normalizeName } from "./nameMatch.js";

// Every stat of a battle-record row: the API key and its guild_league_stats column.
// The first four are always in the export; the rest are stored when present.
export const LEAGUE_STATS = [
  { key: "kills", column: "kills", required: true },
  { key: "assists", column: "assists", required: true },
  { key: "playerDamage", column: "player_damage", required: true },
  { key: "buildingDamage", column: "building_damage", required: true },
  { key: "heal", column: "heal" },
  { key: "endure", column: "endure" },
  { key: "deaths", column: "deaths" },
  { key: "revives", column: "revives" },
  { key: "monsters", column: "monsters" },
  { key: "flagRepairs", column: "flag_repairs" },
  { key: "bossKills", column: "boss_kills" },
  { key: "bossDamage", column: "boss_damage" },
];

export const LEAGUE_FIELDS = ["main", "sub"];

const MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9 };
const INT32_WRAP = 2 ** 32;

// Reads a stat: 140, "1,234", "12.3M". Returns a whole number, or null when the
// value can't be read. The game export keeps some stats (e.g. Boss Damage) in a
// 32-bit counter that wraps negative past 2,147,483,647; those are unwrapped
// (-2104658936 is really 2,190,308,360).
export function parseStat(value) {
  const text = String(value ?? "").trim();
  if (/^-\d+$/.test(text) && Number(text) >= -(2 ** 31)) return Number(text) + INT32_WRAP;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const cleaned = text.replace(/[,\s]/g, "").toLowerCase();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  return Math.round(Number(match[1]) * (MULTIPLIERS[match[2]] ?? 1));
}

// Reads one row's stats. Required stats must be readable; an optional stat left
// blank is stored as null (not recorded) rather than 0.
export function parseRowStats(row) {
  const stats = {};
  let error = null;
  for (const s of LEAGUE_STATS) {
    const raw = row?.[s.key];
    if (!s.required && (raw == null || raw === "")) {
      stats[s.key] = null;
      continue;
    }
    stats[s.key] = parseStat(raw);
    if (stats[s.key] == null) error = "Couldn't read one of the numbers";
  }
  return { stats, error };
}

// Turns the raw rows of our guild ({ ign, job, ...stats } as text) into
// { ign, job, ...stats, error }. Exact duplicate rows are dropped; a repeated name
// with different numbers is kept but flagged for the officer to resolve.
export function parseLeagueRows(rawRows) {
  const result = [];
  const seen = new Map();
  for (const r of rawRows) {
    const ign = String(r?.ign ?? "").trim();
    if (!ign) continue;
    const { stats, error } = parseRowStats(r);
    const row = { ign, job: String(r.job ?? "").trim() || null, ...stats, error };

    const key = normalizeName(ign);
    const signature = LEAGUE_STATS.map((s) => stats[s.key]).join("|");
    if (seen.has(key)) {
      if (seen.get(key) === signature) continue;
      row.error = "This name appears twice with different numbers";
    } else {
      seen.set(key, signature);
    }
    result.push(row);
  }
  return result;
}
