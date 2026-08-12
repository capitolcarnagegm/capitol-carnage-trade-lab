# GMS Locker 2.0

Clean fantasy GM SaaS rebuild.

## Architecture
- `src/worker.js` — Cloudflare Worker API
- `src/engine.js` — pure six-pillar analysis engine
- `src/schema.sql` — D1 schema
- `public/` — static frontend
- `api.gmslocker.com` — API custom domain
- `gmslocker.com` — frontend

## Data rules
Never invent player projections, salaries, injuries, ownership, or rankings. Missing data stays unavailable/null. Open roster spots are not weaknesses. Trade team options come only from synced Fantrax teams. Game Day includes scheduled/preseason games when ESPN provides them.

## Deploy
```sh
npm install
npm run db:init
npm run deploy
```

Publish the `public/` directory to the frontend host.

## Current boundary
The base Worker reads Fantrax general league endpoints for rosters, standings, picks, matchups, league info, and player IDs. Full free-agent/stat objects require the Fantrax fxpa integration layer; the UI intentionally shows Waivers and analysis as unavailable until those real objects exist.
