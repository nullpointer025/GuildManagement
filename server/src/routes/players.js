import { Router } from "express";
import multer from "multer";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";
import { parsePlayersCsv } from "../csvImport.js";
import {
  DiscordError,
  discordConfigured,
  fetchGuildMembers,
  memberNames,
  nameContainsIgn,
  normalizeName,
} from "../discord.js";

export const playersRouter = Router();
playersRouter.use(requireAccess);

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

playersRouter.get("/", (req, res) => {
  const players = db
    .prepare(
      `SELECT * FROM players ORDER BY active DESC, gear_score IS NULL, gear_score DESC, ign COLLATE NOCASE ASC`
    )
    .all();
  res.json({ players });
});

playersRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const player = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
  if (!player) return res.status(404).json({ error: "Player not found" });

  const allowed = ["active", "title", "position", "in_discord", "ultimate"];
  const flags = ["in_discord", "ultimate"];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in (req.body ?? {})) {
      updates.push(`${key} = ?`);
      values.push(flags.includes(key) ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }
  values.push(id);
  db.prepare(
    `UPDATE players SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ?`
  ).run(...values);

  const updated = db.prepare("SELECT * FROM players WHERE id = ?").get(id);
  res.json({ player: updated });
});

playersRouter.post("/import", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No CSV file uploaded" });
  }

  let records;
  try {
    const text = req.file.buffer.toString("utf-8");
    records = parsePlayersCsv(text);
  } catch (err) {
    return res.status(400).json({ error: err.message || "Failed to parse CSV" });
  }

  if (records.length === 0) {
    return res.status(400).json({ error: "No player rows found in CSV" });
  }

  const findByIgn = db.prepare("SELECT id FROM players WHERE ign = ?");
  const insertStmt = db.prepare(`
    INSERT INTO players
      (ign, level, class, title, gender, position, gear_score, weekly, weekly_contribution, total_contribution, online_status, active, last_imported_at)
    VALUES
      (@ign, @level, @class, @title, @gender, @position, @gear_score, @weekly, @weekly_contribution, @total_contribution, @online_status, 1, datetime('now'))
  `);
  const updateStmt = db.prepare(`
    UPDATE players SET
      level = @level, class = @class, title = @title, gender = @gender, position = @position,
      gear_score = @gear_score, weekly = @weekly, weekly_contribution = @weekly_contribution,
      total_contribution = @total_contribution, online_status = @online_status,
      active = 1, last_imported_at = datetime('now'), updated_at = datetime('now')
    WHERE id = @id
  `);
  const deactivateAllStmt = db.prepare(`UPDATE players SET active = 0, updated_at = datetime('now') WHERE active = 1`);

  let added = 0;
  let updated = 0;

  const importTxn = transaction((rows) => {
    deactivateAllStmt.run();
    for (const row of rows) {
      const existing = findByIgn.get(row.ign);
      const payload = {
        ign: row.ign,
        level: row.level ?? null,
        class: row.class ?? null,
        title: row.title ?? null,
        gender: row.gender ?? null,
        position: row.position ?? null,
        gear_score: row.gear_score ?? null,
        weekly: row.weekly ?? null,
        weekly_contribution: row.weekly_contribution ?? null,
        total_contribution: row.total_contribution ?? null,
        online_status: row.online_status ?? null,
      };
      if (existing) {
        // node:sqlite rejects named params the statement doesn't reference, so drop ign.
        const { ign: _ign, ...fields } = payload;
        updateStmt.run({ ...fields, id: existing.id });
        updated++;
      } else {
        insertStmt.run(payload);
        added++;
      }
    }
  });

  importTxn(records);

  const removed = db.prepare("SELECT COUNT(*) AS n FROM players WHERE active = 0").get().n;
  const total = db.prepare("SELECT COUNT(*) AS n FROM players WHERE active = 1").get().n;

  res.json({
    summary: { added, updated, flaggedInactive: removed, activeTotal: total },
  });
});

// Re-checks every player against the guild Discord server's member list (IGN found
// as a whole word in a nickname, display name or username) and sets in_discord accordingly — overwriting any manual ticks with what Discord reports.
playersRouter.post("/discord-sync", async (req, res, next) => {
  if (!discordConfigured()) {
    return res
      .status(503)
      .json({ error: "Discord isn't set up — add DISCORD_BOT_TOKEN and DISCORD_GUILD_ID to the server env" });
  }

  try {
    const members = await fetchGuildMembers();

    const discordNames = [
      ...new Set(members.flatMap((m) => memberNames(m).map(normalizeName)).filter(Boolean)),
    ];

    const players = db.prepare("SELECT id, ign, active FROM players").all();
    const setStmt = db.prepare("UPDATE players SET in_discord = ?, updated_at = datetime('now') WHERE id = ?");
    let matched = 0;
    let missing = 0;
    transaction(() => {
      for (const p of players) {
        const ign = normalizeName(p.ign);
        const inDiscord = discordNames.some((name) => nameContainsIgn(name, ign));
        setStmt.run(inDiscord ? 1 : 0, p.id);
        if (p.active === 1) inDiscord ? matched++ : missing++;
      }
    })();

    res.json({ summary: { matched, missing, discordMembers: members.length } });
  } catch (err) {
    // Express 4 doesn't catch async handler errors on its own.
    if (err instanceof DiscordError) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});
