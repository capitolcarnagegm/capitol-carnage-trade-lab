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
    headers: { Accept: "application/json", "User-Agent": "GMsLocker/7.3" }
  });
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
  return res.json();
}

function normName(n) {
  let s = String(n || "").toLowerCase().replace(/[^a-z\s,]/g, " ").replace(/\s+/g, " ").trim();
  if (s.includes(",")) {
    const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2) s = parts[1] + " " + parts[0];
  }
  return s.replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
}

async function fetchEspnProjections() {
  const filter = {
    players: {
      filterStatus: { value: ["FREEAGENT", "WAIVERS", "ONTEAM"] },
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      limit: 1500
    }
  };
  const url =
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info";
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "GMsLocker/7.3",
      "x-fantasy-filter": JSON.stringify(filter)
    }
  });
  if (!res.ok) throw new Error("ESPN projections HTTP " + res.status);
  const data = await res.json();
  const byName = {};
  for (const row of data.players || []) {
    const pl = row.player || {};
    const name = pl.fullName || "";
    if (!name) continue;
    let best = null;
    for (const s of pl.stats || []) {
      if (s.seasonId === 2026 && s.scoringPeriodId === 0 && s.statSourceId === 1) {
        best = Number(s.appliedTotal || 0);
        break;
      }
    }
    if (best == null) {
      let sum = 0;
      let weeks = 0;
      for (const s of pl.stats || []) {
        if (s.seasonId === 2026 && s.statSourceId === 1 && (s.scoringPeriodId || 0) > 0) {
          sum += Number(s.appliedTotal || 0);
          weeks++;
        }
      }
      if (weeks) best = sum;
    }
    if (best != null && best > 0) {
      byName[normName(name)] = Math.round(best * 10) / 10;
    }
  }
  return byName;
}

async function syncAll(leagueId) {
  const startedAt = new Date().toISOString();
  const kinds = Object.keys(ENDPOINTS);
  const results = await Promise.allSettled([
    ...kinds.map((k) => fantrax(ENDPOINTS[k], leagueId)),
    fetchEspnProjections()
  ]);
  const snapshots = {};
  const errors = [];
  kinds.forEach((kind, i) => {
    const r = results[i];
    if (r.status === "fulfilled") snapshots[kind] = r.value;
    else errors.push({ kind, error: String(r.reason?.message || r.reason) });
  });
  const projResult = results[results.length - 1];
  let projections = {};
  if (projResult.status === "fulfilled") projections = projResult.value;
  else errors.push({ kind: "projections", error: String(projResult.reason?.message || projResult.reason) });

  // Attach proj onto roster items when name matches
  const players = snapshots.players || {};
  const rosters = snapshots.rosters?.rosters || {};
  let matched = 0;
  for (const team of Object.values(rosters)) {
    for (const item of team.rosterItems || []) {
      const p = players[item.id] || {};
      const key = normName(p.name || "");
      if (key && projections[key] != null) {
        item.proj = projections[key];
        matched++;
      }
    }
  }

  return {
    ok: true,
    configured: true,
    syncedAt: startedAt,
    snapshots,
    projections,
    projectionMeta: { source: "ESPN 2026 season", matched, total: Object.keys(projections).length },
    errors,
    leagueId
  };
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
        projections: true,
        providers: { gemini: Boolean(env.GEMINI_API_KEY) }
      }, 200, origin);
    }

    try {
      if ((url.pathname === "/fantrax/live" && request.method === "GET") ||
          (url.pathname === "/fantrax/sync" && request.method === "POST")) {
        const data = await syncAll(leagueId);
        return json(data, 200, origin);
      }
      if (url.pathname === "/league-data" && request.method === "GET") {
        const data = await syncAll(leagueId);
        const players = data.snapshots.players || {};
        const rosters = data.snapshots.rosters?.rosters || {};
        const assets = [];
        for (const team of Object.values(rosters)) {
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
              status: item.status || "ROSTERED",
              proj: item.proj || 0
            });
          }
        }
        const teams = Object.entries(rosters).map(([id, t]) => ({ id, name: t.teamName }));
        return json({
          ok: true,
          dataset: {
            schemaVersion: 1,
            datasetVersion: data.syncedAt,
            source: "Fantrax Live + ESPN Projections",
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
              freeAgents: 0,
              withProj: assets.filter((a) => a.proj > 0).length
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
