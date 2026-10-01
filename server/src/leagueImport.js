import { parseCsv } from "./csvImport.js";
import { normalizeName } from "./nameMatch.js";

// Header names accepted for each column, so small wording differences in the CSV
// (e.g. "Kill" vs "Kills") still import.
const HEADER_MAP = {
  player: "ign",
  ign: "ign",
  name: "ign",
  kill: "kills",
  kills: "kills",
  assist: "assists",
  assists: "assists",
  "player damage": "player_damage",
  "player dmg": "player_damage",
  "building damage": "building_damage",
  "building dmg": "building_damage",
};

const STAT_FIELDS = ["kills", "assists", "player_damage", "building_damage"];
const MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9 };

// Reads a stat as the game shows it: "140", "1,234", "12.3M", "790.0M", "5K".
// Returns a whole number, or null when the value can't be read.
export function parseStat(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
  const cleaned = String(value ?? "").replace(/[,\s]/g, "").toLowerCase();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!match) return null;
  return Math.round(Number(match[1]) * (MULTIPLIERS[match[2]] ?? 1));
}

// Parses a battle-record CSV (any number of rows) into rows from parseLeagueRows.
export function parseLeagueCsv(text) {
  const rows = parseCsv(String(text ?? "").replace(/^\uFEFF/, ""));
  if (rows.length === 0) throw new Error("The CSV is empty");

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  header.forEach((h, i) => {
    const field = HEADER_MAP[h];
    if (field && idx[field] == null) idx[field] = i;
  });
  const missing = ["ign", ...STAT_FIELDS].filter((f) => idx[f] == null);
  if (missing.length > 0) {
    throw new Error("The CSV header must be: Player,Kill,Assist,Player Damage,Building Damage");
  }

  const rawRows = rows.slice(1).map((r) => ({
    ign: r[idx.ign],
    kills: r[idx.kills],
    assists: r[idx.assists],
    player_damage: r[idx.player_damage],
    building_damage: r[idx.building_damage],
  }));
  const result = parseLeagueRows(rawRows);
  if (result.length === 0) throw new Error("No player rows found in the CSV");
  return result;
}

// Turns raw rows ({ ign, kills, assists, player_damage, building_damage } as text)
// from the CSV or from screenshots into
// { ign, kills, assists, player_damage, building_damage, error }.
// Exact duplicate rows (e.g. from overlapping screenshots) are dropped; a repeated
// name with different numbers is kept but flagged for the officer to resolve.
export function parseLeagueRows(rawRows) {
  const result = [];
  const seen = new Map();
  for (const r of rawRows) {
    const ign = String(r.ign ?? "").trim();
    if (!ign) continue;
    const row = { ign, error: null };
    for (const f of STAT_FIELDS) row[f] = parseStat(r[f]);
    if (STAT_FIELDS.some((f) => row[f] == null)) row.error = "Couldn't read one of the numbers";

    const key = normalizeName(ign);
    const signature = STAT_FIELDS.map((f) => row[f]).join("|");
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
