import { Router } from "express";
import { db, transaction } from "../db.js";
import { requireAccess } from "../auth.js";

export const permaPartiesRouter = Router();
permaPartiesRouter.use(requireAccess);

const MAX_MEMBERS = 5;

async function listPermaParties() {
  const [parties, members] = await Promise.all([
    db.all("SELECT id, name FROM perma_parties ORDER BY lower(name) ASC"),
    db.all(
      `SELECT m.perma_party_id, p.*
       FROM perma_party_members m
       JOIN players p ON p.id = m.player_id
       ORDER BY m.perma_party_id, m.slot_index`
    ),
  ]);
  return parties.map((party) => ({
    ...party,
    members: members
      .filter((m) => m.perma_party_id === party.id)
      .map(({ perma_party_id: _id, ...player }) => player),
  }));
}

// Validates a create/update body. Returns { name, playerIds } or { error }.
async function parseBody(body, ownId = null) {
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

  const placeholders = playerIds.map(() => "?").join(",");
  const found = await db.get(`SELECT COUNT(*) AS n FROM players WHERE id IN (${placeholders})`, ...playerIds);
  if (found.n !== playerIds.length) return { error: "Some players no longer exist" };

  const taken = await db.all(
    `SELECT p.ign, pp.name AS party FROM perma_party_members m
     JOIN players p ON p.id = m.player_id
     JOIN perma_parties pp ON pp.id = m.perma_party_id
     WHERE m.player_id IN (${placeholders}) AND m.perma_party_id IS DISTINCT FROM ?::bigint`,
    ...playerIds,
    ownId
  );
  if (taken.length > 0) {
    const list = taken.map((t) => `${t.ign} (${t.party})`).join(", ");
    return { error: `Already in another perma party: ${list}` };
  }

  return { name, playerIds };
}

async function saveMembers(partyId, playerIds) {
  await db.run("DELETE FROM perma_party_members WHERE perma_party_id = ?", partyId);
  for (const [slot, playerId] of playerIds.entries()) {
    await db.run(
      "INSERT INTO perma_party_members (perma_party_id, slot_index, player_id) VALUES (?, ?, ?)",
      partyId,
      slot,
      playerId
    );
  }
}

permaPartiesRouter.get("/", async (req, res) => {
  res.json({ permaParties: await listPermaParties() });
});

permaPartiesRouter.post("/", async (req, res) => {
  const parsed = await parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  await transaction(async () => {
    const info = await db.run("INSERT INTO perma_parties (name) VALUES (?) RETURNING id", parsed.name);
    await saveMembers(info.id, parsed.playerIds);
  });

  res.status(201).json({ permaParties: await listPermaParties() });
});

permaPartiesRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!(await db.get("SELECT id FROM perma_parties WHERE id = ?", id))) {
    return res.status(404).json({ error: "Perma party not found" });
  }
  const parsed = await parseBody(req.body, id);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  await transaction(async () => {
    await db.run("UPDATE perma_parties SET name = ?, updated_at = now_text() WHERE id = ?", parsed.name, id);
    await saveMembers(id, parsed.playerIds);
  });

  res.json({ permaParties: await listPermaParties() });
});

permaPartiesRouter.delete("/:id", async (req, res) => {
  const info = await db.run("DELETE FROM perma_parties WHERE id = ?", Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: "Perma party not found" });
  res.json({ permaParties: await listPermaParties() });
});
