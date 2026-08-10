# GM's Locker

GM's Locker is a private dynasty-football operating system for roster management, free agency, trades, draft picks, league analysis, and AI-assisted decisions.

The public GitHub Pages build contains only the application shell. League data, the Fantrax league identifier, access credentials, and AI keys are kept out of the repository and are served through an authenticated Cloudflare Worker.

## Current data coverage

- Fantrax teams and current rosters
- Current Fantrax player pool and free agents
- Player status and eligible-position tags
- League roster, pool, scoring, and draft settings
- Standings, live matchups, draft picks, and draft results
- Adds, drops, roster moves, and status changes detected after the first live snapshot
- NFL game-score updates every five minutes
- Linked NFL news updates every fifteen minutes, with conservative holdout, injury, transaction, and contract tags
- Private Cloudflare Llama analysis with a hard daily free-tier safety ceiling
- Optional Gemini public-context analysis with explicit data-use consent and no stored league context

Fantrax's documented public API does not provide a complete historical transaction or trade ledger. The first roster sync establishes a baseline; GM's Locker records changes after that point. Existing history can still be added with the application's reviewed screenshot/manual transaction import.

Private league context is routed only to Cloudflare Workers AI. Gemini free-tier requests are opt-in and contain only the user's typed Gemini conversation plus public NFL score/news context; the Worker enforces that boundary server-side.

## Worker setup

The Worker project is in `multi-ai-worker/` and uses D1 plus a Workers AI binding.

```sh
cd multi-ai-worker
npm install
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GMSLOCKER_ACCESS_TOKEN
npx wrangler secret put FANTRAX_LEAGUE_ID
npm run db:migrate:remote
npm run deploy
```

Secret values must never be added to `wrangler.jsonc`, HTML, tests, commits, or build logs.

## Private baseline import

Generate the D1 import file outside the repository, then upload it directly to D1:

```sh
node scripts/build-private-d1-import.mjs /private/path/league-data.json /tmp/gmslocker-private-import.sql
cd multi-ai-worker
npx wrangler d1 execute gms-locker-db --remote --file /tmp/gmslocker-private-import.sql
```

The generated SQL contains the complete private league dataset and must not be committed.

## Validation

```sh
cd multi-ai-worker
npm test
cd ..
node --test test/*.test.mjs
```
