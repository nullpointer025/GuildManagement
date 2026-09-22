import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { signToken, requireAuth, COOKIE_NAME, cookieOptions } from "../auth.js";

export const authRouter = Router();

authRouter.post("/register", (req, res) => {
  const { username, password, inviteCode } = req.body ?? {};

  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }
  if (username.length < 3 || username.length > 32) {
    return res.status(400).json({ error: "Username must be 3-32 characters" });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (inviteCode !== process.env.GUILD_INVITE_CODE) {
    return res.status(403).json({ error: "Invalid guild invite code" });
  }

  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (existing) {
    return res.status(409).json({ error: "Username already taken" });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const info = db
    .prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)")
    .run(username, passwordHash);

  const user = { id: info.lastInsertRowid, username };
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.status(201).json({ user });
});

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const row = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const user = { id: row.id, username: row.username };
  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ user });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});
