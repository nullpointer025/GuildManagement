import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";

export const raidsRouter = Router();
raidsRouter.use(requireAccess);

const BOARDS = ["main", "sub"];

function isValidBoard(board) {
  return BOARDS.includes(board);
}

function boardPartyCount(raidId, board) {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM raid_parties WHERE raid_id = ? AND board = ?")
    .get(raidId, board);
  return row.n;
}

function createEmptyBoard(raidId, board, partyCount) {
  const insertSlot = db.prepare(
    "INSERT INTO raid_slots (raid_id, board, party_index, slot_index, player_id) VALUES (?, ?, ?, ?, NULL)"
  );
  const insertParty = db.prepare(
    "INSERT INTO raid_parties (raid_id, board, party_index, name) VALUES (?, ?, ?, NULL)"
  );
  for (let p = 0; p < partyCount; p++) {
    insertParty.run(raidId, board, p);
    for (let s = 0; s < 5; s++) insertSlot.run(raidId, board, p, s);
  }
}

function emptyBoardShape(partyCount) {
  return {
    parties: Array.from({ length: partyCount }, () => Array(5).fill(null)),
    partyNames: Array(partyCount).fill(null),
  };
}

function getRaidWithSlots(raidId) {
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return null;

  const boards = {
    main: emptyBoardShape(boardPartyCount(raidId, "main")),
    sub: emptyBoardShape(boardPartyCount(raidId, "sub")),
  };

  const slots = db
    .prepare(
      `SELECT rs.board, rs.party_index, rs.slot_index, rs.player_id, p.*
       FROM raid_slots rs
       LEFT JOIN players p ON p.id = rs.player_id
       WHERE rs.raid_id = ?
       ORDER BY rs.party_index ASC, rs.slot_index ASC`
    )
    .all(raidId);

  for (const row of slots) {
    const board = boards[row.board];
    if (!board) continue;
    const player = row.player_id
      ? {
          id: row.player_id,
          ign: row.ign,
          level: row.level,
          class: row.class,
          title: row.title,
          gender: row.gender,
          position: row.position,
          gear_score: row.gear_score,
          weekly: row.weekly,
          weekly_contribution: row.weekly_contribution,
          total_contribution: row.total_contribution,
          online_status: row.online_status,
          active: row.active,
        }
      : null;
    if (board.parties[row.party_index]) {
      board.parties[row.party_index][row.slot_index] = player;
    }
  }

  const nameRows = db
    .prepare("SELECT board, party_index, name FROM raid_parties WHERE raid_id = ?")
    .all(raidId);
  for (const row of nameRows) {
    const board = boards[row.board];
    if (board && row.party_index < board.partyNames.length) {
      board.partyNames[row.party_index] = row.name;
    }
  }

  return { ...raid, boards };
}

raidsRouter.get("/", (req, res) => {
  const raids = db
    .prepare("SELECT id, name, created_at, updated_at FROM raids ORDER BY updated_at DESC")
    .all();
  const withCounts = raids.map((raid) => ({
    ...raid,
    mainPartyCount: boardPartyCount(raid.id, "main"),
    subPartyCount: boardPartyCount(raid.id, "sub"),
  }));
  res.json({ raids: withCounts });
});

raidsRouter.post("/", (req, res) => {
  const { name, partyCount } = req.body ?? {};
  const trimmedName = (name ?? "").trim();
  if (!trimmedName) return res.status(400).json({ error: "Raid name is required" });

  const count = Number(partyCount) || 8;
  if (count < 1 || count > 50) {
    return res.status(400).json({ error: "Party count must be between 1 and 50" });
  }

  const info = db.prepare("INSERT INTO raids (name) VALUES (?)").run(trimmedName);

  const txn = transaction(() => {
    for (const board of BOARDS) createEmptyBoard(info.lastInsertRowid, board, count);
  });
  txn();

  res.status(201).json({ raid: getRaidWithSlots(info.lastInsertRowid) });
});

raidsRouter.get("/:id", (req, res) => {
  const raid = getRaidWithSlots(Number(req.params.id));
  if (!raid) return res.status(404).json({ error: "Raid not found" });
  res.json({ raid });
});

raidsRouter.patch("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT * FROM raids WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Raid not found" });

  const { name } = req.body ?? {};
  if (name != null) {
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ error: "Raid name cannot be empty" });
    db.prepare("UPDATE raids SET name = ?, updated_at = datetime('now') WHERE id = ?").run(
      trimmedName,
      id
    );
  }

  res.json({ raid: getRaidWithSlots(id) });
});

// Grow/shrink ONE board's party count. Main and Sub are sized independently.
raidsRouter.patch("/:id/party-count", (req, res) => {
  const id = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(id);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, partyCount } = req.body ?? {};
  const count = Number(partyCount);
  if (!isValidBoard(board) || !Number.isInteger(count) || count < 1 || count > 50) {
    return res.status(400).json({ error: "Invalid board or party count (must be 1-50)" });
  }

  const current = boardPartyCount(id, board);
  const txn = transaction(() => {
    if (count > current) {
      const insertSlot = db.prepare(
        "INSERT INTO raid_slots (raid_id, board, party_index, slot_index, player_id) VALUES (?, ?, ?, ?, NULL)"
      );
      const insertParty = db.prepare(
        "INSERT INTO raid_parties (raid_id, board, party_index, name) VALUES (?, ?, ?, NULL)"
      );
      for (let p = current; p < count; p++) {
        insertParty.run(id, board, p);
        for (let s = 0; s < 5; s++) insertSlot.run(id, board, p, s);
      }
    } else if (count < current) {
      db.prepare(
        "DELETE FROM raid_slots WHERE raid_id = ? AND board = ? AND party_index >= ?"
      ).run(id, board, count);
      db.prepare(
        "DELETE FROM raid_parties WHERE raid_id = ? AND board = ? AND party_index >= ?"
      ).run(id, board, count);
    }
    db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(id);
  });
  txn();

  res.json({ raid: getRaidWithSlots(id) });
});

raidsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM raids WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Raid not found" });
  res.json({ ok: true });
});

// Assign (or clear) a single slot on one board. Clears the player's previous slot
// anywhere in this raid — on EITHER board — so a player can never be double-booked
// between Main and Sub, nor hold two slots on the same board.
raidsRouter.put("/:id/slots", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, partyIndex, slotIndex, playerId } = req.body ?? {};
  if (
    !isValidBoard(board) ||
    !Number.isInteger(partyIndex) ||
    !Number.isInteger(slotIndex) ||
    partyIndex < 0 ||
    partyIndex >= boardPartyCount(raidId, board) ||
    slotIndex < 0 ||
    slotIndex >= 5
  ) {
    return res.status(400).json({ error: "Invalid board/party/slot index" });
  }

  const txn = transaction(() => {
    if (playerId != null) {
      db.prepare("UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND player_id = ?").run(
        raidId,
        playerId
      );
    }
    db.prepare(
      "UPDATE raid_slots SET player_id = ? WHERE raid_id = ? AND board = ? AND party_index = ? AND slot_index = ?"
    ).run(playerId ?? null, raidId, board, partyIndex, slotIndex);
    db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);
  });
  txn();

  res.json({ raid: getRaidWithSlots(raidId) });
});

// Set (or clear, with an empty/omitted name) a party's custom display name on one board.
raidsRouter.patch("/:id/parties/:partyIndex", (req, res) => {
  const raidId = Number(req.params.id);
  const partyIndex = Number(req.params.partyIndex);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board } = req.body ?? {};
  if (
    !isValidBoard(board) ||
    !Number.isInteger(partyIndex) ||
    partyIndex < 0 ||
    partyIndex >= boardPartyCount(raidId, board)
  ) {
    return res.status(400).json({ error: "Invalid board/party index" });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() || null : null;

  db.prepare(
    `INSERT INTO raid_parties (raid_id, board, party_index, name) VALUES (?, ?, ?, ?)
     ON CONFLICT(raid_id, board, party_index) DO UPDATE SET name = excluded.name`
  ).run(raidId, board, partyIndex, name);
  db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);

  res.json({ raid: getRaidWithSlots(raidId) });
});
