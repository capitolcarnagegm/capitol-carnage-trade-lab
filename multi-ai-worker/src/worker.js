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

const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";
const MY_TEAM_ID = "nsf1b7esmk4b6bgd";

async function fantrax(endpoint, leagueId, extra = {}) {
  const url = new URL(`https://www.fantrax.com/fxea/general/${endpoint}`);
  if (endpoint !== "getPlayerIds") url.searchParams.set("leagueId", leagueId);
  else url.searchParams.set("sport", "NFL");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "GMsLocker/7.4" }
  });
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
  return res.json();
}

async function fantraxPa(leagueId, msgs) {
  const res = await fetch(`https://www.fantrax.com/fxpa/req?leagueId=${leagueId}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "GMsLocker/7.4"
    },
    body: JSON.stringify({ msgs })
  });
  if (!res.ok) throw new Error(`fxpa HTTP ${res.status}`);
  return res.json();
}

function cellNum(cells, idx) {
  const raw = cells?.[idx]?.content;
  if (raw == null) return 0;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

async function fetchTeamProjections(leagueId, teamId, seasonOrProjection) {
  const resp = await fantraxPa(leagueId, [{
    method: "getTeamRosterInfo",
    data: {
      leagueId,
      teamId,
      view: "STATS",
      seasonOrProjection
    }
  }]);
  const data = resp?.responses?.[0]?.data || {};
  const rows = data?.tables?.[0]?.rows || [];
  const out = {};
  for (const row of rows) {
    const id = row?.scorer?.scorerId;
    if (!id) continue;
    // Fantrax roster table: [2]=salary [3]=years [4]=FPTS [5]=PPG
    const fpts = cellNum(row.cells, 4);
    const ppg = cellNum(row.cells, 5);
    out[id] = {
      id,
      name: row?.scorer?.name || id,
      pos: String(row?.scorer?.posShortNames || "").replace(/<[^>]+>/g, ""),
      statusId: row?.statusId,
      posId: row?.posId,
      eligiblePosIds: row?.eligiblePosIds || [],
      fpts,
      ppg,
      opponent: row?.cells?.[1]?.content || ""
    };
  }
  return out;
}

async function fetchAllProjections(leagueId, teamIds) {
  const season = {};
  const weekly = {};
  const settled = await Promise.allSettled(
    teamIds.flatMap((tid) => [
      fetchTeamProjections(leagueId, tid, SEASON_PROJ).then((m) => ({ kind: "season", tid, m })),
      fetchTeamProjections(leagueId, tid, WEEKLY_PROJ).then((m) => ({ kind: "weekly", tid, m }))
    ])
  );
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    const { kind, m } = r.value;
    const target = kind === "season" ? season : weekly;
    Object.assign(target, m);
  }
  return { season, weekly };
}

// Active lineup slots for Pride Dynasty (from Fantrax rosterInfo)
const LINEUP_SLOTS = [
  { slot: "QB", need: 1, accept: ["QB"] },
  { slot: "SFX", need: 1, accept: ["QB", "RB", "WR", "TE"] },
  { slot: "RB", need: 2, accept: ["RB"] },
  { slot: "WR", need: 3, accept: ["WR"] },
  { slot: "TE", need: 1, accept: ["TE"] },
  { slot: "RWT", need: 1, accept: ["RB", "WR", "TE"] },
  { slot: "DL", need: 3, accept: ["DL"] },
  { slot: "LB", need: 2, accept: ["LB"] },
  { slot: "DB", need: 3, accept: ["DB"] },
  { slot: "ID", need: 2, accept: ["DL", "LB", "DB"] }
];

function primaryPos(posStr) {
  const p = String(posStr || "").toUpperCase();
  if (p.includes("QB") || p.includes("SFX")) return "QB";
  if (p.includes("RB")) return "RB";
  if (p.includes("WR")) return "WR";
  if (p.includes("TE")) return "TE";
  if (p.includes("DL") || p.includes("DE") || p.includes("DT")) return "DL";
  if (p.includes("LB")) return "LB";
  if (p.includes("DB") || p.includes("CB") || p.includes("S")) return "DB";
  return p.split(/[^A-Z]/)[0] || "?";
}

function optimizeLineup(players) {
  // players: [{id,name,pos,weekly,season,status}]
  const pool = players
    .filter((p) => p && Number(p.weekly || p.season || 0) >= 0)
    .map((p) => ({
      ...p,
      primary: primaryPos(p.pos),
      score: Number(p.weekly || 0) || Number(p.season || 0) / 17
    }))
    .sort((a, b) => b.score - a.score);

  const used = new Set();
  const starters = [];
  for (const spec of LINEUP_SLOTS) {
    for (let n = 0; n < spec.need; n++) {
      const pick = pool.find((p) => !used.has(p.id) && spec.accept.includes(p.primary));
      if (!pick) {
        starters.push({ slot: spec.slot, empty: true });
        continue;
      }
      used.add(pick.id);
      starters.push({
        slot: spec.slot,
        id: pick.id,
        name: pick.name,
        pos: pick.pos,
        weekly: Math.round(pick.score * 10) / 10,
        season: pick.season || 0
      });
    }
  }
  const bench = pool
    .filter((p) => !used.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      pos: p.pos,
      weekly: Math.round(p.score * 10) / 10,
      season: p.season || 0
    }));
  const projectedTotal = starters.reduce((s, x) => s + (x.weekly || 0), 0);
  return {
    slots: LINEUP_SLOTS.map((s) => ({ slot: s.slot, need: s.need })),
    starters,
    bench,
    projectedTotal: Math.round(projectedTotal * 10) / 10
  };
}

async function syncAll(leagueId) {
  const startedAt = new Date().toISOString();
  const kinds = Object.keys(ENDPOINTS);
  const base = await Promise.allSettled(kinds.map((k) => fantrax(ENDPOINTS[k], leagueId)));
  const snapshots = {};
  const errors = [];
  base.forEach((r, i) => {
    const kind = kinds[i];
    if (r.status === "fulfilled") snapshots[kind] = r.value;
    else errors.push({ kind, error: String(r.reason?.message || r.reason) });
  });

  const rosterMap = snapshots.rosters?.rosters || {};
  const teamIds = Object.keys(rosterMap);
  let projections = { season: {}, weekly: {} };
  try {
    projections = await fetchAllProjections(leagueId, teamIds.length ? teamIds : [MY_TEAM_ID]);
  } catch (e) {
    errors.push({ kind: "projections", error: String(e?.message || e) });
  }

  // Attach onto roster items
  let matched = 0;
  for (const team of Object.values(rosterMap)) {
    for (const item of team.rosterItems || []) {
      const id = String(item.id || "");
      const s = projections.season[id];
      const w = projections.weekly[id];
      if (s) {
        item.proj = s.fpts;
        item.ppg = s.ppg;
        matched++;
      }
      if (w) {
        item.weeklyProj = w.fpts;
        item.opponent = w.opponent;
      }
    }
  }

  return {
    ok: true,
    configured: true,
    syncedAt: startedAt,
    snapshots,
    projections,
    projectionMeta: {
      source: "Fantrax roster projections",
      seasonCode: SEASON_PROJ,
      weeklyCode: WEEKLY_PROJ,
      matched,
      seasonCount: Object.keys(projections.season).length,
      weeklyCount: Object.keys(projections.weekly).length
    },
    lineupSlots: LINEUP_SLOTS,
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
    const teamId = env.FANTRAX_TEAM_ID || MY_TEAM_ID;

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "GM's Locker Fantrax Proxy",
        fantraxConfigured: true,
        leagueId,
        projections: "fantrax",
        providers: { gemini: Boolean(env.GEMINI_API_KEY) }
      }, 200, origin);
    }

    try {
      if ((url.pathname === "/fantrax/live" && request.method === "GET") ||
          (url.pathname === "/fantrax/sync" && request.method === "POST")) {
        return json(await syncAll(leagueId), 200, origin);
      }

      if (url.pathname === "/optimize" && (request.method === "GET" || request.method === "POST")) {
        const data = await syncAll(leagueId);
        const rosterMap = data.snapshots?.rosters?.rosters || {};
        const playersMap = data.snapshots?.players || {};
        const season = data.projections?.season || {};
        const weekly = data.projections?.weekly || {};
        const my = rosterMap[teamId];
        if (!my) return json({ ok: false, error: "Team not found" }, 404, origin);
        const players = (my.rosterItems || []).map((item) => {
          const p = playersMap[item.id] || {};
          const s = season[item.id] || {};
          const w = weekly[item.id] || {};
          return {
            id: item.id,
            name: p.name || s.name || item.id,
            pos: item.position || p.position || s.pos || "",
            status: item.status,
            salary: item.salary,
            weekly: w.fpts || item.weeklyProj || 0,
            season: s.fpts || item.proj || 0,
            opponent: w.opponent || item.opponent || ""
          };
        });
        // Prefer ACTIVE for starter pool; still allow RESERVE if needed
        const activeFirst = [
          ...players.filter((p) => /ACTIVE/i.test(p.status || "")),
          ...players.filter((p) => !/ACTIVE/i.test(p.status || "") && !/MINORS|INJURED/i.test(p.status || ""))
        ];
        const lineup = optimizeLineup(activeFirst.length ? activeFirst : players);
        return json({
          ok: true,
          team: my.teamName,
          teamId,
          opponent: (data.snapshots?.matchups?.matchups || []).find((g) =>
            g?.home?.teamId === teamId || g?.away?.teamId === teamId
          ) || null,
          source: "Fantrax weekly projections",
          lineup
        }, 200, origin);
      }

      return json({ ok: false, error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500, origin);
    }
  }
};
