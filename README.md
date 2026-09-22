# Guild Management

A small web app for running a game guild: import the roster CSV export, keep a searchable member list, and build raid teams by dragging player cards into 5-player parties.

- **Roster** — drag & drop (or browse) a CSV export to import members. Re-importing later updates existing members by IGN, adds new ones, and flags anyone missing from the latest export instead of deleting them.
- **Raid Teams** — create named, saved raids (e.g. "Saturday WoE"), each with two independent boards, **Main** and **Sub**, sized separately and sharing one roster pool (a player assigned on one board is unavailable on the other). Drag roster cards into party slots; dragging onto an occupied slot swaps the two players, dragging back onto the roster pool benches a player. Everything is saved to the server as you go and polled live every few seconds, so officers editing the same raid at the same time see each other's changes without refreshing.
- **Access** — no individual accounts. Everyone who wants in enters one shared guild invite code you set yourself; it's remembered for 30 days.

## Stack

- `server/` — Node.js + Express, using Node's built-in `node:sqlite` (no native build step) for storage, JWT cookie sessions, and CSV parsing/merge logic.
- `client/` — React + Vite + TypeScript, Tailwind CSS for styling, `@dnd-kit` for the drag-and-drop board.

## Local development

Requires Node.js 22.5+ (uses the built-in `node:sqlite` module — Node 24 is what this was built/tested with). This is an npm workspaces monorepo, so a single install at the repo root sets up both `server/` and `client/`:

```bash
npm install
```

Copy `server/.env.example` to `server/.env` and fill in:

- `JWT_SECRET` — long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `GUILD_INVITE_CODE` — the single shared code officers enter to get in

Then, in two terminals:

```bash
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173 (proxies /api to the server)
```

Open http://localhost:5173, enter your invite code, and import a CSV from the Roster page.

## CSV format

Expects the export's header row to include at least a `Player` column (the IGN). It also reads `Lv.`, `Class`, `Title`, `Gender`, `Position`, `Gear Score`, `Weekly`, `Weekly Contribution`, `Total Contribution`, and `Online Status` when present — matching the game's own export format.

## Deploying so other officers can reach it over HTTPS

The server serves the built client itself, so the whole app is one Node process — no separate frontend host needed. It's a plain `npm install && npm run build && npm start` at the repo root (npm workspaces), so it deploys cleanly to any zero-config Node host.

This app is **not** a fit for Vercel: Vercel's hosting is serverless (stateless functions, filesystem reset on every deploy), and this app keeps its data in a local SQLite file that needs to persist on disk between requests. Use a host that runs a real, persistent Node process instead — [Railway](https://railway.app) is the easiest for this project. Steps:

1. **Push the repo to GitHub.** Create an empty repo at github.com/new, then from the repo root:
   ```bash
   git add -A
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. **Create a Railway project** → "Deploy from GitHub repo" → pick this repo. Railway detects Node automatically (via Nixpacks) and runs `npm install`, `npm run build`, `npm start` at the repo root — no config needed.
3. **Add a persistent volume** (Railway dashboard → your service → Settings → Volumes): mount it at `/data`. Then set the environment variable `DATA_DIR=/data` so the SQLite file lives on that volume instead of the container's throwaway disk.
4. **Set environment variables** on the service (Settings → Variables):
   - `NODE_ENV=production`
   - `JWT_SECRET` — long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `GUILD_INVITE_CODE` — the single shared code you'll give your officers
   - `DATA_DIR=/data` (from step 3)
   - Leave `PORT` unset — Railway injects it automatically and the server already reads `process.env.PORT`.
5. **Point guildmanager.site at Railway:** in the Railway service → Settings → Networking → Custom Domain, add `guildmanager.site` (and/or `www.guildmanager.site`). Railway gives you a CNAME target. Go to your domain registrar's DNS settings and add a CNAME record for that host pointing at the value Railway gives you (for the bare root domain some registrars require an ALIAS/ANAME record instead of CNAME — Railway's dashboard tells you which to use). Railway provisions the HTTPS certificate automatically once DNS resolves.
6. From then on, every `git push` to `main` auto-redeploys on Railway.

Render or Fly.io work the same way if you'd rather use one of those — same idea: a persistent volume for `/data`, `DATA_DIR` pointed at it, and the same environment variables.

Once it's behind HTTPS, cookies are marked `secure` automatically in production, so entering the invite code only works over `https://`.
