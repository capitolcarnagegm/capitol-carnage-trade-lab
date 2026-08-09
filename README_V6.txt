GM'S LOCKER v6.0 — FRANCHISE OPERATING SYSTEM PROTOTYPE

CORE
- Black/gold/white GM's Locker UI
- Pride LG / MFL sync through Cloudflare Worker
- My Roster
- War Room action board
- Team Analyzer
- League Analyzer
- Edge Finder
- Trade Lab
- Free Agency / Blind Bid Lab
- Draft & Picks / live pick forecast
- Transactions
- Integrity Layer

DATA / INTEGRITY
- Source authority: Manual > Screenshot/Transaction > MFL > Model
- Integrity score 0–100
- Missing projection / cap / ownership / pick-origin detection
- Data Feed Manager
- Projection/data import from CSV or JSON
- Audit trail
- 5-level undo stack
- Full JSON backup export / restore

SEASON INTELLIGENCE
- Weekly lineup optimizer
- Championship probability board
- Playoff odds
- Schedule view
- Bye matrix
- Live pick slot forecasting that shifts from projections toward results after games

MARKET INTELLIGENCE
- Owner tendencies from transaction / bid history
- MFL blind-bid / waiver auction history when transaction amounts are exposed
- Position-level auction averages / 75th percentile / maximum
- FA recommended target / floor / max with:
  projections, role, sentiment, breakout, security, roster need,
  league bidding pressure, exact available cap, historical auction data,
  likely bidders, and opportunity cost
- Missing projection hard-blocks a confident FA bid recommendation

CORRECTIONS / TRANSACTIONS
- Roster screenshot correction
- FA screenshot correction
- Trade screenshot import
- Transaction screenshot import
- Historical / previous transaction screenshot import
- Historical transaction: history-only OR history + current ownership reconciliation
- Manual Transaction Manager
- Manual Trade
- Manual Override
- Current-owner vs original-team draft pick tracking

WATCHLIST
- Value / projection / role / pick-slot triggers
- In-app triggered alerts

PRIVACY
- robots noindex/nofollow/noarchive
- local browser passcode lock for prototype use
IMPORTANT: local lock is NOT production authentication. Real server-side access control remains a deployment-layer task.

MFL WORKER
- League / rosters / players
- standings
- up to 1000 transactions for market/auction behavior history
- draft results
- future draft picks
- optional schedule
- trade / roster / FA / transaction / historical-transaction screenshot AI routes

NOT INCLUDED
- Fantrax or other platform adapters, intentionally deferred until Pride LG data integrity is trusted.

DEPLOYMENT
1. Extract ZIP.
2. Upload/overwrite contents into existing GitHub repository root.
3. Do NOT upload the ZIP itself.
4. Let GitHub Pages and connected Cloudflare Worker deploy.
5. Test Worker health, MFL Sync, Integrity, then War Room.
