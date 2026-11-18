import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";
import { LEAGUE_FIELDS, LEAGUE_STATS, parseLeagueRows, parseRowStats } from "../leagueImport.js";
import { createRosterMatcher } from "../nameMatch.js";

export const leaguesRouter = Router();
leaguesRouter.use(requireAccess);

const RESULTS = ["victory", "defeat"];
const MAX_ROWS = 2000;

// guild_league_stats columns as camelCase API keys. Postgres folds unquoted
// aliases to lower case, so they're quoted.
const STAT_SELECT = LEAGUE_STATS.map((s) => `s.${s.column} AS "${s.key}"`).join(", ");

function optionalCount(value) {
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

// Takes our guild's rows the browser read from the battle-record .xlsx (see
// client/src/lib/battleRecord.ts) and suggests the roster player for each. Nothing
// is saved — the officer reviews and corrects the matches first.
leaguesRouter.post("/preview", async (req, res) => {
  const raw = req.body?.rows;
  if (!Array.isArray(raw) || raw.length > MAX_ROWS) {
    return res.status(400).json({ error: "Couldn't read the battle record" });
  }
  const rows = parseLeagueRows(raw.filter((r) => r && typeof r === "object"));
  if (rows.length === 0) return res.status(400).json({ error: "No player rows found for your guild" });

  const matchPlayer = createRosterMatcher(
    await db.all("SELECT id, ign, active FROM players WHERE guild_id = ?", req.guild.id)
  );
  res.json({ rows: rows.map((r) => ({ ...r, playerId: matchPlayer(r.ign) })) });
});

leaguesRouter.post("/", async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return res.status(400).json({ error: "Pick the league date" });
  }
  if (!LEAGUE_FIELDS.includes(body.field)) {
    return res.status(400).json({ error: "Pick whether this battle record is from the Main or the Sub field" });
  }
  const result = body.result || null;
  if (result != null && !RESULTS.includes(result)) return res.status(400).json({ error: "Invalid result" });
  const counts = ["participants", "totalKills", "towers"].map((k) => optionalCount(body[k]));
  if (counts.some((c) => !c.ok)) {
    return res.status(400).json({ error: "Participants, kills and towers must be whole numbers" });
  }
  const opponent = typeof body.opponent === "string" ? body.opponent.trim().slice(0, 100) || null : null;

  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0) return res.status(400).json({ error: "No players to save" });
  if (rows.length > MAX_ROWS) return res.status(400).json({ error: "Too many rows" });
  const known = new Set(
    (await db.all("SELECT id FROM players WHERE guild_id = ?", req.guild.id)).map((p) => p.id)
  );
  const parsed = [];
  for (const r of rows) {
    const ign = typeof r?.ign === "string" ? r.ign.trim() : "";
    if (!Number.isInteger(r?.playerId) || !known.has(r.playerId)) {
      return res.status(400).json({ error: `Pick a roster player for "${ign || "?"}"` });
    }
    const { stats, error } = parseRowStats(r);
    if (error) return res.status(400).json({ error: `Check the numbers for "${ign}"` });
    const job = typeof r.job === "string" ? r.job.trim().slice(0, 50) || null : null;
    parsed.push({ player_id: r.playerId, ign: ign || "?", job, ...stats });
  }
  if (new Set(parsed.map((p) => p.player_id)).size !== parsed.length) {
    return res.status(400).json({ error: "The same roster player is picked for two rows" });
  }

  const existing = await db.get(
    "SELECT id FROM guild_leagues WHERE guild_id = ? AND date = ? AND field = ?",
    req.guild.id,
    body.date,
    body.field
  );
  if (existing) {
    return res.status(409).json({
      error: `A ${body.field === "main" ? "Main" : "Sub"} field league on this date is already saved — delete it first to replace it`,
    });
  }

  const id = await transaction(async () => {
    const info = await db.run(
      `INSERT INTO guild_leagues (guild_id, date, field, opponent, result, participants, total_kills, towers)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      req.guild.id,
      body.date,
      body.field,
      opponent,
      result,
      ...counts.map((c) => c.value)
    );
    const statRows = parsed.map((p) => {
      const row = { player_id: p.player_id, ign: p.ign, job: p.job };
      for (const s of LEAGUE_STATS) row[s.column] = p[s.key];
      return row;
    });
    const columns = LEAGUE_STATS.map((s) => s.column);
    await db.run(
      `INSERT INTO guild_league_stats (league_id, player_id, ign, job, ${columns.join(", ")})
       SELECT ?::bigint, player_id, ign, job, ${columns.join(", ")}
       FROM jsonb_to_recordset(?::text::jsonb) AS r(
         player_id bigint, ign text, job text, ${columns.map((c) => `${c} bigint`).join(", ")}
       )`,
      info.id,
      JSON.stringify(statRows)
    );
    return info.id;
  });

  res.status(201).json({ id });
});

leaguesRouter.get("/", async (req, res) => {
  const leagues = await db.all(
    `SELECT l.*, COUNT(s.player_id) AS recorded
     FROM guild_leagues l LEFT JOIN guild_league_stats s ON s.league_id = l.id
     WHERE l.guild_id = ?
     GROUP BY l.id ORDER BY l.date DESC, l.field ASC, l.id DESC`,
    req.guild.id
  );
  res.json({ leagues });
});

// Totals and per-league averages of one field's history. A stat that wasn't
// recorded (null) is left out rather than counted as 0. Small counts keep one
// decimal so an average of 2.4 deaths doesn't read as 2.
function summarize(history) {
  const totals = {};
  const averages = {};
  for (const { key } of LEAGUE_STATS) {
    const values = history.map((h) => h[key]).filter((v) => v != null);
    const sum = values.reduce((t, v) => t + v, 0);
    totals[key] = values.length ? sum : null;
    averages[key] = values.length ? Math.round((sum / values.length) * 10) / 10 : null;
  }
  return { played: history.length, totals, averages };
}

// Per-player attendance and stats. Attendance counts guild league dates (Main or
// Sub, either one counts); stats are kept apart per field. Covers everyone still in
// the guild, plus anyone who has left but has league history.
leaguesRouter.get("/tracker", async (req, res) => {
  const leagues = await db.all(
    "SELECT id, date, field, opponent FROM guild_leagues WHERE guild_id = ? ORDER BY date DESC, field ASC, id DESC",
    req.guild.id
  );
  const stats = await db.all(
    `SELECT s.league_id, s.player_id, s.ign, s.job, ${STAT_SELECT}
     FROM guild_league_stats s JOIN guild_leagues l ON l.id = s.league_id WHERE l.guild_id = ?`,
    req.guild.id
  );
  const allPlayers = await db.all("SELECT id, ign, class, active FROM players WHERE guild_id = ?", req.guild.id);

  const leagueById = new Map(leagues.map((l, i) => [l.id, { ...l, order: i }]));
  const dates = [...new Set(leagues.map((l) => l.date))];
  const latestDate = dates[0];
  const byPlayer = new Map();
  for (const s of stats) {
    if (!byPlayer.has(s.player_id)) byPlayer.set(s.player_id, []);
    byPlayer.get(s.player_id).push(s);
  }

  const players = allPlayers
    .filter((p) => p.active === 1 || byPlayer.has(p.id))
    .map((p) => {
      const history = (byPlayer.get(p.id) ?? [])
        .sort((a, b) => leagueById.get(a.league_id).order - leagueById.get(b.league_id).order)
        .map(({ league_id, player_id, ...line }) => {
          const league = leagueById.get(league_id);
          return { leagueId: league_id, date: league.date, field: league.field, opponent: league.opponent, ...line };
        });
      const attendedDates = new Set(history.map((h) => h.date));
      return {
        id: p.id,
        ign: p.ign,
        class: p.class,
        active: p.active,
        attended: attendedDates.size,
        missedLatest: latestDate != null && !attendedDates.has(latestDate),
        lastAttended: history[0]?.date ?? null,
        fields: {
          main: summarize(history.filter((h) => h.field === "main")),
          sub: summarize(history.filter((h) => h.field === "sub")),
        },
        history,
      };
    });

  res.json({
    leagueDates: dates.length,
    fieldCounts: {
      main: leagues.filter((l) => l.field === "main").length,
      sub: leagues.filter((l) => l.field === "sub").length,
    },
    players,
  });
});

leaguesRouter.get("/:id", async (req, res) => {
  const league = await db.get(
    "SELECT * FROM guild_leagues WHERE id = ? AND guild_id = ?",
    Number(req.params.id),
    req.guild.id
  );
  if (!league) return res.status(404).json({ error: "League not found" });
  const stats = await db.all(
    `SELECT s.player_id AS "playerId", p.ign AS "rosterIgn", p.class, s.ign, s.job, ${STAT_SELECT}
     FROM guild_league_stats s JOIN players p ON p.id = s.player_id
     WHERE s.league_id = ? ORDER BY s.kills DESC`,
    league.id
  );
  res.json({ league: { ...league, stats } });
});

leaguesRouter.delete("/:id", async (req, res) => {
  const info = await db.run(
    "DELETE FROM guild_leagues WHERE id = ? AND guild_id = ?",
    Number(req.params.id),
    req.guild.id
  );
  if (info.changes === 0) return res.status(404).json({ error: "League not found" });
  res.json({ ok: true });
});
