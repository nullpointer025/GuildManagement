import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// DATA_DIR lets a host with a mounted persistent volume (e.g. Railway) point
// storage somewhere durable; local dev falls back to server/data untouched.
const dataDir = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "guild.db");
export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// node:sqlite has no built-in transaction helper (unlike better-sqlite3) — wrap manually.
export function transaction(fn) {
  return (...args) => {
    db.exec("BEGIN");
    try {
      const result = fn(...args);
      db.exec("COMMIT");
      return result;
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  };
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ign TEXT UNIQUE NOT NULL,
  level INTEGER,
  class TEXT,
  title TEXT,
  gender TEXT,
  position TEXT,
  gear_score INTEGER,
  weekly INTEGER,
  weekly_contribution INTEGER,
  total_contribution INTEGER,
  online_status TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  party_count INTEGER NOT NULL DEFAULT 8,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raid_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  party_index INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  UNIQUE(raid_id, party_index, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_raid_slots_raid ON raid_slots(raid_id);

CREATE TABLE IF NOT EXISTS raid_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  party_index INTEGER NOT NULL,
  name TEXT,
  UNIQUE(raid_id, party_index)
);

CREATE INDEX IF NOT EXISTS idx_raid_parties_raid ON raid_parties(raid_id);
`);
