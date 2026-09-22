import { Router } from "express";
import { signAccessToken, requireAccess, COOKIE_NAME, cookieOptions } from "../auth.js";

export const authRouter = Router();

// Single shared gate: anyone with the guild invite code gets in. No per-officer accounts.
authRouter.post("/enter", (req, res) => {
  const { code } = req.body ?? {};
  if (!code || code !== process.env.GUILD_INVITE_CODE) {
    return res.status(403).json({ error: "Invalid guild invite code" });
  }

  const token = signAccessToken();
  res.cookie(COOKIE_NAME, token, cookieOptions());
  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAccess, (req, res) => {
  res.json({ unlocked: true });
});
