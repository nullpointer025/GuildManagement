import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";

export const raidsRouter = Router();
raidsRouter.use(requireAccess);

// A raid's type fixes which boards it has. Every board shares one roster pool.
const RAID_TYPE_BOARDS = {
  guild_league: ["main", "sub"],
  polarity: ["star", "normal1", "normal2", "normal3", "normal4"],
};

const BOARD_LABELS = {
  main: "Main",
  sub: "Sub",
  star: "Star Dungeon",
  normal1: "Normal Dungeon 1",
  normal2: "Normal Dungeon 2",
  normal3: "Normal Dungeon 3",
  normal4: "Normal Dungeon 4",
};

// Raid types whose boards start at fixed sizes instead of the officer-chosen party count.
const PRESET_PARTY_COUNTS = {
  polarity: { star: 10, normal1: 5, normal2: 5, normal3: 5, normal4: 5 },
};

function boardsOf(raid) {
  return Object.hasOwn(RAID_TYPE_BOARDS, raid.type) ? RAID_TYPE_BOARDS[raid.type] : RAID_TYPE_BOARDS.guild_league;
}

function isValidBoard(raid, board) {
  return boardsOf(raid).includes(board);
}

function partyCounts(raid) {
  return Object.fromEntries(boardsOf(raid).map((board) => [board, boardPartyCount(raid.id, board)]));
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

  const boards = Object.fromEntries(
    boardsOf(raid).map((board) => [board, emptyBoardShape(boardPartyCount(raidId, board))])
  );

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
          in_discord: row.in_discord,
          ultimate: row.ultimate,
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
    .prepare("SELECT id, name, type, created_at, updated_at FROM raids ORDER BY updated_at DESC")
    .all();
  const withCounts = raids.map((raid) => ({ ...raid, partyCounts: partyCounts(raid) }));
  res.json({ raids: withCounts });
});

raidsRouter.post("/", (req, res) => {
  const { name, partyCount, type } = req.body ?? {};
  const trimmedName = (name ?? "").trim();
  if (!trimmedName) return res.status(400).json({ error: "Raid name is required" });
  if (!Object.hasOwn(RAID_TYPE_BOARDS, type)) {
    return res.status(400).json({ error: "Choose Guild League or Polarity Zone" });
  }

  const preset = PRESET_PARTY_COUNTS[type];
  const count = Number(partyCount) || 8;
  if (!preset && (count < 1 || count > 50)) {
    return res.status(400).json({ error: "Party count must be between 1 and 50" });
  }

  const info = db.prepare("INSERT INTO raids (name, type) VALUES (?, ?)").run(trimmedName, type);

  const txn = transaction(() => {
    for (const board of RAID_TYPE_BOARDS[type]) {
      createEmptyBoard(info.lastInsertRowid, board, preset?.[board] ?? count);
    }
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

// Grow/shrink ONE board's party count. Each board is sized independently.
raidsRouter.patch("/:id/party-count", (req, res) => {
  const id = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(id);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, partyCount } = req.body ?? {};
  const count = Number(partyCount);
  if (!isValidBoard(raid, board) || !Number.isInteger(count) || count < 1 || count > 50) {
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

// Shared notes for the whole raid (not per-board). notes_updated_at is tracked
// separately from updated_at so clients can tell "someone edited the notes"
// apart from routine slot/party activity, to drive an unread indicator.
raidsRouter.patch("/:id/notes", (req, res) => {
  const id = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(id);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
  db.prepare(
    "UPDATE raids SET notes = ?, notes_updated_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(notes, id);

  res.json({ raid: getRaidWithSlots(id) });
});

raidsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare("DELETE FROM raids WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "Raid not found" });
  res.json({ ok: true });
});

// Assign (or clear) a single slot on one board. Clears the player's previous slot
// anywhere in this raid — on ANY board — so a player can never be double-booked
// across boards, nor hold two slots on the same board.
raidsRouter.put("/:id/slots", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, partyIndex, slotIndex, playerId } = req.body ?? {};
  if (
    !isValidBoard(raid, board) ||
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

// Places perma parties into the parties the officer picked on one board, naming
// each party after its perma party. The board's party count never changes. Anyone
// already in a target party goes back to the pool; members who have left the guild
// (inactive) are skipped. A perma party with any member already deployed in this
// raid (on any board) is refused, so it can only be placed once per raid.
raidsRouter.post("/:id/apply-perma-parties", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, assignments } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: "Select at least one perma party" });
  }
  const partyCount = boardPartyCount(raidId, board);
  const validAssignment = (a) =>
    Number.isInteger(a?.permaPartyId) && Number.isInteger(a?.partyIndex) && a.partyIndex >= 0 && a.partyIndex < partyCount;
  if (!assignments.every(validAssignment)) {
    return res.status(400).json({ error: `Pick a party between 1 and ${partyCount}` });
  }
  if (new Set(assignments.map((a) => a.partyIndex)).size !== assignments.length) {
    return res.status(400).json({ error: "Each perma party needs a different target party" });
  }
  if (new Set(assignments.map((a) => a.permaPartyId)).size !== assignments.length) {
    return res.status(400).json({ error: "A perma party was selected twice" });
  }

  const findParty = db.prepare("SELECT id, name FROM perma_parties WHERE id = ?");
  const membersOf = db.prepare(
    `SELECT p.id, p.ign, p.active FROM perma_party_members m
     JOIN players p ON p.id = m.player_id
     WHERE m.perma_party_id = ? ORDER BY m.slot_index`
  );
  const slotOf = db.prepare("SELECT board, party_index FROM raid_slots WHERE raid_id = ? AND player_id = ?");

  const skipped = [];
  const toPlace = [];
  for (const { permaPartyId, partyIndex } of assignments) {
    const party = findParty.get(permaPartyId);
    if (!party) return res.status(400).json({ error: "Some perma parties no longer exist" });
    const members = membersOf.all(party.id);
    skipped.push(...members.filter((m) => m.active !== 1).map((m) => m.ign));
    const active = members.filter((m) => m.active === 1);
    const deployed = active.map((m) => slotOf.get(raidId, m.id)).find(Boolean);
    if (deployed) {
      return res.status(400).json({
        error: `${party.name} is already deployed on ${BOARD_LABELS[deployed.board] ?? deployed.board} (Party ${deployed.party_index + 1})`,
      });
    }
    toPlace.push({ ...party, partyIndex, members: active });
  }

  const clearParty = db.prepare(
    "UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND board = ? AND party_index = ?"
  );
  const setSlot = db.prepare(
    "UPDATE raid_slots SET player_id = ? WHERE raid_id = ? AND board = ? AND party_index = ? AND slot_index = ?"
  );
  const nameParty = db.prepare(
    `INSERT INTO raid_parties (raid_id, board, party_index, name) VALUES (?, ?, ?, ?)
     ON CONFLICT(raid_id, board, party_index) DO UPDATE SET name = excluded.name`
  );

  transaction(() => {
    for (const party of toPlace) {
      clearParty.run(raidId, board, party.partyIndex);
      party.members.forEach((member, slot) => setSlot.run(member.id, raidId, board, party.partyIndex, slot));
      nameParty.run(raidId, board, party.partyIndex, party.name);
    }
    db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);
  })();

  res.json({ raid: getRaidWithSlots(raidId), skipped });
});

function normalizeClass(className) {
  return (className ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

// Support roles auto-assign can fill, keyed by the role the client asks for. Clown and
// Gypsy are one role (the gendered versions of the same class), so either counts.
const AUTO_ASSIGN_ROLES = {
  priest: (className) => normalizeClass(className).includes("priest"),
  clown_gypsy: (className) => /clown|gypsy/.test(normalizeClass(className)),
  creator: (className) => normalizeClass(className).includes("creator"),
};

const ROLE_LABELS = { priest: "High Priest", clown_gypsy: "Clown/Gypsy", creator: "Creator" };

// The supports every party gets from "Auto assign parties"; the other slots go to DPS.
const PARTY_SUPPORTS = ["priest", "clown_gypsy", "creator"];
const PARTY_DPS = 2;

function isSupport(className) {
  return PARTY_SUPPORTS.some((role) => AUTO_ASSIGN_ROLES[role](className));
}

// Free players, best gear first: active, not placed anywhere in this raid, and not in a
// perma party (same rule as the builder's pool).
function freePlayers(raidId) {
  return db
    .prepare(
      `SELECT id, class FROM players
       WHERE active = 1
         AND id NOT IN (SELECT player_id FROM raid_slots WHERE raid_id = ? AND player_id IS NOT NULL)
         AND id NOT IN (SELECT player_id FROM perma_party_members)
       ORDER BY gear_score IS NULL, gear_score DESC, ign COLLATE NOCASE`
    )
    .all(raidId);
}

// Gives every party on one board that has no player of the role yet the best-geared free
// player of that role, in its first empty slot. Free means active, not placed anywhere in
// this raid, and not in a perma party (same rule as the builder's pool). Full parties are
// left alone.
raidsRouter.post("/:id/auto-assign", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, role } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });
  if (!Object.hasOwn(AUTO_ASSIGN_ROLES, role)) return res.status(400).json({ error: "Invalid role" });
  const hasRole = AUTO_ASSIGN_ROLES[role];

  const candidates = freePlayers(raidId).filter((p) => hasRole(p.class));

  const { parties } = getRaidWithSlots(raidId).boards[board];
  const setSlot = db.prepare(
    "UPDATE raid_slots SET player_id = ? WHERE raid_id = ? AND board = ? AND party_index = ? AND slot_index = ?"
  );

  let assigned = 0;
  const full = [];
  const noneLeft = [];
  transaction(() => {
    parties.forEach((members, partyIndex) => {
      if (members.some((m) => m && hasRole(m.class))) return;
      const slot = members.findIndex((m) => m == null);
      if (slot === -1) return full.push(partyIndex + 1);
      const candidate = candidates[assigned];
      if (!candidate) return noneLeft.push(partyIndex + 1);
      setSlot.run(candidate.id, raidId, board, partyIndex, slot);
      assigned++;
    });
    if (assigned > 0) db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);
  })();

  res.json({ raid: getRaidWithSlots(raidId), assigned, full, noneLeft });
});

// Fills the empty slots of every party on one board toward a full lineup: one High
// Priest, one Clown/Gypsy, one Creator, and two DPS of different classes (any non-support
// class). Players already seated count toward their party's lineup and are never moved.
// Each role is handed out across all parties before the next, so the best-geared players
// spread over the parties instead of piling into the first one.
raidsRouter.post("/:id/auto-assign-parties", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });

  const free = freePlayers(raidId);
  const parties = getRaidWithSlots(raidId).boards[board].parties.map((members) => [...members]);
  const setSlot = db.prepare(
    "UPDATE raid_slots SET player_id = ? WHERE raid_id = ? AND board = ? AND party_index = ? AND slot_index = ?"
  );

  let assigned = 0;
  // Seats the first free player passing `fits` in the party's first empty slot.
  function seat(partyIndex, fits) {
    const members = parties[partyIndex];
    const slot = members.findIndex((m) => m == null);
    if (slot === -1) return false;
    const pick = free.findIndex((p) => fits(p.class));
    if (pick === -1) return false;
    const [player] = free.splice(pick, 1);
    members[slot] = player;
    setSlot.run(player.id, raidId, board, partyIndex, slot);
    assigned++;
    return true;
  }
  const dpsClasses = (members) =>
    new Set(members.filter((m) => m && !isSupport(m.class)).map((m) => normalizeClass(m.class)));

  transaction(() => {
    for (const role of PARTY_SUPPORTS) {
      const hasRole = AUTO_ASSIGN_ROLES[role];
      parties.forEach((members, partyIndex) => {
        if (!members.some((m) => m && hasRole(m.class))) seat(partyIndex, hasRole);
      });
    }
    for (let round = 0; round < PARTY_DPS; round++) {
      parties.forEach((members, partyIndex) => {
        const taken = dpsClasses(members);
        if (taken.size >= PARTY_DPS) return;
        seat(
          partyIndex,
          (className) => className && !isSupport(className) && !taken.has(normalizeClass(className))
        );
      });
    }
    if (assigned > 0) db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);
  })();

  // What each party is still short of, for the officer to fill by hand.
  const incomplete = parties
    .map((members, partyIndex) => {
      const missing = PARTY_SUPPORTS.filter((role) => !members.some((m) => m && AUTO_ASSIGN_ROLES[role](m.class))).map(
        (role) => ROLE_LABELS[role]
      );
      const dpsShort = PARTY_DPS - Math.min(PARTY_DPS, dpsClasses(members).size);
      if (dpsShort > 0) missing.push(`${dpsShort} DPS`);
      return { party: partyIndex + 1, missing };
    })
    .filter((p) => p.missing.length > 0);

  res.json({ raid: getRaidWithSlots(raidId), assigned, incomplete });
});

// Empties one board: every slot goes back to the pool and custom party names are dropped.
// The board keeps its party count.
raidsRouter.post("/:id/clear", (req, res) => {
  const raidId = Number(req.params.id);
  const raid = db.prepare("SELECT * FROM raids WHERE id = ?").get(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });

  transaction(() => {
    db.prepare("UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND board = ?").run(raidId, board);
    db.prepare("UPDATE raid_parties SET name = NULL WHERE raid_id = ? AND board = ?").run(raidId, board);
    db.prepare("UPDATE raids SET updated_at = datetime('now') WHERE id = ?").run(raidId);
  })();

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
    !isValidBoard(raid, board) ||
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
