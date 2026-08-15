# GMS Locker

AI-powered fantasy football GM command center for Pride Dynasty, built directly on live
Fantrax league data. Fantrax stays the source of truth and stays **read-only** — GMS Locker
never submits trades, cuts, or lineups back to Fantrax.

## Architecture

- **Frontend** — `index.html` (root) + `public/` (`app.js`, `styles.css`, `pride-calendar-2026.js`).
  Static, no build step. Served from the repo root (GitHub Pages, `CNAME` → `gmslocker.com`).
- **API** — `src/worker.js` (routes + auth) and `src/engine.js` (pure six-pillar analysis
  engine). Deployed as a Cloudflare Worker to `api.gmslocker.com`, backed by a D1 database.
  Entry point is `src/worker-live-news.js`, which wraps `worker.js` with the `/news` route.
- **Schema** — `src/schema.sql` is the single source of truth for the D1 schema. There is no
  separate migrations pipeline; `npm run db:init` (and CI) applies this file directly.

## Data rules (non-negotiable)

- Never invent player projections, salaries, contracts, injuries, or ownership. Missing Fantrax
  data is reported as **unavailable**, never as zero and never fabricated.
- Open roster spots are never scored as a weakness.
- Every recommendation cites that team's real Fantrax numbers — no generic "WR1" placeholders.
- Teams are graded on six pillars: legal starters, usable depth, cap health, competitive window,
  positional balance, and draft capital.

## Deploy

```sh
npm install
npm run db:init   # applies src/schema.sql to the remote D1 database
npm run deploy     # wrangler deploy
```

The frontend (root `index.html` + `public/`) is static and deploys via GitHub Pages on push to
`main`. The Worker deploys via `.github/workflows/deploy-cloudflare-worker.yml` on pushes that
touch `src/**`, `public/**`, `package.json`, or `wrangler.toml`.

## Local dev

```sh
npm run dev   # wrangler dev
```
