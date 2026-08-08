const ALLOWED_ORIGIN = "https://capitolcarnagegm.github.io";
const MFL_HOST = "www45.myfantasyleague.com";
const SEASON = "2026";
const LEAGUE_ID = "29218";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) }
  });
}

async function getMFL(type, extraParams = {}) {
  const url = new URL(`https://${MFL_HOST}/${SEASON}/export`);
  url.searchParams.set("TYPE", type);
  url.searchParams.set("L", LEAGUE_ID);
  url.searchParams.set("JSON", "1");
  for (const [k, v] of Object.entries(extraParams)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }

  const r = await fetch(url.toString(), {
    headers: {
      "Accept": "application/json,text/plain,*/*",
      "User-Agent": "Capitol-Carnage-GM-Lab/2.2"
    },
    cf: { cacheTtl: 0, cacheEverything: false }
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`${type}: MFL HTTP ${r.status}`);

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${type}: MFL response was not JSON (${text.slice(0, 100).replace(/\s+/g, " ")})`);
  }
  return parsed;
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== "GET") {
      return json({ ok: false, error: "Method not allowed" }, 405, origin);
    }

    // Browser calls are locked to the deployed GM Lab origin.
    // Direct navigation without an Origin header is allowed only for /health.
    const u = new URL(request.url);
    if (u.pathname !== "/health" && origin !== ALLOWED_ORIGIN) {
      return json({ ok: false, error: "Origin not allowed" }, 403, origin);
    }

    if (u.pathname === "/health") {
      return json({
        ok: true,
        service: "Capitol Carnage GM Lab MFL Sync",
        season: SEASON,
        leagueId: LEAGUE_ID,
        upstream: MFL_HOST
      }, 200, origin || ALLOWED_ORIGIN);
    }

    if (u.pathname === "/sync") {
      try {
        const results = await Promise.allSettled([
          getMFL("league"),
          getMFL("players"),
          getMFL("rosters"),
          getMFL("standings"),
          getMFL("transactions"),
          getMFL("draftResults"),
          getMFL("futureDraftPicks")
        ]);

        const names = ["league","players","rosters","standings","transactions","draftResults","futureDraftPicks"];
        const data = {};
        const errors = {};

        results.forEach((r, i) => {
          if (r.status === "fulfilled") data[names[i]] = r.value;
          else errors[names[i]] = String(r.reason?.message || r.reason);
        });

        // Core endpoints must exist. Optional endpoints can fail without killing the sync.
        if (!data.league || !data.players || !data.rosters) {
          return json({
            ok: false,
            error: "One or more core MFL endpoints failed",
            errors
          }, 502, origin);
        }

        return json({
          ok: true,
          syncedAt: new Date().toISOString(),
          season: SEASON,
          leagueId: LEAGUE_ID,
          data,
          errors
        }, 200, origin);
      } catch (e) {
        return json({ ok: false, error: String(e?.message || e) }, 500, origin);
      }
    }

    return json({ ok: false, error: "Not found" }, 404, origin);
  }
};