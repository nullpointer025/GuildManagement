// One-time copy of the old SQLite database into Supabase Postgres.
//
//   node scripts/migrate-sqlite.js path/to/guild.db
//
// Needs DATABASE_URL (server/.env) and the schema from supabase/migrations already
// applied. Refuses to run if the Postgres tables already hold data.
import "dotenv/config";
import { DatabaseSync } from "node:sqlite";
import postgres from "postgres";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/migrate-sqlite.js path/to/guild.db");
  process.exit(1);
}

// Parents before children, so foreign keys are satisfied as rows arrive.
const TABLES = [
  "players",
  "raids",
  "raid_slots",
  "raid_parties",
  "perma_parties",
  "perma_party_members",
  "guild_leagues",
  "guild_league_stats",
];
const IDENTITY_TABLES = ["players", "raids", "raid_slots", "raid_parties", "perma_parties", "guild_leagues"];

const lite = new DatabaseSync(file, { readOnly: true });
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

try {
  for (const table of TABLES) {
    const [{ n }] = await sql`SELECT COUNT(*)::int AS n FROM ${sql(table)}`;
    if (n > 0) throw new Error(`${table} already has ${n} rows in Postgres — not overwriting`);
  }

  await sql.begin(async (tx) => {
    for (const table of TABLES) {
      const columns = (await tx`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
      `).map((c) => c.column_name);
      const liteColumns = new Set(lite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      const shared = columns.filter((c) => liteColumns.has(c));

      const rows = lite.prepare(`SELECT ${shared.join(", ")} FROM ${table}`).all();
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({ ...r }));
        await tx`INSERT INTO ${tx(table)} ${tx(chunk, shared)}`;
      }
      console.log(`${table}: ${rows.length} rows`);
    }

    // Rows kept their ids, so move each id generator past the highest one.
    for (const table of IDENTITY_TABLES) {
      await tx.unsafe(
        `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
      );
    }
  });
  console.log("Done.");
} finally {
  await sql.end();
  lite.close();
}
