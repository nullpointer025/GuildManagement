import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Add it to server/.env");
}

export const COOKIE_NAME = "guild_access";
export const ADMIN_COOKIE_NAME = "guild_admin";

// There are no individual accounts: whoever knows a guild's invite code gets that
// guild as an officer; whoever knows its viewer code gets it read-only. The token
// names the guild, the role and that role's session version, which goes up whenever
// the role's code changes, so changing a code signs everyone using it out.
// Tokens from before roles existed have no role and are officer tokens.
export function signAccessToken(guild, role = "officer") {
  const v = role === "viewer" ? guild.viewer_session_version : guild.session_version;
  return jwt.sign({ guildId: guild.id, role, v }, JWT_SECRET, { expiresIn: "30d" });
}

export async function requireAccess(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    payload = null;
  }
  const guild = Number.isInteger(payload?.guildId)
    ? await db.get(
        `SELECT id, name, discord_sync_enabled, discord_guild_id, session_version, viewer_session_version
         FROM guilds WHERE id = ?`,
        payload.guildId
      )
    : null;
  const role = payload?.role === "viewer" ? "viewer" : "officer";
  const version = role === "viewer" ? guild?.viewer_session_version : guild?.session_version;
  if (!guild || version !== payload.v) {
    res.clearCookie(COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Session expired, please enter the invite code again" });
  }

  // Every guild-owned query in the routes filters by req.guild.id.
  req.guild = guild;
  req.role = role;
  next();
}

// For routes only officers may use at all.
export function requireOfficer(req, res, next) {
  if (req.role !== "officer") return res.status(403).json({ error: "View-only access can't do that" });
  next();
}

// Viewers may read (GET) but not change anything.
export function officerWrites(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  return requireOfficer(req, res, next);
}

// The admin page is unlocked with ADMIN_CODE. The signing key mixes in a hash of
// the code, so changing ADMIN_CODE invalidates every existing admin session.
function adminKey() {
  const code = process.env.ADMIN_CODE;
  if (!code) return null;
  return JWT_SECRET + ":" + createHash("sha256").update(code).digest("hex");
}

export function adminConfigured() {
  return Boolean(process.env.ADMIN_CODE);
}

export function signAdminToken() {
  return jwt.sign({ admin: true }, adminKey(), { expiresIn: "1d" });
}

export function requireAdmin(req, res, next) {
  const token = req.cookies?.[ADMIN_COOKIE_NAME];
  const key = adminKey();
  if (!token || !key) return res.status(401).json({ error: "Not authenticated" });
  try {
    jwt.verify(token, key);
    next();
  } catch {
    res.clearCookie(ADMIN_COOKIE_NAME, { path: "/" });
    return res.status(401).json({ error: "Admin session expired, please enter the admin code again" });
  }
}

export function cookieOptions(maxAgeDays = 30) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: maxAgeDays * 24 * 60 * 60 * 1000,
    path: "/",
  };
}
