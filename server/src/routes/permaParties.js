import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";

export const permaPartiesRouter = Router();
permaPartiesRouter.use(requireAccess);

const MAX_MEMBERS = 5;

function listPermaParties() {
  const parties = db.prepare("SELECT id, name FROM perma_parties ORDER BY name COLLATE NOCASE ASC").all();
  const members = db
    .prepare(
      `SELECT m.perma_party_id, p.*
       FROM perma_party_members m
       JOIN players p ON p.id = m.player_id
       ORDER BY m.perma_party_id, m.slot_index`
    )
    .all();
  return parties.map((party) => ({
    ...party,
    members: members
      .filter((m) => m.perma_party_id === party.id)
      .map(({ perma_party_id: _id, ...player }) => player),
  }));
}

// Validates a create/update body. Returns { name, playerIds } or { error }.
function parseBody(body, ownId = null) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "Perma party name is required" };
  if (name.length > 60) return { error: "Perma party name must be 60 characters or fewer" };

  const playerIds = Array.isArray(body?.playerIds) ? body.playerIds : null;
  if (!playerIds || playerIds.length === 0 || playerIds.length > MAX_MEMBERS) {
    return { error: `A perma party needs 1 to ${MAX_MEMBERS} players` };
  }
  if (!playerIds.every(Number.isInteger) || new Set(playerIds).size !== playerIds.length) {
    return { error: "Invalid or duplicate players" };
  }

  const findPlayer = db.prepare("SELECT id FROM players WHERE id = ?");
  if (!playerIds.every((id) => findPlayer.get(id))) return { error: "Some players no longer exist" };

  const taken = db
    .prepare(
      `SELECT p.ign, pp.name AS party FROM perma_party_members m
       JOIN players p ON p.id = m.player_id
       JOIN perma_parties pp ON pp.id = m.perma_party_id
       WHERE m.player_id IN (${playerIds.map(() => "?").join(",")}) AND m.perma_party_id IS NOT ?`
    )
    .all(...playerIds, ownId);
  if (taken.length > 0) {
    const list = taken.map((t) => `${t.ign} (${t.party})`).join(", ");
    return { error: `Already in another perma party: ${list}` };
  }

  return { name, playerIds };
}

function saveMembers(partyId, playerIds) {
  db.prepare("DELETE FROM perma_party_members WHERE perma_party_id = ?").run(partyId);
  const insert = db.prepare(
    "INSERT INTO perma_party_members (perma_party_id, slot_index, player_id) VALUES (?, ?, ?)"
  );
  playerIds.forEach((playerId, slot) => insert.run(partyId, slot, playerId));
}

permaPartiesRouter.get("/", (req, res) => {
  res.json({ permaParties: listPermaParties() });
});

permaPartiesRouter.post("/", (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  transaction(() => {
    const info = db.prepare("INSERT INTO perma_parties (name) VALUES (?)").run(parsed.name);
    saveMembers(info.lastInsertRowid, parsed.playerIds);
  })();

  res.status(201).json({ permaParties: listPermaParties() });
});

permaPartiesRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare("SELECT id FROM perma_parties WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Perma party not found" });
  }
  const parsed = parseBody(req.body, id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  transaction(() => {
    db.prepare("UPDATE perma_parties SET name = ?, updated_at = datetime('now') WHERE id = ?").run(
      parsed.name,
      id
    );
    saveMembers(id, parsed.playerIds);
  })();

  res.json({ permaParties: listPermaParties() });
});

permaPartiesRouter.delete("/:id", (req, res) => {
  const info = db.prepare("DELETE FROM perma_parties WHERE id = ?").run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "Perma party not found" });
  res.json({ permaParties: listPermaParties() });
});
