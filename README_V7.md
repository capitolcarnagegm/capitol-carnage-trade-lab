# GM's Locker v7

GM's Locker v7 is a clean data-layer rebuild of the Pride Dynasty franchise operating system.

## Data authority
1. Manual confirmed corrections
2. Fantrax team roster exports for ownership, salary, contract, status and Fantrax projections
3. Transaction/screenshot evidence
4. MFL live feeds for transactions, standings, draft results, future picks and schedule
5. Model inference only when explicitly labeled

No model-generated field may silently replace a Fantrax salary, contract, ownership or projection value.

## Verified v7 inputs
- Capitol Carnage roster: Google Sheet `1BsSsagBUYsYmlhAZRFVQecupj3F4sC_h7GekyXsxY4I`, converted from `Fantrax-Team-Roster-Pride Dynasty-18`.
- Fantrax player/free-agent pool: Google Sheet `1Ay3zX-XSYrWhB7DV-ZLgmZUL8BccmRFDrlIUT1RIaWg`, 8,078 rows x 16 columns.
- ADP reference: Google Sheet `13VgYycSVgH0DBFYSv_YFNuMft4BPNPZcSam4vXyrd0M`.
- Existing Cloudflare/MFL integration remains the live source for league activity.

## Moneyball decision standard
Every recommended move must clear all four questions:
1. Are we receiving defensible adjusted value rather than paying a name premium?
2. Does the move improve scarce-starting-lineup construction in SF/TEP/sack-premium IDP?
3. Does salary/contract efficiency remain defensible against replacement cost and opportunity cost?
4. Can the acquired asset be resold without an unacceptable liquidity haircut?

A recommended move must grade B+ or better. Anything below that is a hold/reject unless an explicit championship-probability exception is documented.

## v7 application modules
- War Room
- My Roster
- League Analyzer / power rankings
- Team Analyzer
- Edge Finder
- Trade Lab
- Free Agency / blind-bid lab
- Draft & Picks / live pick forecast
- Transactions and auction history
- Integrity layer / duplicate reconciliation
- Watchlist and alerts
- Backup / restore / audit trail
- AI GM

## AI GM architecture
The browser must never contain an OpenAI API key. The UI sends the current structured franchise context to a server-side endpoint. The server injects league rules, current roster/cap/picks, opponent rosters, free agents, projections, transaction history, persistent GM notes and the four-question value test before calling OpenAI. Persistent memory belongs in server-side storage, not only localStorage.

The live AI GM tab connects to the `gms-locker-ai` Cloudflare Worker. OpenAI and Grok can be used separately or together in council mode. Provider keys remain encrypted Worker secrets and are never shipped to the browser. The browser sends a curated league snapshot that deliberately excludes MFL credentials and raw provider keys.

## Rebuild rule
v7 is being built on branch `gm-locker-v7`. Do not overwrite `main` until the authoritative team roster set, free-agent pool, duplicate reconciliation and integrity checks pass.
