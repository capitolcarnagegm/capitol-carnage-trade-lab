# Status C — Login works, features empty

## Confirmed
- Auth works
- Trade dropdowns, FAs, rankings, Game Day empty because **sync / live data path is broken or not deployed**

## What was just pushed
- `cloudflare-router.js`: Game Day always gets ESPN schedule (regular + preseason fallback). FA multi-page still runs when `/league-data` succeeds.

## You must deploy
```bash
cd capitol-carnage-trade-lab
npx wrangler deploy
```

## Then on the site
1. Confirm a league is linked (Settings / Leagues → Capitol Carnage)
2. Click **Refresh**
3. Open Trade — partner dropdown should list teams
4. Open Game Day — schedule should list games
5. Open Waivers — free agents should populate

## If still empty after deploy
Open browser DevTools → Network → click Refresh → find `/league-data`:
- **401** = session dead → sign out / sign in
- **404 League not found** = no workspace linked → Add New League again
- **502 Fantrax** = upstream Fantrax/API issue
- **200 but teams: 0** = Fantrax returned empty rosters for that league ID

Paste the status code + error JSON and we fix the next layer.
