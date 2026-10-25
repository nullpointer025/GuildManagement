import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

import { authRouter } from "./routes/auth.js";
import { playersRouter } from "./routes/players.js";
import { raidsRouter } from "./routes/raids.js";
import { permaPartiesRouter } from "./routes/permaParties.js";
import { leaguesRouter } from "./routes/leagues.js";

// The API on its own. Vercel runs it as a serverless function (api/index.js) and
// serves the built client itself; src/index.js runs it as a regular server.
const app = express();
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(express.json({ limit: "4mb" }));
app.use(cookieParser());

if (process.env.NODE_ENV !== "production") {
  app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
}

app.use("/api/auth", authRouter);
app.use("/api/players", playersRouter);
app.use("/api/raids", raidsRouter);
app.use("/api/perma-parties", permaPartiesRouter);
app.use("/api/leagues", leaguesRouter);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Express 5 forwards rejected async handlers here.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
