/**
 * GM's Locker v8 — open Fantrax + projections + optimize + NFL news
 * Deploy: cd multi-ai-worker && npx wrangler deploy
 */
const ALLOWED = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com",
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
]);

const LEAGUE_DEFAULT = "astbqxhwmk4b6bg9";
const TEAM_DEFAULT = "nsf1b7esmk4b6bgd";
const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";

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

const NFL_TEAMS = [
  { id: "1", abbr: "ATL", name: "Atlanta Falcons" },
  { id: "2", abbr: "BUF", name: "Buffalo Bills" },
  { id: "3", abbr: "CHI", name: "Chicago Bears" },
  { id: "4", abbr: "CIN", name: "Cincinnati Bengals" },
  { id: "5", abbr: "CLE", name: "Cleveland Browns" },
  { id: "6", abbr: "DAL", name: "Dallas Cowboys" },
  { id: "7", abbr: "DEN", name: "Denver Broncos" },
  { id: "8", abbr: "DET", name: "Detroit Lions" },
  { id: "9", abbr: "GB", name: "Green Bay Packers" },
  { id: "10", abbr: "TEN", name: "Tennessee Titans" },
  { id: "11", abbr: "IND", name: "Indianapolis Colts" },
  { id: "12", abbr: "KC", name: "Kansas City Chiefs" },
  { id: "13", abbr: "LV", name: "Las Vegas Raiders" },
  { id: "14", abbr: "LAR", name: "Los Angeles Rams" },
  { id: "15", abbr: "MIA", name: "Miami Dolphins" },
  { id: "16", abbr: "MIN", name: "Minnesota Vikings" },
  { id: "17", abbr: "NE", name: "New England Patriots" },
  { id: "18", abbr: "NO", name: "New Orleans Saints" },
  { id: "19", abbr: "NYG", name: "New York Giants" },
  { id: "20", abbr: "NYJ", name: "New York Jets" },
  { id: "21", abbr: "PHI", name: "Philadelphia Eagles" },
  { id: "22", abbr: "ARI", name: "Arizona Cardinals" },
  { id: "23", abbr: "PIT", name: "Pittsburgh Steelers" },
  { id: "24", abbr: "LAC", name: "Los Angeles Chargers" },
  { id: "25", abbr: "SF", name: "San Francisco 49ers" },
  { id: "26", abbr: "SEA", name: "Seattle Seahawks" },
  { id: "27", abbr: "TB", name: "Tampa Bay Buccaneers" },
  { id: "28", abbr: "WSH", name: "Washington Commanders" },
  { id: "29", abbr: "CAR", name: "Carolina Panthers" },
  { id: "30", abbr: "JAX", name: "Jacksonville Jaguars" },
  { id: "33", abbr: "BAL", name: "Baltimore Ravens" },
  { id: "34", abbr: "HOU", name: "Houston Texans" }
];

function cors(origin) {
  const o = ALLOWED.has(origin) ? origin : "https://gmslocker.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

async function fantrax(endpoint, leagueId, extra = {}) {
  const url = new URL(`https://www.fantrax.com/fxea/general/${endpoint}`);
  if (endpoint !== "getPlayerIds") url.searchParams.set("leagueId", leagueId);
  else url.searchParams.set("sport", "NFL");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "GMsLocker/8.0" }
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
      "User-Agent": "GMsLocker/8.0"
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
    data: { leagueId, teamId, view: "STATS", seasonOrProjection }
  }]);
  const rows = resp?.responses?.[0]?.data?.tables?.[0]?.rows || [];
  const out = {};
  for (const row of rows) {
    const id = row?.scorer?.scorerId;
    if (!id) continue;
    out[id] = {
      id,
      name: row?.scorer?.name || id,
      pos: String(row?.scorer?.posShortNames || "").replace(/<[^>]+>/g, ""),
      fpts: cellNum(row.cells, 4),
      ppg: cellNum(row.cells, 5),
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
      fetchTeamProjections(leagueId, tid, SEASON_PROJ).then((m) => ({ kind: "season", m })),
      fetchTeamProjections(leagueId, tid, WEEKLY_PROJ).then((m) => ({ kind: "weekly", m }))
    ])
  );
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    Object.assign(r.value.kind === "season" ? season : weekly, r.value.m);
  }
  return { season, weekly };
}

function primaryPos(posStr) {
  const p = String(posStr || "").toUpperCase();
  if (p.includes("QB") || p.includes("SFX")) return "QB";
  if (p.includes("RB")) return "RB";
  if (p.includes("WR")) return "WR";
  if (p.includes("TE")) return "TE";
  if (/DL|DE|DT|EDGE/.test(p)) return "DL";
  if (p.includes("LB")) return "LB";
  if (/DB|CB|S\b/.test(p)) return "DB";
  return p.split(/[^A-Z]/)[0] || "?";
}

function optimizeLineup(players) {
  const pool = players
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
  const bench = pool.filter((p) => !used.has(p.id)).map((p) => ({
    id: p.id, name: p.name, pos: p.pos,
    weekly: Math.round(p.score * 10) / 10, season: p.season || 0
  }));
  return {
    starters,
    bench,
    projectedTotal: Math.round(starters.reduce((s, x) => s + (x.weekly || 0), 0) * 10) / 10
  };
}

async function syncAll(leagueId) {
  const startedAt = new Date().toISOString();
  const kinds = ["league", "rosters", "standings", "matchups", "draftPicks", "draftResults", "players"];
  const endpoints = {
    league: "getLeagueInfo", rosters: "getTeamRosters", standings: "getStandings",
    matchups: "getMatchupScores", draftPicks: "getDraftPicks", draftResults: "getDraftResults",
    players: "getPlayerIds"
  };
  const base = await Promise.allSettled(kinds.map((k) => fantrax(endpoints[k], leagueId)));
  const snapshots = {};
  const errors = [];
  base.forEach((r, i) => {
    if (r.status === "fulfilled") snapshots[kinds[i]] = r.value;
    else errors.push({ kind: kinds[i], error: String(r.reason?.message || r.reason) });
  });

  const rosterMap = snapshots.rosters?.rosters || {};
  const teamIds = Object.keys(rosterMap);
  let projections = { season: {}, weekly: {} };
  try {
    projections = await fetchAllProjections(leagueId, teamIds.length ? teamIds : [TEAM_DEFAULT]);
  } catch (e) {
    errors.push({ kind: "projections", error: String(e?.message || e) });
  }

  let matched = 0;
  for (const team of Object.values(rosterMap)) {
    for (const item of team.rosterItems || []) {
      const id = String(item.id || "");
      const s = projections.season[id];
      const w = projections.weekly[id];
      if (s) { item.proj = s.fpts; item.ppg = s.ppg; matched++; }
      if (w) { item.weeklyProj = w.fpts; item.opponent = w.opponent; }
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
      matched,
      seasonCount: Object.keys(projections.season).length,
      weeklyCount: Object.keys(projections.weekly).length
    },
    lineupSlots: LINEUP_SLOTS,
    errors,
    leagueId
  };
}

function parseEspnArticle(a) {
  const teams = [];
  for (const c of a.categories || []) {
    if (c.teamId || c.team) {
      teams.push({
        id: String(c.teamId || c.team?.id || ""),
        abbr: c.team?.abbreviation || c.description || "",
        name: c.team?.displayName || c.description || ""
      });
    }
  }
  const link = a.links?.web?.href || a.links?.mobile?.href || "";
  const img = (a.images && a.images[0] && a.images[0].url) || "";
  return {
    id: a.id,
    headline: a.headline,
    description: a.description || "",
    published: a.published || a.lastModified,
    byline: a.byline || "",
    link,
    image: img,
    teams,
    premium: !!a.premium
  };
}

async function fetchNflNews({ teamId, limit = 40 } = {}) {
  let url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=${Math.min(100, limit)}`;
  if (teamId) url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/news?limit=${Math.min(50, limit)}`;
  const res = await fetch(url, { headers: { "User-Agent": "GMsLocker/8.0", Accept: "application/json" } });
  if (!res.ok) throw new Error("ESPN news HTTP " + res.status);
  const data = await res.json();
  const articles = (data.articles || []).map(parseEspnArticle);
  return { ok: true, source: "ESPN", teamId: teamId || null, count: articles.length, articles, teams: NFL_TEAMS };
}

async function fetchScores() {
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard", {
    headers: { "User-Agent": "GMsLocker/8.0", Accept: "application/json" }
  });
  if (!res.ok) throw new Error("ESPN scores HTTP " + res.status);
  return res.json();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    const url = new URL(request.url);
    const leagueId = env.FANTRAX_LEAGUE_ID || LEAGUE_DEFAULT;
    const teamId = env.FANTRAX_TEAM_ID || TEAM_DEFAULT;

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "GM's Locker v8 Fantrax Gateway",
        fantraxConfigured: true,
        accessConfigured: false,
        leagueId,
        projections: "fantrax",
        sportsFeeds: ["scores", "news"],
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
            weekly: w.fpts || item.weeklyProj || 0,
            season: s.fpts || item.proj || 0,
            opponent: w.opponent || ""
          };
        });
        const active = players.filter((p) => /ACTIVE/i.test(p.status || ""));
        const rest = players.filter((p) => !/ACTIVE/i.test(p.status || "") && !/MINORS|INJURED/i.test(p.status || ""));
        const lineup = optimizeLineup(active.concat(rest));
        const matchup = (data.snapshots?.matchups?.matchups || []).find(
          (g) => g?.home?.teamId === teamId || g?.away?.teamId === teamId
        ) || null;
        return json({ ok: true, team: my.teamName, teamId, opponent: matchup, source: "Fantrax weekly projections", lineup }, 200, origin);
      }

      if (url.pathname === "/sports/news" || url.pathname === "/news") {
        const team = url.searchParams.get("team") || url.searchParams.get("teamId") || "";
        const limit = Number(url.searchParams.get("limit") || 50);
        return json(await fetchNflNews({ teamId: team || null, limit }), 200, origin);
      }

      if (url.pathname === "/sports/scores" || url.pathname === "/scores") {
        return json({ ok: true, scoreboard: await fetchScores() }, 200, origin);
      }

      if (url.pathname === "/teams/nfl") {
        return json({ ok: true, teams: NFL_TEAMS }, 200, origin);
      }

      return json({ ok: false, error: "Not found" }, 404, origin);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) }, 500, origin);
    }
  }
};
