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
  notes TEXT,
  notes_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- "board" splits each raid into two independent party grids ('main' and 'sub')
-- that share the same roster pool but hold separate, independently-sized rosters.
-- A board's party count is however many party_index values exist for it here —
-- there is no separate stored count to keep in sync.
CREATE TABLE IF NOT EXISTS raid_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  board TEXT NOT NULL DEFAULT 'main',
  party_index INTEGER NOT NULL,
  slot_index INTEGER NOT NULL,
  player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
  UNIQUE(raid_id, board, party_index, slot_index)
);

CREATE INDEX IF NOT EXISTS idx_raid_slots_raid ON raid_slots(raid_id);

CREATE TABLE IF NOT EXISTS raid_parties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
  board TEXT NOT NULL DEFAULT 'main',
  party_index INTEGER NOT NULL,
  name TEXT,
  UNIQUE(raid_id, board, party_index)
);

CREATE INDEX IF NOT EXISTS idx_raid_parties_raid ON raid_parties(raid_id);
`);

// One-time migration for databases created before boards existed at all: rebuild
// raid_slots/raid_parties with the new unique constraints (SQLite can't alter a
// UNIQUE constraint in place), tag existing rows as the 'main' board, and give
// every existing raid an empty 'sub' board sized to match main.
function migrateAddBoardColumn() {
  const columns = db.prepare("PRAGMA table_info(raid_slots)").all();
  if (columns.some((c) => c.name === "board")) return;

  const txn = transaction(() => {
    db.exec(`
      ALTER TABLE raid_slots RENAME TO raid_slots_old;
      CREATE TABLE raid_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
        board TEXT NOT NULL DEFAULT 'main',
        party_index INTEGER NOT NULL,
        slot_index INTEGER NOT NULL,
        player_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
        UNIQUE(raid_id, board, party_index, slot_index)
      );
      INSERT INTO raid_slots (id, raid_id, board, party_index, slot_index, player_id)
        SELECT id, raid_id, 'main', party_index, slot_index, player_id FROM raid_slots_old;
      DROP TABLE raid_slots_old;
      CREATE INDEX IF NOT EXISTS idx_raid_slots_raid ON raid_slots(raid_id);

      ALTER TABLE raid_parties RENAME TO raid_parties_old;
      CREATE TABLE raid_parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raid_id INTEGER NOT NULL REFERENCES raids(id) ON DELETE CASCADE,
        board TEXT NOT NULL DEFAULT 'main',
        party_index INTEGER NOT NULL,
        name TEXT,
        UNIQUE(raid_id, board, party_index)
      );
      INSERT INTO raid_parties (id, raid_id, board, party_index, name)
        SELECT id, raid_id, 'main', party_index, name FROM raid_parties_old;
      DROP TABLE raid_parties_old;
      CREATE INDEX IF NOT EXISTS idx_raid_parties_raid ON raid_parties(raid_id);
    `);

    const raids = db.prepare("SELECT id, party_count FROM raids").all();
    const insertSlot = db.prepare(
      "INSERT INTO raid_slots (raid_id, board, party_index, slot_index, player_id) VALUES (?, 'sub', ?, ?, NULL)"
    );
    const insertParty = db.prepare(
      "INSERT INTO raid_parties (raid_id, board, party_index, name) VALUES (?, 'sub', ?, NULL)"
    );
    for (const raid of raids) {
      for (let p = 0; p < raid.party_count; p++) {
        insertParty.run(raid.id, p);
        for (let s = 0; s < 5; s++) insertSlot.run(raid.id, p, s);
      }
    }
  });
  txn();
}

// One-time migration dropping per-officer accounts in favor of a single shared
// invite-code gate, and the now-meaningless shared party_count column (each
// board tracks its own size via which party_index rows exist for it).
function migrateRemoveAccountsAndSharedPartyCount() {
  const columns = db.prepare("PRAGMA table_info(raids)").all();
  const hasCreatedBy = columns.some((c) => c.name === "created_by");
  const hasPartyCount = columns.some((c) => c.name === "party_count");
  if (!hasCreatedBy && !hasPartyCount) return;

  const txn = transaction(() => {
    db.exec(`
      ALTER TABLE raids RENAME TO raids_old;
      CREATE TABLE raids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO raids (id, name, created_at, updated_at)
        SELECT id, name, created_at, updated_at FROM raids_old;
      DROP TABLE raids_old;
      DROP TABLE IF EXISTS users;
    `);
  });
  txn();
}

// One-time migration adding the shared per-raid notes field (plain ADD COLUMN is
// safe here — no unique/constraint changes needed, unlike the rebuilds above).
function migrateAddNotesColumns() {
  const columns = db.prepare("PRAGMA table_info(raids)").all();
  if (!columns.some((c) => c.name === "notes")) {
    db.exec("ALTER TABLE raids ADD COLUMN notes TEXT");
  }
  if (!columns.some((c) => c.name === "notes_updated_at")) {
    db.exec("ALTER TABLE raids ADD COLUMN notes_updated_at TEXT");
  }
}

migrateAddBoardColumn();
migrateRemoveAccountsAndSharedPartyCount();
migrateAddNotesColumns();
