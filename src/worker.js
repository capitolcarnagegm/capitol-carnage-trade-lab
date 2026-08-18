import { GMSAnalysisEngine } from "./engine.js";

const OWNER_EMAIL = "gmslocker@gmail.com";
const FANTRAX_GENERAL = "https://www.fantrax.com/fxea/general/";
const FANTRAX_PA = "https://www.fantrax.com/fxpa/req";
const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";
const LAST_SEASON = "SEASON_23j_YEAR_TO_DATE";

function cors() {
  return {
    "Access-Control-Allow-Origin": "https://gmslocker.com",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
    Vary: "Origin"
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors() }
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

async function health(env) {
  const checks = { worker: true, db: Boolean(env.DB), ai: Boolean(env.AI), fantrax: false, espn: false };
  const errors = [];
  try {
    const response = await fetch(FANTRAX_GENERAL + "getPlayerIds?sport=NFL", { headers: requestHeaders() });
    checks.fantrax = response.ok;
    if (!response.ok) errors.push("Fantrax HTTP " + response.status);
  } catch (error) { errors.push("Fantrax: " + String(error?.message || error)); }
  try {
    const response = await fetch("https://cdn.espn.com/core/nfl/scoreboard?xhr=1", { headers: requestHeaders() });
    checks.espn = response.ok;
    if (!response.ok) errors.push("ESPN HTTP " + response.status);
  } catch (error) { errors.push("ESPN: " + String(error?.message || error)); }
  return json({ ok: checks.worker && checks.db && checks.fantrax && checks.espn, service: "gmslocker-api", version: "2.5.0-recovery", checks, errors, checkedAt: new Date().toISOString() });
}

async function currentGames(url) {
  const requested = String(url.searchParams.get("season") || new Date().getUTCFullYear()).replace(/\D/g, "");
  const seasons = [requested, String(Number(requested) + 1), String(Number(requested) - 1)];
  const endpoints = [];
  for (const season of seasons) {
    for (const type of ["2", "1"]) {
      endpoints.push(`https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=${season}&seasontype=${type}`);
      endpoints.push(`https://cdn.espn.com/core/nfl/scoreboard?xhr=1&dates=${season}&seasontype=${type}`);
    }
  }
  endpoints.push("https://cdn.espn.com/core/nfl/scoreboard?xhr=1");
  endpoints.push("https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100");
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { headers: requestHeaders() });
      if (!response.ok) continue;
      const board = await response.json();
      const events = board.events || board.content?.sbData?.events || board.scoreboard?.events || [];
      const schedule = events.map((event) => {
        const competition = event.competitions?.[0] || event.competition || null;
        if (!competition && !event.date) return null;
        const competitors = competition?.competitors || event.competitors || [];
        const home = competitors.find((t) => t.homeAway === "home") || competitors[0];
        const away = competitors.find((t) => t.homeAway === "away") || competitors[1];
        const statusObj = event.status?.type || event.status || {};
        return {
          id: String(event.id || event.uid || Math.random()),
          date: event.date || event.startDate || null,
          name: event.name || event.shortName || event.headline || "",
          state: statusObj.state || (statusObj.completed ? "post" : "pre"),
          status: statusObj.shortDetail || statusObj.detail || statusObj.description || "Scheduled",
          home: { abbreviation: home?.team?.abbreviation || home?.abbreviation || null, name: home?.team?.displayName || home?.displayName || home?.name || null, score: home?.score ?? null },
          away: { abbreviation: away?.team?.abbreviation || away?.abbreviation || null, name: away?.team?.displayName || away?.displayName || away?.name || null, score: away?.score ?? null },
          venue: competition?.venue?.fullName || event.venue?.fullName || null
        };
      }).filter(Boolean).sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
      if (schedule.length) {
        return json({ schedule, games: schedule.filter((g) => g.state === "in" || g.state === "post"), scheduleSource: endpoint.includes("cdn.espn") ? "ESPN-CDN" : "ESPN", season: Number(requested), syncedAt: new Date().toISOString() });
      }
    } catch (_) {}
  }
  return json({ schedule: [], games: [], error: "No NFL schedule found from available sources" }, 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      if (url.pathname === "/health") return health(env);
      if (url.pathname === "/current-games") return currentGames(url);
      return json({ error: "Sign in required or route not available in recovery build. Full worker restore in progress.", version: "2.5.0-recovery" }, 401);
    } catch (error) {
      console.error("GMS Locker request error", error);
      return json({ error: String(error?.message || error) }, 500);
    }
  }
};
