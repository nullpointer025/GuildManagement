import { Router } from "express";
import { db } from "../db.js";
import {
  ADMIN_COOKIE_NAME,
  adminConfigured,
  cookieOptions,
  requireAdmin,
  signAdminToken,
} from "../auth.js";

// Site admin: create guilds, rename them, rotate invite codes, delete them.
// Unlocked with the ADMIN_CODE env var.
export const adminRouter = Router();

const MIN_CODE_LENGTH = 6;

adminRouter.post("/enter", (req, res) => {
  if (!adminConfigured()) {
    return res.status(503).json({ error: "The admin page is off — set ADMIN_CODE in the server env" });
  }
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (code !== process.env.ADMIN_CODE) return res.status(403).json({ error: "Invalid admin code" });
  res.cookie(ADMIN_COOKIE_NAME, signAdminToken(), cookieOptions(1));
  res.json({ ok: true });
});

adminRouter.post("/logout", (req, res) => {
  res.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

adminRouter.use(requireAdmin);

adminRouter.get("/me", (req, res) => res.json({ admin: true }));

function listGuilds() {
  return db.all(
    `SELECT g.id, g.name, g.invite_code AS "inviteCode",
            CASE WHEN g.discord_sync_enabled THEN g.discord_guild_id END AS "discordGuildId",
            g.created_at AS "createdAt",
            (SELECT COUNT(*) FROM players p WHERE p.guild_id = g.id AND p.active = 1) AS "activePlayers",
            (SELECT COUNT(*) FROM raids r WHERE r.guild_id = g.id) AS raids
     FROM guilds g ORDER BY lower(g.name), g.id`
  );
}

// Validates a create/update body; on update only the fields present are checked.
// Returns { values } (column -> value) or { error }.
async function parseGuild(body, ownId = null) {
  const values = {};
  if (ownId == null || "name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { error: "Guild name is required" };
    if (name.length > 60) return { error: "Guild name must be 60 characters or fewer" };
    values.name = name;
  }
  if (ownId == null || "inviteCode" in body) {
    const code = typeof body.inviteCode === "string" ? body.inviteCode.trim() : "";
    if (code.length < MIN_CODE_LENGTH) {
      return { error: `Invite code must be at least ${MIN_CODE_LENGTH} characters` };
    }
    if (code.length > 100) return { error: "Invite code must be 100 characters or fewer" };
    const taken = await db.get(
      "SELECT id FROM guilds WHERE invite_code = ? AND id IS DISTINCT FROM ?::bigint",
      code,
      ownId
    );
    if (taken) return { error: "Another guild already uses that invite code" };
    values.invite_code = code;
  }
  return { values };
}

adminRouter.get("/guilds", async (req, res) => {
  res.json({ guilds: await listGuilds() });
});

adminRouter.post("/guilds", async (req, res) => {
  const parsed = await parseGuild(req.body ?? {});
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const { name, invite_code } = parsed.values;
  await db.run("INSERT INTO guilds (name, invite_code) VALUES (?, ?)", name, invite_code);
  res.status(201).json({ guilds: await listGuilds() });
});

adminRouter.patch("/guilds/:id", async (req, res) => {
  const id = Number(req.params.id);
  const guild = await db.get("SELECT id, invite_code FROM guilds WHERE id = ?", id);
  if (!guild) return res.status(404).json({ error: "Guild not found" });

  const parsed = await parseGuild(req.body ?? {}, id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const entries = Object.entries(parsed.values);
  if (entries.length === 0) return res.status(400).json({ error: "Nothing to update" });

  // A new invite code signs everyone out of this guild.
  const rotate = "invite_code" in parsed.values && parsed.values.invite_code !== guild.invite_code;
  await db.run(
    `UPDATE guilds SET ${entries.map(([k]) => `${k} = ?`).join(", ")},
       ${rotate ? "session_version = session_version + 1," : ""} updated_at = now_text()
     WHERE id = ?`,
    ...entries.map(([, v]) => v),
    id
  );
  res.json({ guilds: await listGuilds() });
});

// Deletes the guild and, through ON DELETE CASCADE, all of its data.
adminRouter.delete("/guilds/:id", async (req, res) => {
  const info = await db.run("DELETE FROM guilds WHERE id = ?", Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "Guild not found" });
  res.json({ guilds: await listGuilds() });
});
