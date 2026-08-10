# GM's Locker v7 architecture

GM's Locker is a private data-layer rebuild of a dynasty franchise operating system.

## Data authority

1. Explicit manual corrections
2. Reviewed transaction or screenshot evidence
3. Current Fantrax API roster, player-pool, rules, status, standings, matchup, and draft snapshots
4. Model inference only when explicitly labeled

No model-generated field may silently replace a verified Fantrax fact.

## Decision standard

Every recommended move must clear all four questions:

1. Does it improve championship probability now or create a superior long-term path?
2. Are we buying below intrinsic value or selling above it?
3. What is the full opportunity cost across cap, contract, roster spot, replacement value, picks, and flexibility?
4. Is a materially better alternative available or likely to become available?

A recommended move must grade B+ or better unless a documented championship-equity exception applies.

## Private architecture

The public site contains only the application shell. A bearer-protected Cloudflare Worker serves the private D1 dataset and opaque live snapshots. Cloudflare Llama receives curated private decision context. Gemini receives only the user's explicit-consent text plus public NFL score/news context. Credentials, the Fantrax league ID, raw exports, and generated database imports must never be committed or stored in the public shell.

The documented Fantrax API supplies current rosters and league state but not a complete past trade ledger. The first live roster snapshot is therefore the transaction baseline; later adds, drops, moves, and status changes are recorded automatically. Reviewed historical imports remain available for older activity.
