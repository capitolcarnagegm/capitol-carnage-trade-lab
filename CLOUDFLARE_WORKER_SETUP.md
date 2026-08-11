# GMS Locker Fantrax Worker

The browser cannot call Fantrax `fxea` endpoints directly because Fantrax does not return browser CORS headers. `cloudflare-worker.js` is the server-side proxy.

## Live production transport

The frontend currently calls the deployed standalone Worker:

`https://gmslocker-fantrax-proxy.robinharvey001.workers.dev/`

This keeps Fantrax sync working with the existing account-scoped deployment token. The Worker only accepts the Pride Dynasty league ID and the six endpoints used by the app.

## Optional same-origin route

To expose the same Worker at `gmslocker.com/api/fantrax*`, the Cloudflare API token used by GitHub Actions must also have **Zone → Workers Routes → Edit** access for the `gmslocker.com` zone. After that route is attached, you can override the transport before `fantrax-proxy.js` / `app.js` load:

```html
<script>window.GMS_FANTRAX_PROXY = "/api/fantrax";</script>
```

## Smoke test

Open the standalone Worker smoke test:

`https://gmslocker-fantrax-proxy.robinharvey001.workers.dev/?endpoint=getLeagueInfo&leagueId=astbqxhwmk4b6bg9`

A successful deployment returns Fantrax JSON. Then hard-refresh GMS Locker and use **Refresh**. War Room, My Team, Teams, Cap / Dead, Waivers, Analysts and Picks will populate from the existing app logic.

The Worker intentionally allow-lists only the Fantrax endpoints currently used by GMS Locker.
