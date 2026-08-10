# GMS Locker Fantrax Worker

The browser cannot call Fantrax `fxea` endpoints directly because Fantrax does not return browser CORS headers. `cloudflare-worker.js` is the server-side proxy.

## Recommended production route

Deploy `cloudflare-worker.js` as a Cloudflare Worker and attach this route:

`gmslocker.com/api/fantrax*`

The frontend already defaults to that same-origin endpoint through `fantrax-proxy.js`. No frontend edit is required after the route is active.

## Alternative standalone Worker URL

If the Worker is deployed at a `workers.dev` hostname instead, set this before `fantrax-proxy.js` / `app.js` load:

```html
<script>window.GMS_FANTRAX_PROXY = "https://YOUR-WORKER.workers.dev/";</script>
```

## Smoke test

Open:

`https://gmslocker.com/api/fantrax?endpoint=getLeagueInfo&leagueId=astbqxhwmk4b6bg9`

A successful deployment returns Fantrax JSON rather than the GitHub Pages 404 page. Then hard-refresh GMS Locker and use **Refresh**. War Room, My Team, Teams, Cap / Dead, Waivers, Analysts and Picks will populate from the existing app logic.

The Worker intentionally allow-lists only the Fantrax endpoints currently used by GMS Locker.
