const ALLOWED = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);

function cors(origin) {
  const o = ALLOWED.has(origin) ? origin : "https://gmslocker.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

const ENDPOINTS = {
  league: "getLeagueInfo",
  rosters: "getTeamRosters",
  standings: "getStandings",
  matchups: "getMatchupScores",
  draftPicks: "getDraftPicks",
  draftResults: "getDraftResults",
  players: "getPlayerIds"
};

async function fantrax(endpoint, leagueId, extra = {}) {
  const url = new URL(`https://www.fantrax.com/fxea/general/${endpoint}`);
  if (endpoint !== "getPlayerIds") url.searchParams.set("leagueId", leagueId);
  else url.searchParams.set("sport", "NFL");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "GMsLocker/6.8" }
  });
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
  return res.json();
}

async function syncAll(leagueId) {
  const startedAt = new Date().toISOString();
  const kinds = Object.keys(ENDPOINTS);
  const results = await Promise.allSettled(
    kinds.map((k) => fantrax(ENDPOINTS[k], leagueId))
  );
  const snapshots = {};
  const errors = [];
  results.forEach((r, i) => {
    const kind = kinds[i];
    if (r.status === "fulfilled") snapshots[kind] = r.value;
    else errors.push({ kind, error: String(r.reason?.message || r.reason) });
  });
  return { ok: true, configured: true, syncedAt: startedAt, snapshots, errors, leagueId };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    const url = new URL(request.url);
    const leagueId = env.FANTRAX_LEAGUE_ID || "astbqxhwmk4b6bg9";

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "GM's Locker Fantrax Proxy",
        fantraxConfigured: true,
        leagueId,
        providers: { gemini: Boolean(env.GEMINI_API_KEY) }
      }, 200, origin);
    }

    try {
      if (url.pathname === "/fantrax/live" && request.method === "GET") {
        const data = await syncAll(leagueId);
        return json(data, 200, origin);
      }
      if (url.pathname === "/fantrax/sync" && request.method === "POST") {
        const data = await syncAll(leagueId);
        return json(data, 200, origin);
      }
      if (url.pathname === "/league-data" && request.method === "GET") {
        const data = await syncAll(leagueId);
        const players = data.snapshots.players || {};
        const rosters = data.snapshots.rosters?.rosters || {};
        const assets = [];
        for (const [teamId, team] of Object.entries(rosters)) {
          for (const item of team.rosterItems || []) {
            const p = players[item.id] || {};
            assets.push({
              fantraxId: item.id,
              name: p.name || item.id,
              pos: item.position || p.position || "",
              nfl: p.team || "",
              salary: item.salary ?? 0,
              years: Number(item.contract?.smallId || item.contract?.name || 0) || 0,
              roster: team.teamName,
              status: item.status || "ROSTERED"
            });
          }
        }
        const teams = Object.entries(rosters).map(([id, t]) => ({ id, name: t.teamName }));
        return json({
          ok: true,
          dataset: {
            schemaVersion: 1,
            datasetVersion: data.syncedAt,
            source: "Fantrax Live",
            importedAt: data.syncedAt,
            league: {
              name: "Pride Dynasty",
              teamName: "Capitol Carnage",
              teamCount: teams.length,
              teams,
              salaryCap: 1404
            },
            assets,
            counts: {
              totalPlayers: assets.length,
              rostered: assets.length,
              freeAgents: 0
            }
          }
        }, 200, origin);
      }
      return json({ ok: false, error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500, origin);
    }
  }
};
