import { Router } from "express";
import multer from "multer";
import { db, transaction } from "../db.js";
import { requireAccess, officerWrites } from "../auth.js";
import { parsePlayersCsv } from "../csvImport.js";
import { linkPendingLeagueStats, renamePlayersFromLeagueNames } from "../leagueRoster.js";
import { DiscordError, createDiscordMatcher, discordConfigured, fetchGuildMembers } from "../discord.js";

export const playersRouter = Router();
playersRouter.use(requireAccess);
// Viewers can look but not change anything.
playersRouter.use(officerWrites);

// Vercel rejects request bodies over 4.5 MB, so stay under that.
const upload = multer({ limits: { fileSize: 4 * 1024 * 1024 } });

playersRouter.get("/", async (req, res) => {
  const players = await db.all(
    `SELECT * FROM players WHERE guild_id = ? ORDER BY active DESC, gear_score IS NULL, gear_score DESC, lower(ign) ASC`,
    req.guild.id
  );
  res.json({ players });
});

playersRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const player = await db.get("SELECT * FROM players WHERE id = ? AND guild_id = ?", id, req.guild.id);
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
  values.push(id, req.guild.id);
  await db.run(
    `UPDATE players SET ${updates.join(", ")}, updated_at = now_text() WHERE id = ? AND guild_id = ?`,
    ...values
  );

  const updated = await db.get("SELECT * FROM players WHERE id = ? AND guild_id = ?", id, req.guild.id);
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

  // Renamed players are renamed first so the upsert finds them. Everyone then starts
  // inactive; whoever is in this export is upserted back to active, so missing
  // members end up flagged instead of deleted. Finally, guild league rows of players
  // who weren't in the roster yet are linked to them.
  const { results, renamed, leagueRowsLinked } = await transaction(async () => {
    const renamed = await renamePlayersFromLeagueNames(req.guild.id, [...byIgn.keys()]);
    await db.run(
      "UPDATE players SET active = 0, updated_at = now_text() WHERE active = 1 AND guild_id = ?",
      req.guild.id
    );
    const results = await db.all(
      `INSERT INTO players (guild_id, ign, ${IMPORT_FIELDS.join(", ")}, active, last_imported_at)
       SELECT ?::bigint, ign, ${IMPORT_FIELDS.join(", ")}, 1, now_text()
       FROM jsonb_to_recordset(?::text::jsonb) AS r(
         ign text, level bigint, class text, title text, gender text, position text, gear_score bigint,
         weekly bigint, weekly_contribution bigint, total_contribution bigint, online_status text
       )
       ON CONFLICT (guild_id, ign) DO UPDATE SET
         ${IMPORT_FIELDS.map((f) => `${f} = excluded.${f}`).join(", ")},
         active = 1, last_imported_at = now_text(), updated_at = now_text()
       RETURNING (xmax = 0) AS inserted`,
      req.guild.id,
      JSON.stringify([...byIgn.values()])
    );
    const leagueRowsLinked = await linkPendingLeagueStats(req.guild.id);
    return { results, renamed, leagueRowsLinked };
  });

  const added = results.filter((r) => r.inserted).length;
  const updated = results.length - added - renamed;
  const counts = await db.get(
    "SELECT COUNT(*) FILTER (WHERE active = 0) AS removed, COUNT(*) FILTER (WHERE active = 1) AS total FROM players WHERE guild_id = ?",
    req.guild.id
  );

  res.json({
    summary: { added, updated, renamed, leagueRowsLinked, flaggedInactive: counts.removed, activeTotal: counts.total },
  });
});

// Re-checks every player against the guild Discord server's member list (matching
// rules live in createDiscordMatcher) and sets in_discord accordingly — overwriting
// any manual ticks with what Discord reports.
playersRouter.post("/discord-sync", async (req, res) => {
  if (!req.guild.discord_sync_enabled) {
    return res.status(400).json({ error: "Discord sync is turned off — turn it on in Guild settings" });
  }
  if (!process.env.DISCORD_BOT_TOKEN) {
    return res.status(503).json({ error: "Discord isn't set up on this site — add DISCORD_BOT_TOKEN to the server env" });
  }
  if (!discordConfigured(req.guild)) {
    return res.status(400).json({ error: "Add your Discord server ID in Guild settings first" });
  }

  let members;
  try {
    members = await fetchGuildMembers(req.guild.discord_guild_id);
  } catch (err) {
    if (err instanceof DiscordError) return res.status(err.status).json({ error: err.message });
    throw err;
  }
  const isInDiscord = createDiscordMatcher(members);

  const players = await db.all("SELECT id, ign, active FROM players WHERE guild_id = ?", req.guild.id);
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
     WHERE p.id = r.id AND p.guild_id = ?`,
    JSON.stringify(flags),
    req.guild.id
  );

  res.json({ summary: { matched, missing, discordMembers: members.length } });
});
