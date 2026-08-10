// GMS Locker Fantrax proxy — deploy as a Cloudflare Worker.
// Route recommendation: https://gmslocker.com/api/fantrax*
const ALLOWED_ENDPOINTS = new Set([
  "getTeamRosters",
  "getPlayerIds",
  "getStandings",
  "getDraftPicks",
  "getMatchupScores",
  "getLeagueInfo"
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const endpoint = url.searchParams.get("endpoint") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }
    if (!ALLOWED_ENDPOINTS.has(endpoint)) {
      return json({ error: "Unsupported Fantrax endpoint" }, 400);
    }

    const upstream = new URL("https://www.fantrax.com/fxea/general/" + endpoint);
    url.searchParams.forEach((value, key) => {
      if (key !== "endpoint") upstream.searchParams.append(key, value);
    });

    try {
      const response = await fetch(upstream.toString(), {
        headers: {
          "Accept": "application/json",
          "User-Agent": "GMSLocker/1.0"
        },
        cf: { cacheTtl: 15, cacheEverything: false }
      });
      const body = await response.arrayBuffer();
      const headers = corsHeaders();
      headers.set("Content-Type", response.headers.get("Content-Type") || "application/json; charset=utf-8");
      headers.set("Cache-Control", "public, max-age=15");
      return new Response(body, { status: response.status, headers });
    } catch (error) {
      return json({ error: "Fantrax upstream failed", detail: String(error && error.message || error) }, 502);
    }
  }
};

function corsHeaders() {
  return new Headers({
    "Access-Control-Allow-Origin": "https://gmslocker.com",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff"
  });
}

function json(value, status = 200) {
  const headers = corsHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { status, headers });
}
