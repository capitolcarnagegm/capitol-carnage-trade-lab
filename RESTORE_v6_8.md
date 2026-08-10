# GM's Locker v6.8.0-pride-fantrax — Restore Complete

## What is live now
- Root `index.html` redirects to `/public-release/` (full app)
- `public-release/index.html` = full GM's Locker UI (v6.7 Fantrax base)
- `public-release/pride-override.js` = forces Pride Dynasty / Capitol Carnage defaults
- `worker/wrangler.jsonc` has `FANTRAX_LEAGUE_ID=astbqxhwmk4b6bg9`

## You must still do in Cloudflare
1. Deploy the worker:
   ```
   cd multi-ai-worker   # or worker/
   npx wrangler deploy
   ```
2. Confirm secret exists:
   ```
   npx wrangler secret list
   # must show GEMINI_API_KEY
   ```
3. Confirm var:
   FANTRAX_LEAGUE_ID = astbqxhwmk4b6bg9

4. After deploy, force sync:
   POST https://gms-locker-ai.robinharvey001.workers.dev/fantrax/sync

## Optional: wire the override into the app
Add this line before the closing `</body>` in public-release/index.html:
```html
<script src="./pride-override.js"></script>
```

Or hard-edit the two constants (DEFAULT_CONFIG + APP_VERSION) in that file.

## League IDs
- Fantrax League: astbqxhwmk4b6bg9
- Capitol Carnage team: nsf1b7esmk4b6bgd
