import jwt from "jsonwebtoken";
import { db } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set. Add it to server/.env");
}

export const COOKIE_NAME = "guild_session";

export function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: "30d",
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // The JWT can outlive the user row it names (e.g. after a database reset),
    // so confirm the account still exists rather than trusting the token alone.
    const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(payload.sub);
    if (!user) {
      res.clearCookie(COOKIE_NAME, { path: "/" });
      return res.status(401).json({ error: "Session expired, please log in again" });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Session expired, please log in again" });
  }
}

export function cookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProd,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}
