# GMSLOCKER v6.7 — Manual Mac Deployment

This package deploys the private Cloudflare Worker and D1 data first, verifies them, then publishes the sanitized frontend and replaces the old GitHub history.

## Before starting

1. Revoke the Cloudflare token that was posted in chat.
2. Create a new Cloudflare token with Workers Scripts Edit, D1 Edit, Account Settings Read, Memberships Read, and User Details Read.
3. Install current Node.js LTS from <https://nodejs.org>.
4. Install GitHub CLI from <https://cli.github.com>.
5. Extract this ZIP on your Mac.

## Run it

Open Terminal, type `cd ` (including the trailing space), drag the extracted `GMSLOCKER-v6.7-manual-deployment` folder into Terminal, and press Return. Then run:

```bash
bash scripts/manual-deploy-mac.sh
```

The script asks privately for:

- the new Cloudflare token;
- a new GMSLOCKER login password of at least 12 characters;
- an optional Gemini API key.

Typed secrets are hidden, are not written into the package, and are removed from the script environment when it exits.

The final GitHub step deliberately force-replaces `main` with a sanitized one-commit history. The script pauses and requires typing `PUBLISH` immediately before that operation.

After success, revoke the temporary Cloudflare deployment token.

