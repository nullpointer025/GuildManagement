import { Router } from "express";
import { db } from "../db.js";
import { signAccessToken, requireAccess, requireOfficer, COOKIE_NAME, cookieOptions } from "../auth.js";
import { discordConfigured } from "../discord.js";

export const authRouter = Router();

// The code picks the guild: each code opens only its own guild's data. The invite
// code gives officer access, the viewer code read-only access.
authRouter.post("/enter", async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const guild = code
    ? await db.get(
        `SELECT id, name, session_version, viewer_session_version,
                CASE WHEN invite_code = ? THEN 'officer' ELSE 'viewer' END AS role
         FROM guilds WHERE invite_code = ? OR viewer_code = ?`,
        code,
        code,
        code
      )
    : null;
  if (!guild) {
    return res.status(403).json({ error: "Invalid guild invite code" });
  }

  res.cookie(COOKIE_NAME, signAccessToken(guild, guild.role), cookieOptions());
  res.json({ ok: true, guild: { id: guild.id, name: guild.name }, role: guild.role });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAccess, (req, res) => {
  res.json({ unlocked: true, guild: guildInfo(req.guild), role: req.role });
});

// Guild settings, editable by the guild's officers. Discord sync is optional: when
// it's turned on, the server ID is required (the bot token stays server-wide).
// Turning it off keeps the stored ID so it's filled in again next time.
authRouter.patch("/guild", requireAccess, requireOfficer, async (req, res) => {
  const enabled = req.body?.discordSyncEnabled === true;
  const raw = req.body?.discordGuildId;
  let discordGuildId = raw == null || String(raw).trim() === "" ? null : String(raw).trim();
  if (enabled && discordGuildId == null) {
    return res.status(400).json({ error: "Enter your Discord server ID to turn on Discord sync" });
  }
  if (discordGuildId != null && !/^\d{5,25}$/.test(discordGuildId)) {
    return res.status(400).json({ error: "A Discord server ID is a long number (right-click the server → Copy Server ID)" });
  }
  if (!enabled && discordGuildId == null) discordGuildId = req.guild.discord_guild_id;

  await db.run(
    "UPDATE guilds SET discord_sync_enabled = ?, discord_guild_id = ?, updated_at = now_text() WHERE id = ?",
    enabled,
    discordGuildId,
    req.guild.id
  );
  res.json({
    guild: guildInfo({ ...req.guild, discord_sync_enabled: enabled, discord_guild_id: discordGuildId }),
  });
});

function guildInfo(guild) {
  return {
    id: guild.id,
    name: guild.name,
    discordSyncEnabled: guild.discord_sync_enabled,
    discordGuildId: guild.discord_guild_id,
    discordBotAvailable: Boolean(process.env.DISCORD_BOT_TOKEN),
    discordReady: discordConfigured(guild),
  };
}
