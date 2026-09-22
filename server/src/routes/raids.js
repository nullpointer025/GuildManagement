import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAuth } from "../auth.js";

export const raidsRouter = Router();
raidsRouter.use(requireAuth);

function createEmptySlots(raidId, partyCount) {
  const insertSlot = db.prepare(
    "INSERT INTO raid_slots (raid_id, party_index, slot_index, player_id) VALUES (?, ?, ?, NULL)"
  );
  const insertParty = db.prepare(
    "INSERT INTO raid_parties (raid_id, party_index, name) VALUES (?, ?, NULL)"
  );
  const txn = transaction(() => {
    for (let p = 0; p < partyCount; p++) {
      insertParty.run(raidId, p);
      for (let s = 0; s < 5; s++) {
        insertSlot.run(raidId, p, s);
      }
    }
  });
  txn();
}

function getRaidWithSlots(raidId) {
  const raid = db
    .prepare(
      `SELECT r.*, u.username AS created_by_username
       FROM raids r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = ?`
    )
    .get(raidId);
  if (!raid) return null;

  const slots = db
    .prepare(
      `SELECT rs.party_index, rs.slot_index, rs.player_id, p.*
       FROM raid_slots rs
       LEFT JOIN players p ON p.id = rs.player_id
       WHERE rs.raid_id = ?
       ORDER BY rs.party_index ASC, rs.slot_index ASC`
    )
    .all(raidId);

  const parties = Array.from({ length: raid.party_count }, () => Array(5).fill(null));
  for (const row of slots) {
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
    if (parties[row.party_index]) {
      parties[row.party_index][row.slot_index] = player;
    }
  }

  const partyNames = Array(raid.party_count).fill(null);
  const nameRows = db
    .prepare("SELECT party_index, name FROM raid_parties WHERE raid_id = ?")
    .all(raidId);
  for (const row of nameRows) {
    if (row.party_index < partyNames.length) partyNames[row.party_index] = row.name;
  }

  return { ...raid, parties, partyNames };
}

raidsRouter.get("/", (req, res) => {
  const raids = db
    .prepare(
      `SELECT r.id, r.name, r.party_count, r.created_at, r.updated_at, u.username AS created_by_username
       FROM raids r LEFT JOIN users u ON u.id = r.created_by
       ORDER BY r.updated_at DESC`
    )
    .all();
  res.json({ raids });
});

raidsRouter.post("/", (req, res) => {
  const { name, partyCount } = req.body ?? {};
  const trimmedName = (name ?? "").trim();
  if (!trimmedName) return res.status(400).json({ error: "Raid name is required" });

  const count = Number(partyCount) || 8;
  if (count < 1 || count > 20) {
    return res.status(400).json({ error: "Party count must be between 1 and 20" });
  }

  const info = db
    .prepare("INSERT INTO raids (name, party_count, created_by) VALUES (?, ?, ?)")
    .run(trimmedName, count, req.user.id);

  createEmptySlots(info.lastInsertRowid, count);
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

  const { name, partyCount } = req.body ?? {};

  if (name != null) {
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ error: "Raid name cannot be empty" });
    db.prepare("UPDATE raids SET name = ?, updated_at = datetime('now') WHERE id = ?").run(
      trimmedName,
      id
    );
  }

  if (partyCount != null) {
    const count = Number(partyCount);
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      return res.status(400).json({ error: "Party count must be between 1 and 20" });
    }
    if (count > existing.party_count) {
      const insertSlot = db.prepare(
        "INSERT INTO raid_slots (raid_id, party_index, slot_index, player_id) VALUES (?, ?, ?, NULL)"
      );
      const insertParty = db.prepare(
        "INSERT INTO raid_parties (raid_id, party_index, name) VALUES (?, ?, NULL)"
      );
      const txn = transaction(() => {
        for (let p = existing.party_count; p < count; p++) {
          insertParty.run(id, p);
          for (let s = 0; s < 5; s++) insertSlot.run(id, p, s);
        }
      });
      txn();
    } else if (count < existing.party_count) {
      const txn = transaction(() => {
        db.prepare("DELETE FROM raid_slots WHERE raid_id = ? AND party_index >= ?").run(id, count);
        db.prepare("DELETE FROM raid_parties WHERE raid_id = ? AND party_index >= ?").run(
          id,
          count
        );
      });
      txn();
    }
    db.prepare("UPDATE raids SET party_count = ?, updated_at = datetime('now') WHERE id = ?").run(
      count,
      id
    );
  }

  res.json({ raid: getRaidWithSlots(id) });
});

raidsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM raids WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Raid not found" });
  res.json({ ok: true });
});

// Assign (or clear) a single slot. Clears the player's previous slot in this raid, if any,
// so the same player can never occupy two slots in one raid.
raidsRouter.put("/:id/slots", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { partyIndex, slotIndex, playerId } = req.body ?? {};
  if (
    !Number.isInteger(partyIndex) ||
    !Number.isInteger(slotIndex) ||
    partyIndex < 0 ||
    partyIndex >= raid.party_count ||
    slotIndex < 0 ||
    slotIndex >= 5
  ) {
    return res.status(400).json({ error: "Invalid party/slot index" });
  }

  const txn = transaction(() => {
    if (playerId != null) {
      db.prepare(
        "UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND player_id = ?"
      ).run(raidId, playerId);
    }
    db.prepare(
      "UPDATE raid_slots SET player_id = ? WHERE raid_id = ? AND party_index = ? AND slot_index = ?"
    ).run(playerId ?? null, raidId, partyIndex, slotIndex);
    db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);
  });
  txn();

  res.json({ raid: getRaidWithSlots(raidId) });
});

// Set (or clear, with an empty/omitted name) a party's custom display name.
raidsRouter.patch("/:id/parties/:partyIndex", (req, res) => {
  const raidId = Number(req.params.id);
  const partyIndex = Number(req.params.partyIndex);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });
  if (!Number.isInteger(partyIndex) || partyIndex < 0 || partyIndex >= raid.party_count) {
    return res.status(400).json({ error: "Invalid party index" });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() || null : null;

  db.prepare(
    `INSERT INTO raid_parties (raid_id, party_index, name) VALUES (?, ?, ?)
     ON CONFLICT(raid_id, party_index) DO UPDATE SET name = excluded.name`
  ).run(raidId, partyIndex, name);
  db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);

  res.json({ raid: getRaidWithSlots(raidId) });
});
