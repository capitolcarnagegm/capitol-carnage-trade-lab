import baseWorker from "./worker-live-depth.js";

const ESPN_SCOREBOARD = "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100";
const ESPN_HEALTH = "https://cdn.espn.com/core/nfl/scoreboard?xhr=1";
const FANTRAX_HEALTH = "https://www.fantrax.com/fxea/general/getPlayerIds?sport=NFL";

function cors() {
  return {
    "Access-Control-Allow-Origin": "https://gmslocker.com",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
    "Cache-Control": "no-store",
    Vary: "Origin"
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() }
  });
}

function requestHeaders(extra = {}) {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Referer: "https://www.espn.com/",
    ...extra
  };
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: requestHeaders(), cf: { cacheTtl: 30, cacheEverything: true } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function normalizeGame(event) {
  const competition = event?.competitions?.[0] || {};
  const competitors = competition?.competitors || [];
  const home = competitors.find(x => x.homeAway === "home") || {};
  const away = competitors.find(x => x.homeAway === "away") || {};
  const team = row => ({
    id: row?.team?.id || null,
    name: row?.team?.displayName || row?.team?.name || null,
    abbreviation: row?.team?.abbreviation || null,
    score: row?.score ?? null
  });
  return {
    id: event?.id || null,
    date: event?.date || competition?.date || null,
    status: event?.status?.type?.shortDetail || event?.status?.type?.description || "Scheduled",
    venue: competition?.venue?.fullName || null,
    home: team(home),
    away: team(away)
  };
}

async function currentGames() {
  try {
    const data = await fetchJson(ESPN_SCOREBOARD);
    const events = data?.events || data?.content?.sbData?.events || [];
    return json({ schedule: events.map(normalizeGame), source: "ESPN NFL scoreboard", syncedAt: new Date().toISOString() });
  } catch (error) {
    return json({ schedule: [], error: String(error?.message || error), source: "ESPN NFL scoreboard", syncedAt: new Date().toISOString() }, 502);
  }
}

async function health(env) {
  const checks = { worker: true, db: Boolean(env.DB), ai: Boolean(env.AI), fantrax: false, espn: false };
  const errors = [];
  try {
    const r = await fetch(FANTRAX_HEALTH, { headers: requestHeaders() });
    checks.fantrax = r.ok;
    if (!r.ok) errors.push(`Fantrax HTTP ${r.status}`);
  } catch (error) { errors.push(`Fantrax: ${String(error?.message || error)}`); }
  try {
    const r = await fetch(ESPN_HEALTH, { headers: requestHeaders() });
    checks.espn = r.ok;
    if (!r.ok) errors.push(`ESPN HTTP ${r.status}`);
  } catch (error) { errors.push(`ESPN: ${String(error?.message || error)}`); }
  return json({
    ok: checks.worker && checks.db && checks.fantrax && checks.espn,
    service: "gmslocker-api",
    version: "2.5.1",
    checks,
    errors,
    checkedAt: new Date().toISOString()
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (request.method === "GET" && url.pathname === "/health") return health(env);
    if (request.method === "GET" && url.pathname === "/current-games") return currentGames();
    return baseWorker.fetch(request, env, ctx);
  }
};
