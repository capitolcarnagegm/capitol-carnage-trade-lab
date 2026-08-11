// GMS Locker Fantrax proxy — deployed at the account workers.dev hostname.
const ALLOWED_ENDPOINTS = new Set([
  "getTeamRosters",
  "getPlayerIds",
  "getStandings",
  "getDraftPicks",
  "getMatchupScores",
  "getLeagueInfo"
]);
const ALLOWED_ORIGINS = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com"
]);
const LEAGUE_ID = "astbqxhwmk4b6bg9";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const endpoint = url.searchParams.get("endpoint") || "";
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin not allowed" }, 403, origin);
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, origin);
    }
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return json({ error: "Unsupported Fantrax endpoint" }, 400, origin);
    }
    if (endpoint !== "getPlayerIds" && url.searchParams.get("leagueId") !== LEAGUE_ID) {
      return json({ error: "Unsupported Fantrax league" }, 400, origin);
    }

    const upstream = new URL("https://www.fantrax.com/fxea/general/" + endpoint);
    url.searchParams.forEach((value, key) => {
      if (key !== "endpoint") upstream.searchParams.append(key, value);
    });
    if (endpoint === "getPlayerIds") upstream.searchParams.set("sport", "NFL");

    try {
      const response = await fetch(upstream.toString(), {
        headers: {
          "Accept": "application/json",
          "User-Agent": "GMSLocker/1.0"
        },
        cf: { cacheTtl: 15, cacheEverything: true },
        signal: AbortSignal.timeout(15000)
      });
      const headers = corsHeaders(origin);
      headers.set("Content-Type", response.headers.get("Content-Type") || "application/json; charset=utf-8");
      headers.set("Cache-Control", "public, max-age=15");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return json({ error: "Fantrax upstream failed" }, 502, origin);
    }
  }
};

function corsHeaders(origin) {
  return new Headers({
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://gmslocker.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  });
}

function json(value, status = 200, origin = "") {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}
