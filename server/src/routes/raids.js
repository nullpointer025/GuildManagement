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

const SET_SLOT =
  "UPDATE raid_slots SET player_id = ? WHERE raid_id = ? AND board = ? AND party_index = ? AND slot_index = ?";

const UPSERT_PARTY_NAME = `INSERT INTO raid_parties (raid_id, board, party_index, name) VALUES (?, ?, ?, ?)
  ON CONFLICT (raid_id, board, party_index) DO UPDATE SET name = excluded.name`;

function boardsOf(raid) {
  return Object.hasOwn(RAID_TYPE_BOARDS, raid.type) ? RAID_TYPE_BOARDS[raid.type] : RAID_TYPE_BOARDS.guild_league;
}

function isValidBoard(raid, board) {
  return boardsOf(raid).includes(board);
}

function findRaid(raidId) {
  return db.get("SELECT * FROM raids WHERE id = ?", raidId);
}

function touchRaid(raidId) {
  return db.run("UPDATE raids SET updated_at = now_text() WHERE id = ?", raidId);
}

async function boardPartyCount(raidId, board) {
  const row = await db.get("SELECT COUNT(*) AS n FROM raid_parties WHERE raid_id = ? AND board = ?", raidId, board);
  return row.n;
}

// Adds parties [from, to) to a board, each with 5 empty slots.
async function addParties(raidId, board, from, to) {
  if (to <= from) return;
  await db.run(
    `INSERT INTO raid_parties (raid_id, board, party_index, name)
     SELECT ?::bigint, ?::text, p, NULL FROM generate_series(?::int, ?::int) AS p`,
    raidId, board, from, to - 1
  );
  await db.run(
    `INSERT INTO raid_slots (raid_id, board, party_index, slot_index, player_id)
     SELECT ?::bigint, ?::text, p, s, NULL FROM generate_series(?::int, ?::int) AS p, generate_series(0, 4) AS s`,
    raidId, board, from, to - 1
  );
}

function emptyBoardShape(partyCount) {
  return {
    parties: Array.from({ length: partyCount }, () => Array(5).fill(null)),
    partyNames: Array(partyCount).fill(null),
  };
}

async function getRaidWithSlots(raidId) {
  const raid = await findRaid(raidId);
  if (!raid) return null;

  const [slots, nameRows] = await Promise.all([
    db.all(
      `SELECT rs.board, rs.party_index, rs.slot_index, rs.player_id, p.*
       FROM raid_slots rs
       LEFT JOIN players p ON p.id = rs.player_id
       WHERE rs.raid_id = ?
       ORDER BY rs.party_index ASC, rs.slot_index ASC`,
      raidId
    ),
    db.all("SELECT board, party_index, name FROM raid_parties WHERE raid_id = ?", raidId),
  ]);

  // A board has one raid_parties row per party, so those rows give its size.
  const sizes = {};
  for (const row of nameRows) sizes[row.board] = (sizes[row.board] ?? 0) + 1;
  const boards = Object.fromEntries(boardsOf(raid).map((board) => [board, emptyBoardShape(sizes[board] ?? 0)]));

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

  for (const row of nameRows) {
    const board = boards[row.board];
    if (board && row.party_index < board.partyNames.length) {
      board.partyNames[row.party_index] = row.name;
    }
  }

  return { ...raid, boards };
}

raidsRouter.get("/", async (req, res) => {
  const [raids, counts] = await Promise.all([
    db.all("SELECT id, name, type, created_at, updated_at FROM raids ORDER BY updated_at DESC"),
    db.all("SELECT raid_id, board, COUNT(*) AS n FROM raid_parties GROUP BY raid_id, board"),
  ]);
  const countOf = new Map(counts.map((c) => [`${c.raid_id}:${c.board}`, c.n]));
  const withCounts = raids.map((raid) => ({
    ...raid,
    partyCounts: Object.fromEntries(boardsOf(raid).map((board) => [board, countOf.get(`${raid.id}:${board}`) ?? 0])),
  }));
  res.json({ raids: withCounts });
});

raidsRouter.post("/", async (req, res) => {
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

  const raidId = await transaction(async () => {
    const info = await db.run("INSERT INTO raids (name, type) VALUES (?, ?) RETURNING id", trimmedName, type);
    for (const board of RAID_TYPE_BOARDS[type]) {
      await addParties(info.id, board, 0, preset?.[board] ?? count);
    }
    return info.id;
  });

  res.status(201).json({ raid: await getRaidWithSlots(raidId) });
});

raidsRouter.get("/:id", async (req, res) => {
  const raid = await getRaidWithSlots(Number(req.params.id));
  if (!raid) return res.status(404).json({ error: "Raid not found" });
  res.json({ raid });
});

raidsRouter.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const existing = await findRaid(id);
  if (!existing) return res.status(404).json({ error: "Raid not found" });

  const { name } = req.body ?? {};
  if (name != null) {
    const trimmedName = String(name).trim();
    if (!trimmedName) return res.status(400).json({ error: "Raid name cannot be empty" });
    await db.run("UPDATE raids SET name = ?, updated_at = now_text() WHERE id = ?", trimmedName, id);
  }

  res.json({ raid: await getRaidWithSlots(id) });
});

// Grow/shrink ONE board's party count. Each board is sized independently.
raidsRouter.patch("/:id/party-count", async (req, res) => {
  const id = Number(req.params.id);
  const raid = await findRaid(id);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, partyCount } = req.body ?? {};
  const count = Number(partyCount);
  if (!isValidBoard(raid, board) || !Number.isInteger(count) || count < 1 || count > 50) {
    return res.status(400).json({ error: "Invalid board or party count (must be 1-50)" });
  }

  await transaction(async () => {
    const current = await boardPartyCount(id, board);
    if (count > current) {
      await addParties(id, board, current, count);
    } else if (count < current) {
      await db.run("DELETE FROM raid_slots WHERE raid_id = ? AND board = ? AND party_index >= ?", id, board, count);
      await db.run("DELETE FROM raid_parties WHERE raid_id = ? AND board = ? AND party_index >= ?", id, board, count);
    }
    await touchRaid(id);
  });

  res.json({ raid: await getRaidWithSlots(id) });
});

// Shared notes for the whole raid (not per-board). notes_updated_at is tracked
// separately from updated_at so clients can tell "someone edited the notes"
// apart from routine slot/party activity, to drive an unread indicator.
raidsRouter.patch("/:id/notes", async (req, res) => {
  const id = Number(req.params.id);
  const raid = await findRaid(id);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
  await db.run(
    "UPDATE raids SET notes = ?, notes_updated_at = now_text(), updated_at = now_text() WHERE id = ?",
    notes,
    id
  );

  res.json({ raid: await getRaidWithSlots(id) });
});

raidsRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const info = await db.run("DELETE FROM raids WHERE id = ?", id);
  if (info.changes === 0) return res.status(404).json({ error: "Raid not found" });
  res.json({ ok: true });
});

// Assign (or clear) a single slot on one board. Clears the player's previous slot
// anywhere in this raid — on ANY board — so a player can never be double-booked
// across boards, nor hold two slots on the same board.
raidsRouter.put("/:id/slots", async (req, res) => {
  const raidId = Number(req.params.id);
  const raid = await findRaid(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, partyIndex, slotIndex, playerId } = req.body ?? {};
  if (
    !isValidBoard(raid, board) ||
    !Number.isInteger(partyIndex) ||
    !Number.isInteger(slotIndex) ||
    partyIndex < 0 ||
    partyIndex >= (await boardPartyCount(raidId, board)) ||
    slotIndex < 0 ||
    slotIndex >= 5
  ) {
    return res.status(400).json({ error: "Invalid board/party/slot index" });
  }

  await transaction(async () => {
    if (playerId != null) {
      await db.run("UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND player_id = ?", raidId, playerId);
    }
    await db.run(SET_SLOT, playerId ?? null, raidId, board, partyIndex, slotIndex);
    await touchRaid(raidId);
  });

  res.json({ raid: await getRaidWithSlots(raidId) });
});

// Places perma parties into the parties the officer picked on one board, naming
// each party after its perma party. The board's party count never changes. Anyone
// already in a target party goes back to the pool; members who have left the guild
// (inactive) are skipped. A perma party with any member already deployed in this
// raid (on any board) is refused, so it can only be placed once per raid.
raidsRouter.post("/:id/apply-perma-parties", async (req, res) => {
  const raidId = Number(req.params.id);
  const raid = await findRaid(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, assignments } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });
  if (!Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({ error: "Select at least one perma party" });
  }
  const partyCount = await boardPartyCount(raidId, board);
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

  const skipped = [];
  const toPlace = [];
  for (const { permaPartyId, partyIndex } of assignments) {
    const party = await db.get("SELECT id, name FROM perma_parties WHERE id = ?", permaPartyId);
    if (!party) return res.status(400).json({ error: "Some perma parties no longer exist" });
    const members = await db.all(
      `SELECT p.id, p.ign, p.active FROM perma_party_members m
       JOIN players p ON p.id = m.player_id
       WHERE m.perma_party_id = ? ORDER BY m.slot_index`,
      party.id
    );
    skipped.push(...members.filter((m) => m.active !== 1).map((m) => m.ign));
    const active = members.filter((m) => m.active === 1);
    const deployed = active.length
      ? await db.get(
          `SELECT board, party_index FROM raid_slots
           WHERE raid_id = ? AND player_id IN (${active.map(() => "?").join(",")}) LIMIT 1`,
          raidId,
          ...active.map((m) => m.id)
        )
      : null;
    if (deployed) {
      return res.status(400).json({
        error: `${party.name} is already deployed on ${BOARD_LABELS[deployed.board] ?? deployed.board} (Party ${deployed.party_index + 1})`,
      });
    }
    toPlace.push({ ...party, partyIndex, members: active });
  }

  await transaction(async () => {
    for (const party of toPlace) {
      await db.run(
        "UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND board = ? AND party_index = ?",
        raidId,
        board,
        party.partyIndex
      );
      for (const [slot, member] of party.members.entries()) {
        await db.run(SET_SLOT, member.id, raidId, board, party.partyIndex, slot);
      }
      await db.run(UPSERT_PARTY_NAME, raidId, board, party.partyIndex, party.name);
    }
    await touchRaid(raidId);
  });

  res.json({ raid: await getRaidWithSlots(raidId), skipped });
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
  return db.all(
    `SELECT id, class FROM players
     WHERE active = 1
       AND id NOT IN (SELECT player_id FROM raid_slots WHERE raid_id = ? AND player_id IS NOT NULL)
       AND id NOT IN (SELECT player_id FROM perma_party_members)
     ORDER BY gear_score IS NULL, gear_score DESC, lower(ign)`,
    raidId
  );
}

// Gives every party on one board that has no player of the role yet the best-geared free
// player of that role, in its first empty slot. Free means active, not placed anywhere in
// this raid, and not in a perma party (same rule as the builder's pool). Full parties are
// left alone.
raidsRouter.post("/:id/auto-assign", async (req, res) => {
  const raidId = Number(req.params.id);
  const raid = await findRaid(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board, role } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });
  if (!Object.hasOwn(AUTO_ASSIGN_ROLES, role)) return res.status(400).json({ error: "Invalid role" });
  const hasRole = AUTO_ASSIGN_ROLES[role];

  const candidates = (await freePlayers(raidId)).filter((p) => hasRole(p.class));
  const { parties } = (await getRaidWithSlots(raidId)).boards[board];

  const seats = [];
  const full = [];
  const noneLeft = [];
  parties.forEach((members, partyIndex) => {
    if (members.some((m) => m && hasRole(m.class))) return;
    const slot = members.findIndex((m) => m == null);
    if (slot === -1) return full.push(partyIndex + 1);
    const candidate = candidates[seats.length];
    if (!candidate) return noneLeft.push(partyIndex + 1);
    seats.push({ playerId: candidate.id, partyIndex, slot });
  });

  if (seats.length > 0) {
    await transaction(async () => {
      for (const s of seats) await db.run(SET_SLOT, s.playerId, raidId, board, s.partyIndex, s.slot);
      await touchRaid(raidId);
    });
  }

  res.json({ raid: await getRaidWithSlots(raidId), assigned: seats.length, full, noneLeft });
});

// Fills the empty slots of every party on one board toward a full lineup: one High
// Priest, one Clown/Gypsy, one Creator, and two DPS of different classes (any non-support
// class). Players already seated count toward their party's lineup and are never moved.
// Each role is handed out across all parties before the next, so the best-geared players
// spread over the parties instead of piling into the first one.
raidsRouter.post("/:id/auto-assign-parties", async (req, res) => {
  const raidId = Number(req.params.id);
  const raid = await findRaid(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });

  const free = await freePlayers(raidId);
  const parties = (await getRaidWithSlots(raidId)).boards[board].parties.map((members) => [...members]);

  // Seats are picked in memory, then written in one transaction.
  const seats = [];
  // Seats the first free player passing `fits` in the party's first empty slot.
  function seat(partyIndex, fits) {
    const members = parties[partyIndex];
    const slot = members.findIndex((m) => m == null);
    if (slot === -1) return false;
    const pick = free.findIndex((p) => fits(p.class));
    if (pick === -1) return false;
    const [player] = free.splice(pick, 1);
    members[slot] = player;
    seats.push({ playerId: player.id, partyIndex, slot });
    return true;
  }
  const dpsClasses = (members) =>
    new Set(members.filter((m) => m && !isSupport(m.class)).map((m) => normalizeClass(m.class)));

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

  if (seats.length > 0) {
    await transaction(async () => {
      for (const s of seats) await db.run(SET_SLOT, s.playerId, raidId, board, s.partyIndex, s.slot);
      await touchRaid(raidId);
    });
  }

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

  res.json({ raid: await getRaidWithSlots(raidId), assigned: seats.length, incomplete });
});

// Empties one board: every slot goes back to the pool and custom party names are dropped.
// The board keeps its party count.
raidsRouter.post("/:id/clear", async (req, res) => {
  const raidId = Number(req.params.id);
  const raid = await findRaid(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board } = req.body ?? {};
  if (!isValidBoard(raid, board)) return res.status(400).json({ error: "Invalid board" });

  await transaction(async () => {
    await db.run("UPDATE raid_slots SET player_id = NULL WHERE raid_id = ? AND board = ?", raidId, board);
    await db.run("UPDATE raid_parties SET name = NULL WHERE raid_id = ? AND board = ?", raidId, board);
    await touchRaid(raidId);
  });

  res.json({ raid: await getRaidWithSlots(raidId) });
});

// Set (or clear, with an empty/omitted name) a party's custom display name on one board.
raidsRouter.patch("/:id/parties/:partyIndex", async (req, res) => {
  const raidId = Number(req.params.id);
  const partyIndex = Number(req.params.partyIndex);
  const raid = await findRaid(raidId);
  if (!raid) return res.status(404).json({ error: "Raid not found" });

  const { board } = req.body ?? {};
  if (
    !isValidBoard(raid, board) ||
    !Number.isInteger(partyIndex) ||
    partyIndex < 0 ||
    partyIndex >= (await boardPartyCount(raidId, board))
  ) {
    return res.status(400).json({ error: "Invalid board/party index" });
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() || null : null;

  await db.run(UPSERT_PARTY_NAME, raidId, board, partyIndex, name);
  await touchRaid(raidId);

  res.json({ raid: await getRaidWithSlots(raidId) });
});
