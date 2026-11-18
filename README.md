# Guild Management

A small web app for running game guilds — any number of them on one site: import the roster CSV export, keep a searchable member list, and build raid teams by dragging player cards into 5-player parties.

- **Roster** — drag & drop (or browse) a CSV export to import members. Re-importing later updates existing members by IGN, adds new ones, and flags anyone missing from the latest export instead of deleting them.
- **Discord check** — each roster row has an "In Discord" checkbox. Officers can tick it by hand. Discord sync is optional and off by default: turning it on under **Guild settings** (the ⚙ next to the guild name) asks for the guild's Discord server ID and adds a **Sync with Discord** button that sets the box for everyone by matching IGNs against server nicknames (also needs the site's `DISCORD_BOT_TOKEN` and the bot invited to the guild's server). It also re-syncs automatically after every CSV import. A sync overwrites manual ticks. An "Ultimate" checkbox sits next to it, set by hand only; neither a CSV import nor a sync changes it.
- **Raid Teams** — create named, saved raids (e.g. "Saturday WoE"), each with two independent boards, **Main** and **Sub**, sized separately and sharing one roster pool (a player assigned on one board is unavailable on the other). Drag roster cards into party slots; dragging onto an occupied slot swaps the two players, dragging back onto the roster pool benches a player. Everything is saved to the server as you go and polled live every few seconds, so officers editing the same raid at the same time see each other's changes without refreshing.
- **Guilds & access** — no individual accounts. Each guild has its own invite code, and the code decides which guild you're in: every guild's roster, raids, perma parties and league history are separate. Officers enter their guild's code once; it's remembered for 30 days.
- **Admin** — `/admin`, unlocked with `ADMIN_CODE`, lists every guild and lets you create guilds, rename them, change invite codes (which signs that guild's officers out) and delete a guild with all of its data.

## Stack

- `server/` — Node.js + Express on Supabase Postgres (via the `postgres` driver), JWT cookie sessions, and CSV parsing/merge logic. Deployed to Vercel as a serverless function (`api/index.js`).
- `client/` — React + Vite + TypeScript, Tailwind CSS for styling, `@dnd-kit` for the drag-and-drop board.

## Local development

Requires Node.js 22+ and a Supabase project (the free plan is fine). This is an npm workspaces monorepo, so a single install at the repo root sets up both `server/` and `client/`:

```bash
npm install
```

Copy `server/.env.example` to `server/.env` and fill in:

- `JWT_SECRET` — long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `ADMIN_CODE` — unlocks the `/admin` page where guilds and their invite codes are created
- `DATABASE_URL` — Supabase → **Connect** → *Transaction pooler* connection string (port 6543), with your database password filled in

Create the tables once by running each file in `supabase/migrations/` in order (`20261025000000_init.sql`, then `20261114000000_multi_guild.sql`) in the Supabase SQL editor.

Then, in two terminals:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173 (proxies /api to the server)
```

Open http://localhost:5173/admin, enter your `ADMIN_CODE`, create a guild, then go to http://localhost:5173, enter that guild's invite code, and import a CSV from the Roster page.

## CSV format

Expects the export's header row to include at least a `Player` column (the IGN). It also reads `Lv.`, `Class`, `Title`, `Gender`, `Position`, `Gear Score`, `Weekly`, `Weekly Contribution`, `Total Contribution`, and `Online Status` when present — matching the game's own export format.

## Deploying (Vercel + Supabase)

Vercel serves the built client as static files and runs the API (`server/src/app.js`) as one serverless function, configured in `vercel.json`. Data lives in Supabase Postgres. Guild League battle records (the in-game .xlsx export) are read in the browser, so the file itself is never uploaded.

1. **Supabase:** create a project, then run the files in `supabase/migrations/` in order in the SQL editor. Copy the *Transaction pooler* connection string from **Connect**.
2. **Vercel:** "Add New → Project", import this GitHub repo, keep the root directory as the repo root (`vercel.json` sets the build). Add the environment variables:
   - `DATABASE_URL` — the pooler connection string from step 1
   - `JWT_SECRET` — long random string
   - `ADMIN_CODE` — unlocks `/admin` to create guilds
   - `NODE_ENV=production`
   - `DISCORD_BOT_TOKEN` — optional, the shared bot for the Discord sync
3. **Domain:** Vercel project → Settings → Domains → add `guildmanager.site` and set the DNS records it shows at your registrar.
4. Every push to `main` redeploys.

### Upgrading a single-guild install

`20261114000000_multi_guild.sql` moves existing data into a first guild. Before running it, replace `'CHANGE-ME'` in the file with your old `GUILD_INVITE_CODE` so officers keep using the same code (or change it later on `/admin`). Then in Vercel remove `GUILD_INVITE_CODE` and `DISCORD_GUILD_ID`, add `ADMIN_CODE`, and, to keep Discord sync, turn it on under Guild settings with the old server ID. Everyone has to enter their code once more after the deploy.

`vercel.json` pins the functions to Tokyo (`hnd1`) to sit next to the Supabase database (ap-northeast-1). Change both together if you move regions.

### Moving data from the old SQLite database

Copy `guild.db` from the old host, then with `DATABASE_URL` set and the schema created:

```bash
node server/scripts/migrate-sqlite.js path/to/guild.db
```

It copies every table and keeps all ids. It refuses to run if the Postgres tables already contain data. Run it after `20261025000000_init.sql` but **before** `20261114000000_multi_guild.sql`, which then moves the copied data into the first guild.

### Free-plan note

Supabase pauses free projects after about a week without activity. If the app hasn't been used for a while, restore the project from the Supabase dashboard.

Once it's behind HTTPS, cookies are marked `secure` automatically in production, so entering the invite code only works over `https://`.
