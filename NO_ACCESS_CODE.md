# No Access Code Mode

## Frontend
- `public-release/pride-override.js` kills the access-code lock and forces Pride Dynasty defaults.
- Add this line before `</body>` in `public-release/index.html` if not already present:
  ```html
  <script src="./pride-override.js"></script>
  ```

## Worker (required for open access)
1. Deploy the updated worker from `multi-ai-worker` or `worker`.
2. **Delete** the Cloudflare secret `GMSLOCKER_ACCESS_TOKEN` (or leave it unset).
   - When that secret is absent, the worker treats the vault as open — no login required.
3. Keep `GEMINI_API_KEY` and `FANTRAX_LEAGUE_ID=astbqxhwmk4b6bg9`.

```bash
npx wrangler secret delete GMSLOCKER_ACCESS_TOKEN
npx wrangler deploy
```

After deploy, open https://gmslocker.com/public-release/ — no code prompt.
