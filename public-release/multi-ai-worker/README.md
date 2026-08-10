# GM's Locker Private Gateway

This Cloudflare Worker protects the private league database, performs live Fantrax and NFL feed refreshes, and routes AI analysis to Gemini or Cloudflare Workers AI.

## Authenticated routes

- `POST /auth/login`
- `GET /auth/status`
- `POST /auth/logout`
- `GET /league-data`
- `GET|POST /fantrax/live|sync`
- `GET|POST /sports/live|sync`
- `POST /gm-chat`

All data and AI routes require a short-lived bearer session. The health route reports whether bindings exist but never returns secret values.

## Provider modes

- `llama` — private league analysis with Llama 4 Scout through Workers AI; the default mode
- `gemini` — explicit-consent, public-context-only analysis with Gemini 3.5 Flash-Lite

Gemini never receives the stored league database, roster, contracts, transactions, picks, or memory. Grok is a manual clipboard handoff in the browser and is never called by the Worker.

## Required secrets

```sh
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put GMSLOCKER_ACCESS_TOKEN
npx wrangler secret put FANTRAX_LEAGUE_ID
```

Never place secret values or the league ID in source, configuration variables, test fixtures, or logs.

## Deploy

Copy `wrangler.example.jsonc` to the gitignored `wrangler.jsonc`, then fill the real D1 database name and ID only in that local file or configure the binding in the Cloudflare dashboard.

```sh
npm install
npm run db:migrate:remote
npm test
npm run deploy
```

The D1 schema is in `migrations/`. The complete private baseline is imported separately and must not be committed to this repository.
