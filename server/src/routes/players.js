import { Router } from "express";
import multer from "multer";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";
import { parsePlayersCsv } from "../csvImport.js";
import { DiscordError, createDiscordMatcher, discordConfigured, fetchGuildMembers } from "../discord.js";

export const playersRouter = Router();
playersRouter.use(requireAccess);

// Vercel rejects request bodies over 4.5 MB, so stay under that.
const upload = multer({ limits: { fileSize: 4 * 1024 * 1024 } });

playersRouter.get("/", async (req, res) => {
  const players = await db.all(
    `SELECT * FROM players ORDER BY active DESC, gear_score IS NULL, gear_score DESC, lower(ign) ASC`
  );
  res.json({ players });
});

playersRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const player = await db.get("SELECT * FROM players WHERE id = ?", id);
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
  await db.run(`UPDATE players SET ${updates.join(", ")}, updated_at = now_text() WHERE id = ?`, ...values);

  const updated = await db.get("SELECT * FROM players WHERE id = ?", id);
  res.json({ player: updated });
});

const IMPORT_FIELDS = [
  "level",
  "class",
  "title",
  "gender",
  "position",
  "gear_score",
  "weekly",
  "weekly_contribution",
  "total_contribution",
  "online_status",
];

playersRouter.post("/import", upload.single("file"), async (req, res) => {
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

  // A repeated IGN would make the single upsert below fail; the last row wins.
  // Numeric columns are BIGINT, so round anything fractional the export contains.
  const byIgn = new Map();
  for (const row of records) {
    const values = IMPORT_FIELDS.map((f) => [f, typeof row[f] === "number" ? Math.round(row[f]) : row[f] ?? null]);
    byIgn.set(row.ign, Object.fromEntries([["ign", row.ign], ...values]));
  }

  // Everyone starts inactive; whoever is in this export is upserted back to active,
  // so missing members end up flagged instead of deleted.
  const results = await transaction(async () => {
    await db.run("UPDATE players SET active = 0, updated_at = now_text() WHERE active = 1");
    return db.all(
      `INSERT INTO players (ign, ${IMPORT_FIELDS.join(", ")}, active, last_imported_at)
       SELECT ign, ${IMPORT_FIELDS.join(", ")}, 1, now_text()
       FROM jsonb_to_recordset(?::text::jsonb) AS r(
         ign text, level bigint, class text, title text, gender text, position text, gear_score bigint,
         weekly bigint, weekly_contribution bigint, total_contribution bigint, online_status text
       )
       ON CONFLICT (ign) DO UPDATE SET
         ${IMPORT_FIELDS.map((f) => `${f} = excluded.${f}`).join(", ")},
         active = 1, last_imported_at = now_text(), updated_at = now_text()
       RETURNING (xmax = 0) AS inserted`,
      JSON.stringify([...byIgn.values()])
    );
  });

  const added = results.filter((r) => r.inserted).length;
  const updated = results.length - added;
  const counts = await db.get(
    "SELECT COUNT(*) FILTER (WHERE active = 0) AS removed, COUNT(*) FILTER (WHERE active = 1) AS total FROM players"
  );

  res.json({
    summary: { added, updated, flaggedInactive: counts.removed, activeTotal: counts.total },
  });
});

// Re-checks every player against the guild Discord server's member list (matching
// rules live in createDiscordMatcher) and sets in_discord accordingly — overwriting
// any manual ticks with what Discord reports.
playersRouter.post("/discord-sync", async (req, res) => {
  if (!discordConfigured()) {
    return res
      .status(503)
      .json({ error: "Discord isn't set up — add DISCORD_BOT_TOKEN and DISCORD_GUILD_ID to the server env" });
  }

  let members;
  try {
    members = await fetchGuildMembers();
  } catch (err) {
    if (err instanceof DiscordError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  const isInDiscord = createDiscordMatcher(members);

  const players = await db.all("SELECT id, ign, active FROM players");
  let matched = 0;
  let missing = 0;
  const flags = players.map((p) => {
    const inDiscord = isInDiscord(p.ign);
    if (p.active === 1) inDiscord ? matched++ : missing++;
    return { id: p.id, in_discord: inDiscord ? 1 : 0 };
  });

  await db.run(
    `UPDATE players p SET in_discord = r.in_discord, updated_at = now_text()
     FROM jsonb_to_recordset(?::text::jsonb) AS r(id bigint, in_discord int)
     WHERE p.id = r.id`,
    JSON.stringify(flags)
  );

  res.json({ summary: { matched, missing, discordMembers: members.length } });
});
