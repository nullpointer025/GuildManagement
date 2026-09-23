import { Router } from "express";
import multer from "multer";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";
import { parsePlayersCsv } from "../csvImport.js";

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

  const allowed = ["active", "title", "position"];
  const updates = [];
  const values = [];
  for (const key of allowed) {
    if (key in (req.body ?? {})) {
      updates.push(`${key} = ?`);
      values.push(req.body[key]);
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
