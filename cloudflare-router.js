import app from "./cloudflare-worker.js";

const FANTRAX_PA = "https://www.fantrax.com/fxpa/req";
const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";
const LAST_SEASON = "SEASON_23j_YEAR_TO_DATE";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return healthCheck(env);
    }

    const response = await app.fetch(request, env, ctx);

    if (request.method === "GET" && url.pathname === "/current-games") {
      if (response.status === 401 || response.status === 402 || response.status === 403) return response;
      return enrichCurrentGames(response, url);
    }

    if (request.method === "GET" && response.ok && url.pathname === "/league-data") {
      return enrichLeagueData(response);
    }

    return response;
  }
};

async function healthCheck(env) {
  const checks = {
    worker: true,
    d1Binding: Boolean(env.DB),
    aiBinding: Boolean(env.AI),
    fantrax: false,
    espnSchedule: false
  };
  const errors = [];

  try {
    const fantrax = await fetch("https://www.fantrax.com/fxea/general/getPlayerIds?sport=NFL", {
      headers: { Accept: "application/json", "User-Agent": "GMSLocker/2.2" },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    checks.fantrax = fantrax.ok;
    if (!fantrax.ok) errors.push("Fantrax HTTP " + fantrax.status);
  } catch (error) {
    errors.push("Fantrax: " + String(error?.message || error));
  }

  try {
    const season = new Date().getUTCFullYear();
    const espn = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=2&dates=" + season + "&seasontype=1", {
      headers: { Accept: "application/json", "User-Agent": "GMSLocker/2.2" },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    checks.espnSchedule = espn.ok;
    if (!espn.ok) errors.push("ESPN HTTP " + espn.status);
  } catch (error) {
    errors.push("ESPN: " + String(error?.message || error));
  }

  const ok = Object.values(checks).every(Boolean);
  return output({ ok, checks, errors, version: "2.2-health", checkedAt: new Date().toISOString() }, ok ? 200 : 503);
}

async function enrichLeagueData(response) {
  const data = await response.json();
  const leagueId = data?.workspace?.leagueId;
  if (!leagueId) return output(data, response.status);

  const freeAgents = data.freeAgents || (data.freeAgents = {});
  freeAgents.season = freeAgents.season || {};
  freeAgents.weekly = freeAgents.weekly || {};
  freeAgents.performance = freeAgents.performance || {};

  const seen = new Set([
    ...Object.keys(freeAgents.season),
    ...Object.keys(freeAgents.weekly),
    ...Object.keys(freeAgents.performance)
  ]);

  for (let page = 2; page <= 8; page += 1) {
    try {
      const batch = await fetchPoolPage(leagueId, page);
      const season = parseStatsResponse(batch.responses?.[0]);
      const weekly = parseStatsResponse(batch.responses?.[1]);
      const performance = parseStatsResponse(batch.responses?.[2]);
      const pageIds = new Set([
        ...Object.keys(season.players),
        ...Object.keys(weekly.players),
        ...Object.keys(performance.players)
      ]);
      if (!pageIds.size) break;

      Object.assign(freeAgents.season, season.players);
      Object.assign(freeAgents.weekly, weekly.players);
      if (performance.selection === LAST_SEASON) Object.assign(freeAgents.performance, performance.players);

      let added = 0;
      pageIds.forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          added += 1;
        }
      });
      if (!added) break;
    } catch (error) {
      data.warnings = (data.warnings || []).concat("Additional free-agent pages: " + String(error?.message || error));
      break;
    }
  }

  data.freeAgentCount = seen.size;
  data.partial = Boolean(data.partial || (data.warnings || []).length);
  return output(data, response.status);
}

async function enrichCurrentGames(response, url) {
  let data = {};
  try {
    data = await response.json();
  } catch (_) {
    data = { ok: false, games: [] };
  }

  data.games = Array.isArray(data.games) ? data.games : [];

  const season = String(url.searchParams.get("season") || new Date().getUTCFullYear()).replace(/[^0-9]/g, "").slice(0, 4);
  const seasonType = url.searchParams.get("seasonType") === "1" ? "1" : "2";
  const types = seasonType === "1" ? ["1", "2"] : ["2", "1"];
  let schedule = [];
  const errors = [];

  for (const type of types) {
    try {
      const espn = await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=" + season + "&seasontype=" + type,
        { headers: { Accept: "application/json", "User-Agent": "GMSLocker/2.2" }, cf: { cacheTtl: 60, cacheEverything: true } }
      );
      if (!espn.ok) throw new Error("NFL schedule HTTP " + espn.status + " (type " + type + ")");
      const board = await espn.json();
      const events = (board.events || []).map(scheduleEvent).filter(Boolean);
      schedule = schedule.concat(events);
      if (events.length) break;
    } catch (error) {
      errors.push(String(error?.message || error));
    }
  }

  const byId = new Map();
  schedule.forEach((g) => { if (g && g.id) byId.set(g.id, g); });
  data.schedule = Array.from(byId.values()).sort((a, b) => new Date(a.date) - new Date(b.date));
  data.scheduleSource = "ESPN NFL scoreboard";
  data.scheduleCount = data.schedule.length;
  if (!data.schedule.length && errors.length) data.scheduleError = errors.join(" · ");
  data.syncedAt = data.syncedAt || new Date().toISOString();

  const status = data.schedule.length || response.ok ? 200 : response.status || 502;
  return output(data, status);
}

function scheduleEvent(event) {
  const competition = event?.competitions?.[0];
  if (!competition) return null;
  const competitors = competition.competitors || [];
  const home = competitors.find((team) => team.homeAway === "home");
  const away = competitors.find((team) => team.homeAway === "away");
  return {
    id: String(event.id || ""),
    date: event.date || competition.date || "",
    name: event.name || event.shortName || "NFL game",
    shortName: event.shortName || event.name || "NFL game",
    state: event.status?.type?.state || "pre",
    status: event.status?.type?.shortDetail || event.status?.type?.detail || "Scheduled",
    home: teamSummary(home),
    away: teamSummary(away),
    venue: competition.venue?.fullName || "",
    broadcasts: (competition.broadcasts || []).flatMap((item) => item.names || [])
  };
}

function teamSummary(row) {
  return {
    id: String(row?.team?.id || ""),
    abbreviation: row?.team?.abbreviation || "",
    name: row?.team?.displayName || row?.team?.shortDisplayName || "",
    score: row?.score == null ? "" : String(row.score),
    winner: Boolean(row?.winner)
  };
}

async function fetchPoolPage(leagueId, pageNumber) {
  const response = await fetch(FANTRAX_PA + "?leagueId=" + encodeURIComponent(leagueId), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "GMSLocker/2.2" },
    body: JSON.stringify({ msgs: [poolMessage(leagueId, SEASON_PROJ, pageNumber), poolMessage(leagueId, WEEKLY_PROJ, pageNumber), poolMessage(leagueId, LAST_SEASON, pageNumber)] })
  });
  if (!response.ok) throw new Error("Fantrax free-agent page " + pageNumber + " HTTP " + response.status);
  return response.json();
}

function poolMessage(leagueId, seasonOrProjection, pageNumber) {
  return {
    method: "getPlayerStats",
    data: {
      leagueId,
      pageNumber,
      maxResultsPerPage: 750,
      statusOrTeamFilter: "AVAILABLE",
      view: "STATS",
      seasonOrProjection,
      sortType: "SCORE",
      sortDirection: -1
    }
  };
}

function parseStatsResponse(response) {
  const data = response?.data || {};
  const headers = data.tableHeader?.cells || data.tables?.[0]?.header?.cells || [];
  const rows = data.statsTable || data.tables?.flatMap((table) => table.rows || []) || [];
  const index = {};
  headers.forEach((header, i) => { index[header.key || header.shortName || String(i)] = i; });
  const cell = (row, key, fallback) => row.cells?.[index[key] == null ? fallback : index[key]]?.content;
  const players = {};

  for (const row of rows) {
    const scorer = row.scorer || {};
    const id = String(scorer.scorerId || "");
    if (!id) continue;
    const notes = (scorer.icons || []).map((icon) => plain(icon.tooltip)).filter(Boolean);
    players[id] = {
      id,
      name: scorer.name || id,
      nflTeam: scorer.teamShortName || "",
      position: plain(scorer.posShortNames),
      rank: numberFrom(scorer.rank ?? cell(row, "rankOv", 0)),
      status: plain(cell(row, "status", 1)),
      age: numberFrom(cell(row, "age", 2)),
      opponent: plain(cell(row, "opponent", 3)),
      salary: numberFrom(cell(row, "salary", 4)),
      contract: numberFrom(cell(row, "contract", 5)),
      fpts: numberFrom(cell(row, "fpts", 6)),
      ppg: numberFrom(cell(row, "fptsPerGame", 7)),
      bye: numberFrom(cell(row, "bye", 8)),
      rosteredPct: numberFrom(cell(row, "OVERVIEW_PERCENT_OWNED_2", 9)),
      rosterTrend: numberFrom(cell(row, "OVERVIEW_PLUS_MINUS_PERCENT_OWNED_2", 10)),
      injury: notes.find((note) => /questionable|doubtful|out|injur|ir|suspend|concussion|hamstring|knee|ankle|groin|shoulder/i.test(note)) || "",
      notes
    };
  }

  return {
    players,
    selection: data.displayedSeasonOrProjection?.code || data.displayedSelections?.displayedSeasonOrProjection?.code || ""
  };
}

function numberFrom(value) {
  const number = Number(String(value == null ? "" : value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(number) ? number : null;
}

function plain(value) {
  return String(value == null ? "" : value).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function output(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "https://gmslocker.com",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin"
    }
  });
}
