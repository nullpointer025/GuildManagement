import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";

// Supabase Postgres. Use the pooled "Transaction" connection string (port 6543) —
// serverless functions open many short-lived connections, which the pooler absorbs.
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to server/.env");
}

const sql = postgres(process.env.DATABASE_URL, {
  // The transaction pooler can't keep prepared statements between queries.
  prepare: false,
  max: 1,
  idle_timeout: 20,
  // COUNT(*) and BIGINT stats come back as strings by default; every value here
  // fits a JS number, so hand them to routes as plain numbers like SQLite did.
  types: {
    bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) },
  },
});

// Queries inside transaction() run on its connection without having to pass it
// around: the active transaction is tracked per async call chain.
const currentTx = new AsyncLocalStorage();

// postgres.js pipelines concurrent queries on one connection, which hangs behind
// Supabase's transaction pooler. Everything outside a transaction therefore runs
// one at a time; a transaction holds the line until it commits.
let line = Promise.resolve();
function inLine(fn) {
  const result = line.then(fn);
  line = result.catch(() => {});
  return result;
}

function run(query, params) {
  // Routes write SQLite-style "?" placeholders; Postgres wants $1, $2, ...
  let n = 0;
  const text = query.replace(/\?/g, () => `$${++n}`);
  const tx = currentTx.getStore();
  return tx ? tx.unsafe(text, params) : inLine(() => sql.unsafe(text, params));
}

export const db = {
  async get(query, ...params) {
    const rows = await run(query, params);
    return rows[0];
  },
  async all(query, ...params) {
    return [...(await run(query, params))];
  },
  // { changes, id } — id is the first returned row's id, for "INSERT ... RETURNING id".
  async run(query, ...params) {
    const rows = await run(query, params);
    return { changes: rows.count, id: rows[0]?.id };
  },
};

export function transaction(fn) {
  return inLine(() => sql.begin((tx) => currentTx.run(tx, fn)));
}
