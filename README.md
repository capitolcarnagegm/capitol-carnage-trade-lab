# GMS Locker

AI-powered fantasy football GM command center for Pride Dynasty, built directly on live
Fantrax league data. Fantrax stays the source of truth and stays **read-only** — GMS Locker
never submits trades, cuts, or lineups back to Fantrax.

## Architecture

- **Frontend** — `index.html` (root) + `public/` (`app.js`, `styles.css`, `pride-calendar-2026.js`).
  Static, no build step. Deployed as a Cloudflare Worker Static Assets site (`wrangler-site.toml`,
  Worker name `gmslocker-site`) that claims `gmslocker.com` and `www.gmslocker.com` as custom
  domains. Deploys via `.github/workflows/deploy-site.yml` on pushes touching frontend files.
  The repo also has a leftover `CNAME` file from an earlier assumption that GitHub Pages served
  this domain — that was never confirmed to actually be live. Treat the Worker deploy above as
  the current source of truth for what serves `gmslocker.com`.
- **API** — `src/worker.js` (routes + auth) and `src/engine.js` (pure six-pillar analysis
  engine). Deployed as a Cloudflare Worker to `api.gmslocker.com`, backed by a D1 database.
  Entry point is `src/worker-live-news.js`, which wraps `worker.js` with the `/news` route.
  Deploys via `.github/workflows/deploy-cloudflare-worker.yml`.
- **Schema** — `src/schema.sql` is the single source of truth for the D1 schema. There is no
  separate migrations pipeline; `npm run db:init` (and CI) applies this file directly.

## Data rules (non-negotiable)

- Never invent player projections, salaries, contracts, injuries, or ownership. Missing Fantrax
  data is reported as **unavailable**, never as zero and never fabricated.
- Open roster spots are never scored as a weakness.
- Every recommendation cites that team's real Fantrax numbers — no generic "WR1" placeholders.
- Teams are graded on six pillars: legal starters, usable depth, cap health, competitive window,
  positional balance, and draft capital.
- Free-agent verdicts are driven primarily by that specific team's real need (missing legal
  starters, thin above-replacement depth) — a strong player is not an automatic PICK UP for a
  team that doesn't need that position, and a team with zero cap room cannot get a PICK UP
  regardless of talent. See `GMSAnalysisEngine.recommendFreeAgents` in `src/engine.js`.
- Boom/bust volatility comes from a real per-week scoring log pulled from Fantrax (`fetchWeeklyLog`
  in `src/worker.js`). It is validated (`GMSAnalysisEngine.weeklyLogLooksReal`) before use — if
  Fantrax doesn't return genuinely varying week-to-week data, volatility is reported as
  unavailable rather than fabricated. This roughly doubles sync latency (17 extra parallel
  Fantrax requests); revisit `maxWeeks` in `fetchWeeklyLog` if that becomes a problem.

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
