import { db } from "./db.js";
import { LEAGUE_STATS } from "./leagueImport.js";
import { createRosterMatcher, normalizeName } from "./nameMatch.js";

// Keeps guild league stats attached to the right player when the roster is
// re-imported from the guild CSV. Both run inside the roster import's transaction.

const STAT_COLUMNS = LEAGUE_STATS.map((s) => s.column);

// Renamed players. When the new roster has a name that isn't a player yet, but an
// officer already assigned that exact name from a battle record to a player who is
// missing from the new roster, it's that player under a new name: they're renamed
// (keeping their id and therefore all their league stats) instead of the import
// creating a second, empty player. Returns how many players were renamed.
export async function renamePlayersFromLeagueNames(guildId, importIgns) {
  const players = await db.all("SELECT id, ign FROM players WHERE guild_id = ?", guildId);
  const existing = new Set(players.map((p) => p.ign));
  const imported = new Set(importIgns);
  // Players the import doesn't name: the only ones that can have been renamed.
  const missing = new Map(players.filter((p) => !imported.has(p.ign)).map((p) => [p.id, p]));
  if (missing.size === 0) return 0;

  // Names each of those players was recorded under in battle records.
  const recorded = await db.all(
    `SELECT DISTINCT s.player_id, s.ign
     FROM guild_league_stats s JOIN guild_leagues l ON l.id = s.league_id
     WHERE l.guild_id = ?`,
    guildId
  );
  const candidatesByName = new Map();
  for (const r of recorded) {
    if (!missing.has(r.player_id)) continue;
    const key = normalizeName(r.ign);
    if (!candidatesByName.has(key)) candidatesByName.set(key, new Set());
    candidatesByName.get(key).add(r.player_id);
  }

  let renamed = 0;
  const taken = new Set();
  for (const ign of importIgns) {
    if (existing.has(ign)) continue;
    const candidates = [...(candidatesByName.get(normalizeName(ign)) ?? [])].filter((id) => !taken.has(id));
    // Two players recorded under the same name: too ambiguous to guess.
    if (candidates.length !== 1) continue;
    const [id] = candidates;
    taken.add(id);
    await db.run("UPDATE players SET ign = ?, updated_at = now_text() WHERE id = ? AND guild_id = ?", ign, id, guildId);
    renamed++;
  }
  return renamed;
}

// Moves battle-record rows saved as "not in the roster yet" onto the active roster
// player they match, unless that player already has a line for that league.
// Returns how many rows were linked.
export async function linkPendingLeagueStats(guildId) {
  const pending = await db.all(
    `SELECT p.* FROM guild_league_pending p JOIN guild_leagues l ON l.id = p.league_id WHERE l.guild_id = ?`,
    guildId
  );
  if (pending.length === 0) return 0;

  const matchPlayer = createRosterMatcher(
    await db.all("SELECT id, ign, active FROM players WHERE guild_id = ? AND active = 1", guildId)
  );
  const recorded = new Set(
    (
      await db.all(
        `SELECT s.league_id, s.player_id FROM guild_league_stats s JOIN guild_leagues l ON l.id = s.league_id
         WHERE l.guild_id = ?`,
        guildId
      )
    ).map((s) => `${s.league_id}:${s.player_id}`)
  );

  const linked = [];
  for (const row of pending) {
    const playerId = matchPlayer(row.ign);
    if (playerId == null || recorded.has(`${row.league_id}:${playerId}`)) continue;
    recorded.add(`${row.league_id}:${playerId}`);
    linked.push({ ...row, player_id: playerId });
  }
  if (linked.length === 0) return 0;

  await db.run(
    `INSERT INTO guild_league_stats (league_id, player_id, ign, job, ${STAT_COLUMNS.join(", ")})
     SELECT league_id, player_id, ign, job, ${STAT_COLUMNS.join(", ")}
     FROM jsonb_to_recordset(?::text::jsonb) AS r(
       league_id bigint, player_id bigint, ign text, job text, ${STAT_COLUMNS.map((c) => `${c} bigint`).join(", ")}
     )`,
    JSON.stringify(linked)
  );
  await db.run(
    "DELETE FROM guild_league_pending WHERE id IN (SELECT (jsonb_array_elements_text(?::text::jsonb))::bigint)",
    JSON.stringify(linked.map((r) => r.id))
  );
  return linked.length;
}
