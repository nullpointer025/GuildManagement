import { Router } from "express";
import multer from "multer";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";
import { parseLeagueCsv, parseLeagueRows, parseStat } from "../leagueImport.js";
import { readBattleRecordImages } from "../leagueOcr.js";
import { createRosterMatcher } from "../nameMatch.js";

export const leaguesRouter = Router();
leaguesRouter.use(requireAccess);

const RESULTS = ["victory", "defeat"];
const MAX_SCREENSHOTS = 20;
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: MAX_SCREENSHOTS } });

function optionalCount(value) {
  if (value == null || value === "") return { ok: true, value: null };
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? { ok: true, value: n } : { ok: false };
}

// Suggests the roster player for each parsed row. Nothing is saved — the officer
// reviews and corrects the rows first.
function previewRows(rows) {
  const matchPlayer = createRosterMatcher(db.prepare("SELECT id, ign, active FROM players").all());
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
leaguesRouter.post("/preview", (req, res) => {
  let rows;
  try {
    rows = parseLeagueCsv(req.body?.csv);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Couldn't read the CSV" });
  }
  res.json({ rows: previewRows(rows) });
});

// Reads the battle-record screenshots with OCR, in upload order.
leaguesRouter.post("/preview-images", (req, res, next) => {
  upload.array("images", MAX_SCREENSHOTS)(req, res, async (err) => {
    if (err) {
      const tooMany = err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE";
      return res.status(400).json({
        error: tooMany ? `Upload at most ${MAX_SCREENSHOTS} screenshots` : err.code === "LIMIT_FILE_SIZE" ? "Each screenshot must be under 10 MB" : "Couldn't upload the screenshots",
      });
    }
    const files = req.files ?? [];
    if (files.length === 0) return res.status(400).json({ error: "Add at least one screenshot" });
    if (files.some((f) => !/^image\/(png|jpeg|webp)$/.test(f.mimetype))) {
      return res.status(400).json({ error: "Screenshots must be PNG, JPG or WebP images" });
    }
    try {
      const rows = parseLeagueRows(await readBattleRecordImages(files.map((f) => f.buffer)));
      if (rows.length === 0) {
        return res.status(400).json({ error: "No player rows found in the screenshots — try sharper, uncropped screenshots or use the CSV instead" });
      }
      res.json({ rows: previewRows(rows) });
    } catch (e) {
      next(e);
    }
  });
});

leaguesRouter.post("/", (req, res) => {
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
  const findPlayer = db.prepare("SELECT id FROM players WHERE id = ?");
  const parsed = [];
  for (const r of rows) {
    const ign = typeof r?.ign === "string" ? r.ign.trim() : "";
    if (!Number.isInteger(r?.playerId) || !findPlayer.get(r.playerId)) {
      return res.status(400).json({ error: `Pick a roster player for "${ign || "?"}"` });
    }
    const stats = ["kills", "assists", "playerDamage", "buildingDamage"].map((k) => parseStat(r[k]));
    if (stats.some((s) => s == null)) return res.status(400).json({ error: `Check the numbers for "${ign}"` });
    parsed.push({ playerId: r.playerId, ign: ign || "?", stats });
  }
  if (new Set(parsed.map((p) => p.playerId)).size !== parsed.length) {
    return res.status(400).json({ error: "The same roster player is picked for two rows" });
  }

  const id = transaction(() => {
    const info = db
      .prepare("INSERT INTO guild_leagues (date, result, participants, total_kills, towers) VALUES (?, ?, ?, ?, ?)")
      .run(body.date, result, ...counts.map((c) => c.value));
    const insert = db.prepare(
      `INSERT INTO guild_league_stats (league_id, player_id, ign, kills, assists, player_damage, building_damage)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const p of parsed) insert.run(info.lastInsertRowid, p.playerId, p.ign, ...p.stats);
    return info.lastInsertRowid;
  })();

  res.status(201).json({ id });
});

leaguesRouter.get("/", (req, res) => {
  const leagues = db
    .prepare(
      `SELECT l.*, COUNT(s.player_id) AS recorded
       FROM guild_leagues l LEFT JOIN guild_league_stats s ON s.league_id = l.id
       GROUP BY l.id ORDER BY l.date DESC, l.id DESC`
    )
    .all();
  res.json({ leagues });
});

// Per-player attendance and stats across every recorded league. Covers everyone
// still in the guild, plus anyone who has left but has league history.
leaguesRouter.get("/tracker", (req, res) => {
  const leagues = db.prepare("SELECT id, date FROM guild_leagues ORDER BY date DESC, id DESC").all();
  const dateOf = new Map(leagues.map((l) => [l.id, l.date]));
  const order = new Map(leagues.map((l, i) => [l.id, i]));
  const stats = db.prepare("SELECT * FROM guild_league_stats").all();
  const byPlayer = new Map();
  for (const s of stats) {
    if (!byPlayer.has(s.player_id)) byPlayer.set(s.player_id, []);
    byPlayer.get(s.player_id).push(s);
  }

  const players = db
    .prepare("SELECT id, ign, class, active FROM players")
    .all()
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

leaguesRouter.get("/:id", (req, res) => {
  const league = db.prepare("SELECT * FROM guild_leagues WHERE id = ?").get(Number(req.params.id));
  if (!league) return res.status(404).json({ error: "League not found" });
  const stats = db
    .prepare(
      `SELECT s.player_id AS playerId, p.ign AS rosterIgn, p.class, s.ign, s.kills, s.assists,
              s.player_damage AS playerDamage, s.building_damage AS buildingDamage
       FROM guild_league_stats s JOIN players p ON p.id = s.player_id
       WHERE s.league_id = ? ORDER BY s.kills DESC`
    )
    .all(league.id);
  res.json({ league: { ...league, stats } });
});

leaguesRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM guild_leagues WHERE id = ?").run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "League not found" });
  res.json({ ok: true });
});
