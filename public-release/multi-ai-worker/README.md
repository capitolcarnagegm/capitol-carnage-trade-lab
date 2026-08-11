# GMS Locker AI Gateway

This Cloudflare Worker performs live Fantrax and NFL feed refreshes and routes GM analysis to Gemini or Cloudflare Workers AI. GMS Locker is open by default; an access code remains available as an optional deployment setting.

## Routes

- `POST /auth/login`
- `GET /auth/status`
- `POST /auth/logout`
- `GET /league-data`
- `GET|POST /fantrax/live|sync`
- `GET|POST /sports/live|sync`
- `POST /gm-chat`

When `GMSLOCKER_ACCESS_TOKEN` is configured, data and AI routes require a short-lived bearer session. When it is absent, the same routes stay open for the public GMS Locker site. The health route reports whether bindings exist but never returns secret values.

## Provider modes

- `llama` — full synced-league analysis with Llama 4 Scout through Workers AI; the default mode
- `gemini` — explicit-consent, public-context-only analysis with Gemini 3.5 Flash-Lite

Gemini never receives the structured league database, roster, contracts, transactions, picks, or private memory. Only the submitted prompt, a non-identifying GM-style preference, and approved public context are forwarded.

## Required secrets

```sh
npx wrangler secret put GEMINI_API_KEY
```

`GMSLOCKER_ACCESS_TOKEN` is optional. `FANTRAX_LEAGUE_ID` can be a normal Worker variable; it is an identifier, not an authentication secret.

## Deploy

The production `wrangler.jsonc` is deployable by GitHub Actions. Keep the Gemini API key in Cloudflare secrets; `--keep-vars` preserves existing secret values during deploys.

```sh
npm install
npm run db:migrate:remote
npm test
npm run deploy
```

The D1 schema is in `migrations/`. The complete private baseline is imported separately and must not be committed to this repository.
