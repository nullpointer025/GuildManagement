import type { LeagueStatKey, RawLeagueRow } from "../types";
import { readFirstSheet } from "./xlsx";

// Every stat column of the battle-record export, in the order the export lists them.
export const LEAGUE_STATS: { key: LeagueStatKey; label: string; short: string; big?: boolean }[] = [
  { key: "kills", label: "Kills", short: "K" },
  { key: "assists", label: "Assists", short: "A" },
  { key: "playerDamage", label: "Player Damage", short: "Player Dmg", big: true },
  { key: "buildingDamage", label: "Building Damage", short: "Building Dmg", big: true },
  { key: "heal", label: "Heal", short: "Heal", big: true },
  { key: "endure", label: "Endure", short: "Endure", big: true },
  { key: "deaths", label: "Deaths", short: "Deaths" },
  { key: "revives", label: "Revives", short: "Revives" },
  { key: "monsters", label: "Monsters", short: "Monsters" },
  { key: "flagRepairs", label: "Flag Repairs", short: "Flag Rep." },
  { key: "bossKills", label: "Boss Kills", short: "Boss Kills" },
  { key: "bossDamage", label: "Boss Damage", short: "Boss Dmg", big: true },
];

// Header text in the export -> field. Singular and plural both work ("Kill", "Kills").
const HEADERS: Record<string, keyof RawLeagueRow> = {
  guild: "guild",
  "guild name": "guild",
  player: "ign",
  name: "ign",
  ign: "ign",
  job: "job",
  class: "job",
  kill: "kills",
  assist: "assists",
  "player damage": "playerDamage",
  "player dmg": "playerDamage",
  "building damage": "buildingDamage",
  "building dmg": "buildingDamage",
  heal: "heal",
  healing: "heal",
  endure: "endure",
  death: "deaths",
  revive: "revives",
  monster: "monsters",
  "flag repair": "flagRepairs",
  "boss kill": "bossKills",
  "boss damage": "bossDamage",
  "boss dmg": "bossDamage",
};

function fieldFor(header: string): keyof RawLeagueRow | undefined {
  const h = header.trim().toLowerCase().replace(/\s+/g, " ");
  return HEADERS[h] ?? HEADERS[h.replace(/s$/, "")];
}

// Reads the battle-record export (.xlsx or .csv, one row per player of both guilds).
export async function readBattleRecordFile(file: File): Promise<RawLeagueRow[]> {
  if (/\.csv$/i.test(file.name)) return readBattleRecordText(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Pick the battle-record export (.xlsx or .csv)");
  return rowsFromSheet(await readFirstSheet(file));
}

// Reads the battle record copied to the clipboard: the exporter's copy, or cells
// copied from Excel/Sheets. Both are tab-separated; comma-separated text works too.
export function readBattleRecordText(text: string): RawLeagueRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new Error("Nothing to read — paste the battle record first");
  const separator = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  return rowsFromSheet(lines.map((l) => splitLine(l, separator)));
}

// Splits one line, honoring "quoted cells" (a quoted cell may contain the separator).
function splitLine(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

function rowsFromSheet(sheet: string[][]): RawLeagueRow[] {
  const headerAt = sheet.findIndex((r) => {
    const fields = r.map(fieldFor);
    return fields.includes("guild") && fields.includes("ign");
  });
  if (headerAt < 0) throw new Error("Couldn't find the header row — it needs at least Guild and Player columns");

  const columns = new Map<keyof RawLeagueRow, number>();
  sheet[headerAt].forEach((h, i) => {
    const field = fieldFor(h);
    if (field && !columns.has(field)) columns.set(field, i);
  });
  const missing = (["kills", "assists", "playerDamage", "buildingDamage"] as const).filter((k) => !columns.has(k));
  if (missing.length > 0) {
    throw new Error(`The battle record is missing the ${missing.map((k) => LEAGUE_STATS.find((s) => s.key === k)!.label).join(", ")} column`);
  }

  const rows: RawLeagueRow[] = [];
  for (const r of sheet.slice(headerAt + 1)) {
    const row = {} as RawLeagueRow;
    for (const [field, i] of columns) row[field] = (r[i] ?? "").trim();
    if (row.ign && row.guild) rows.push(row);
  }
  if (rows.length === 0) throw new Error("No player rows found in the battle record");
  return rows;
}

const normalize = (s: string) => s.normalize("NFKC").trim().toLowerCase();

// The guilds in the file with how many rows each has, biggest first. The one named
// like this app's guild is suggested as ours.
export function guildsInFile(rows: RawLeagueRow[], ourGuildName: string | undefined) {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.guild, (counts.get(r.guild) ?? 0) + 1);
  const guilds = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const ours = ourGuildName ? guilds.find((g) => normalize(g.name) === normalize(ourGuildName)) : undefined;
  return { guilds, suggested: ours?.name ?? null };
}
