import { GMSAnalysisEngine } from "./engine.js";

const OWNER_EMAIL = "gmslocker@gmail.com";
const FANTRAX_GENERAL = "https://www.fantrax.com/fxea/general/";
const FANTRAX_PA = "https://www.fantrax.com/fxpa/req";
const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";
const LAST_SEASON = "SEASON_23j_YEAR_TO_DATE";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    try {
      if (url.pathname === "/health") return health(env);
      if (url.pathname === "/auth/register") return register(request, env);
      if (url.pathname === "/auth/login") return login(request, env);
      // Public routes — no auth required (Game Day, news wrappers, depth charts)
      if (url.pathname === "/current-games") return currentGames(url);

      const auth = await getAuth(request, env);
      if (url.pathname === "/auth/me") return auth ? json({ user: auth.user }) : json({ error: "Sign in required" }, 401);
      if (url.pathname === "/auth/logout") return logout(env, auth);
      if (!auth) return json({ error: "Sign in required" }, 401);

      if (url.pathname === "/account/leagues") return listLeagues(env, auth);
      if (url.pathname === "/account/league") return saveLeague(request, env, auth);
      if (url.pathname === "/account/league/inspect") return inspectLeague(request);
      if (url.pathname === "/league-data") return leagueData(url, env, auth);
      if (url.pathname === "/trade-analysis") return tradeAnalysis(request, env, auth);
      if (url.pathname === "/trade-suggestion") return tradeSuggestion(request, env, auth);
      if (url.pathname === "/chat") return chatRoute(request, env, auth);
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("GMS Locker request error", error);
      return json({ error: String(error?.message || error) }, 500);
    }
  }
};

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
  return json({ ok: checks.worker && checks.db && checks.fantrax && checks.espn, service: "gmslocker-api", version: "2.5.0", checks, errors, checkedAt: new Date().toISOString() });
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
