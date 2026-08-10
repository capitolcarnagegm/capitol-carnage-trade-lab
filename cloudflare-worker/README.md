# Capitol Carnage MFL Sync Worker

This is the server-side read-only sync bridge for Pride LG 2026, league 29218.

It is locked to:
- GitHub Pages origin: https://capitolcarnagegm.github.io
- MFL host: www45.myfantasyleague.com
- Season: 2026
- League ID: 29218

Routes:
- GET /health — deployment test
- GET /sync — returns league, players, rosters and optional standings/transactions/draft results

No MFL password is stored. The Worker does not submit bids, lineups, drops, adds, or trades.
