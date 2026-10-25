import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";
import { parseLeagueCsv, parseLeagueRows, parseStat } from "../leagueImport.js";
import { createRosterMatcher } from "../nameMatch.js";

export const leaguesRouter = Router();
leaguesRouter.use(requireAccess);

const RESULTS = ["victory", "defeat"];
const MAX_OCR_ROWS = 2000;

function optionalCount(value) {
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

// Suggests the roster player for each parsed row. Nothing is saved — the officer
// reviews and corrects the rows first.
async function previewRows(rows) {
  const matchPlayer = createRosterMatcher(await db.all("SELECT id, ign, active FROM players"));
  return rows.map((r) => ({
    ign: r.ign,
    kills: r.kills,
    assists: r.assists,
    playerDamage: r.player_damage,
    buildingDamage: r.building_damage,
    playerId: matchPlayer(r.ign),
    error: r.error,
  }));
}

// Parses a pasted/uploaded battle-record CSV.
leaguesRouter.post("/preview", async (req, res) => {
  let rows;
  try {
    rows = parseLeagueCsv(req.body?.csv);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Couldn't read the CSV" });
  }
  res.json({ rows: await previewRows(rows) });
});

// Takes the raw rows the browser read from the battle-record screenshots with OCR
// (see client/src/lib/leagueOcr.ts) and matches them to the roster.
leaguesRouter.post("/preview-ocr", async (req, res) => {
  const raw = req.body?.rows;
  if (!Array.isArray(raw) || raw.length > MAX_OCR_ROWS) {
    return res.status(400).json({ error: "Couldn't read the screenshots" });
  }
  const rows = parseLeagueRows(raw.filter((r) => r && typeof r === "object"));
  if (rows.length === 0) {
    return res.status(400).json({ error: "No player rows found in the screenshots — try sharper, uncropped screenshots or use the CSV instead" });
  }
  res.json({ rows: await previewRows(rows) });
});

leaguesRouter.post("/", async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return res.status(400).json({ error: "Pick the league date" });
  }
  const result = body.result || null;
  if (result != null && !RESULTS.includes(result)) return res.status(400).json({ error: "Invalid result" });
  const counts = ["participants", "totalKills", "towers"].map((k) => optionalCount(body[k]));
  if (counts.some((c) => !c.ok)) {
    return res.status(400).json({ error: "Participants, kills and towers must be whole numbers" });
  }

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: "No players to save" });
  const known = new Set((await db.all("SELECT id FROM players")).map((p) => p.id));
  const parsed = [];
  for (const r of rows) {
    const ign = typeof r?.ign === "string" ? r.ign.trim() : "";
    if (!Number.isInteger(r?.playerId) || !known.has(r.playerId)) {
      return res.status(400).json({ error: `Pick a roster player for "${ign || "?"}"` });
    }
    const stats = ["kills", "assists", "playerDamage", "buildingDamage"].map((k) => parseStat(r[k]));
    if (stats.some((s) => s == null)) return res.status(400).json({ error: `Check the numbers for "${ign}"` });
    parsed.push({ playerId: r.playerId, ign: ign || "?", stats });
  }
  if (new Set(parsed.map((p) => p.playerId)).size !== parsed.length) {
    return res.status(400).json({ error: "The same roster player is picked for two rows" });
  }

  const id = await transaction(async () => {
    const info = await db.run(
      "INSERT INTO guild_leagues (date, result, participants, total_kills, towers) VALUES (?, ?, ?, ?, ?) RETURNING id",
      body.date,
      result,
      ...counts.map((c) => c.value)
    );
    const stats = parsed.map((p) => {
      const [kills, assists, player_damage, building_damage] = p.stats;
      return { player_id: p.playerId, ign: p.ign, kills, assists, player_damage, building_damage };
    });
    await db.run(
      `INSERT INTO guild_league_stats (league_id, player_id, ign, kills, assists, player_damage, building_damage)
       SELECT ?::bigint, player_id, ign, kills, assists, player_damage, building_damage
       FROM jsonb_to_recordset(?::text::jsonb) AS r(
         player_id bigint, ign text, kills bigint, assists bigint, player_damage bigint, building_damage bigint
       )`,
      info.id,
      JSON.stringify(stats)
    );
    return info.id;
  });

  res.status(201).json({ id });
});

leaguesRouter.get("/", async (req, res) => {
  const leagues = await db.all(
    `SELECT l.*, COUNT(s.player_id) AS recorded
     FROM guild_leagues l LEFT JOIN guild_league_stats s ON s.league_id = l.id
     GROUP BY l.id ORDER BY l.date DESC, l.id DESC`
  );
  res.json({ leagues });
});

// Per-player attendance and stats across every recorded league. Covers everyone
// still in the guild, plus anyone who has left but has league history.
leaguesRouter.get("/tracker", async (req, res) => {
  const [leagues, stats, allPlayers] = await Promise.all([
    db.all("SELECT id, date FROM guild_leagues ORDER BY date DESC, id DESC"),
    db.all("SELECT * FROM guild_league_stats"),
    db.all("SELECT id, ign, class, active FROM players"),
  ]);
  const dateOf = new Map(leagues.map((l) => [l.id, l.date]));
  const order = new Map(leagues.map((l, i) => [l.id, i]));
  const byPlayer = new Map();
  for (const s of stats) {
    if (!byPlayer.has(s.player_id)) byPlayer.set(s.player_id, []);
    byPlayer.get(s.player_id).push(s);
  }

  const players = allPlayers
    .filter((p) => p.active === 1 || byPlayer.has(p.id))
    .map((p) => {
      const history = (byPlayer.get(p.id) ?? [])
        .sort((a, b) => order.get(a.league_id) - order.get(b.league_id))
        .map((s) => ({
          leagueId: s.league_id,
          date: dateOf.get(s.league_id),
          ign: s.ign,
          kills: s.kills,
          assists: s.assists,
          playerDamage: s.player_damage,
          buildingDamage: s.building_damage,
        }));
      const sum = (k) => history.reduce((t, h) => t + h[k], 0);
      const avg = (k) => (history.length ? Math.round(sum(k) / history.length) : null);
      return {
        id: p.id,
        ign: p.ign,
        class: p.class,
        active: p.active,
        attended: history.length,
        missedLatest: leagues.length > 0 && !history.some((h) => h.leagueId === leagues[0].id),
        lastAttended: history[0]?.date ?? null,
        totals: { kills: sum("kills"), assists: sum("assists"), playerDamage: sum("playerDamage"), buildingDamage: sum("buildingDamage") },
        averages: { kills: avg("kills"), assists: avg("assists"), playerDamage: avg("playerDamage"), buildingDamage: avg("buildingDamage") },
        history,
      };
    });

  res.json({ leagueCount: leagues.length, players });
});

leaguesRouter.get("/:id", async (req, res) => {
  const league = await db.get("SELECT * FROM guild_leagues WHERE id = ?", Number(req.params.id));
  if (!league) return res.status(404).json({ error: "League not found" });
  // Postgres folds unquoted aliases to lower case, so the camelCase ones are quoted.
  const stats = await db.all(
    `SELECT s.player_id AS "playerId", p.ign AS "rosterIgn", p.class, s.ign, s.kills, s.assists,
            s.player_damage AS "playerDamage", s.building_damage AS "buildingDamage"
     FROM guild_league_stats s JOIN players p ON p.id = s.player_id
     WHERE s.league_id = ? ORDER BY s.kills DESC`,
    league.id
  );
  res.json({ league: { ...league, stats } });
});

leaguesRouter.delete("/:id", async (req, res) => {
  const info = await db.run("DELETE FROM guild_leagues WHERE id = ?", Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "League not found" });
  res.json({ ok: true });
});
