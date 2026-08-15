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
      if (url.pathname === "/current-games") return currentGames(url);
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
    const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=1", { headers: requestHeaders() });
    checks.espn = response.ok;
    if (!response.ok) errors.push("ESPN HTTP " + response.status);
  } catch (error) { errors.push("ESPN: " + String(error?.message || error)); }
  return json({ ok: checks.worker && checks.db && checks.fantrax && checks.espn, service: "gmslocker-api", version: "2.1.0", checks, errors, checkedAt: new Date().toISOString() });
}

function requestHeaders(extra = {}) {
  return { Accept: "application/json", "User-Agent": "GMSLocker/2.1", ...extra };
}

function hex(buf) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha(value) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)))); }
function randomToken() { const a = new Uint8Array(32); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function randomSalt() { return hex(crypto.getRandomValues(new Uint8Array(16))); }

async function passwordHash(password, saltHex) {
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}

async function legacyPasswordHash(password, saltHex) {
  const salt = Uint8Array.from((saltHex.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
  const encoder = new TextEncoder();
  const firstMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const firstPass = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, firstMaterial, 256);
  const secondMaterial = await crypto.subtle.importKey("raw", firstPass, "PBKDF2", false, ["deriveBits"]);
  const secondSalt = await crypto.subtle.digest("SHA-256", new Uint8Array([...salt, ...encoder.encode("gmslocker-password-v2")]));
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: secondSalt, iterations: 100000 }, secondMaterial, 256));
}

async function getAuth(request, env) {
  const match = String(request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/);
  if (!match || !env.DB) return null;
  const tokenHash = await sha(match[1]);
  const row = await env.DB.prepare(`SELECT s.token_hash,u.id,u.username,u.email,u.display_name FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP`).bind(tokenHash).first();
  if (!row) return null;
  return { tokenHash, user: { id: row.id, username: row.username, email: row.email, displayName: row.display_name || "", isOwner: row.email === OWNER_EMAIL } };
}

async function register(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase().slice(0, 30);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(username)) return json({ error: "Invalid username" }, 400);
  if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Invalid email" }, 400);
  if (password.length < 10 || password.length > 128) return json({ error: "Password must be 10-128 characters" }, 400);
  const salt = randomSalt();
  const hash = await passwordHash(password, salt);
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare("INSERT INTO users (id,email,username,password_hash,password_salt) VALUES (?,?,?,?,?)").bind(id, email, username, hash, salt).run();
  } catch (_) { return json({ error: "Username or email taken" }, 409); }
  return createSession(env, { id, username, email });
}

async function login(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = await env.DB.prepare("SELECT id,username,email,password_hash,password_salt FROM users WHERE username=?").bind(username).first();
  if (!user || !user.password_hash || !user.password_salt) return json({ error: "Username or password incorrect" }, 401);
  const current = await passwordHash(password, user.password_salt);
  let valid = current === user.password_hash;
  if (!valid) valid = (await legacyPasswordHash(password, user.password_salt)) === user.password_hash;
  if (!valid) return json({ error: "Username or password incorrect" }, 401);
  return createSession(env, user);
}

async function createSession(env, user) {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(await sha(token), user.id).run();
  await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id).run();
  return json({ token, user: { id: user.id, username: user.username, email: user.email } });
}

async function logout(env, auth) {
  if (auth) await env.DB.prepare("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(auth.tokenHash).run();
  return json({ ok: true });
}

async function listLeagues(env, auth) {
  const result = await env.DB.prepare(`SELECT id,fantrax_league_id AS leagueId,league_name AS leagueName,team_id AS teamId,team_name AS teamName,settings_json AS settings FROM user_leagues WHERE user_id=? ORDER BY updated_at DESC`).bind(auth.user.id).all();
  return json({ leagues: (result.results || []).map((row) => ({ ...row, settings: safeParse(row.settings) })) });
}
function safeParse(value) { try { return JSON.parse(value || "{}"); } catch (_) { return {}; } }

function extractLeagueId(raw) {
  const value = String(raw || "").trim();
  const query = value.match(/[?&]leagueId=([A-Za-z0-9]+)/i);
  const path = value.match(/\/(?:fantasy\/)?league\/([A-Za-z0-9]+)/i);
  const id = query?.[1] || path?.[1] || value;
  return /^[A-Za-z0-9]{6,64}$/.test(id) ? id : "";
}

async function fantrax(endpoint, leagueId) {
  const url = new URL(FANTRAX_GENERAL + endpoint);
  if (endpoint === "getPlayerIds") url.searchParams.set("sport", "NFL"); else url.searchParams.set("leagueId", leagueId);
  const response = await fetch(url.toString(), { headers: requestHeaders() });
  if (!response.ok) throw new Error(endpoint + " HTTP " + response.status);
  return response.json();
}

async function inspectLeague(request) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await request.json().catch(() => ({}));
  const leagueId = extractLeagueId(body.league);
  if (!leagueId) return json({ error: "Enter Fantrax league ID or link" }, 400);
  try {
    const [rosters, info] = await Promise.all([fantrax("getTeamRosters", leagueId), fantrax("getLeagueInfo", leagueId)]);
    const teams = Object.keys(rosters.rosters || {}).map((id) => ({ id, name: rosters.rosters[id].teamName || id })).sort((a, b) => a.name.localeCompare(b.name));
    return json({ leagueId, leagueName: info?.leagueName || info?.name || "Fantrax League", teams });
  } catch (error) { return json({ error: "Could not read Fantrax league", detail: String(error?.message || error) }, 400); }
}

async function saveLeague(request, env, auth) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await request.json().catch(() => ({}));
  const leagueId = extractLeagueId(body.leagueId);
  const teamId = String(body.teamId || "");
  const teamName = String(body.teamName || "").trim();
  const leagueName = String(body.leagueName || "Fantrax League").trim();
  if (!leagueId || !teamId || !teamName) return json({ error: "League and team required" }, 400);
  const existing = await env.DB.prepare("SELECT id FROM user_leagues WHERE user_id=? AND fantrax_league_id=?").bind(auth.user.id, leagueId).first();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO user_leagues (id,user_id,fantrax_league_id,league_name,team_id,team_name) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,fantrax_league_id) DO UPDATE SET league_name=excluded.league_name,team_id=excluded.team_id,team_name=excluded.team_name,updated_at=CURRENT_TIMESTAMP`).bind(id, auth.user.id, leagueId, leagueName, teamId, teamName).run();
  return json({ league: { id, leagueId, leagueName, teamId, teamName } });
}

async function ownedLeague(env, auth, id) {
  if (id) return env.DB.prepare("SELECT * FROM user_leagues WHERE id=? AND user_id=?").bind(id, auth.user.id).first();
  return env.DB.prepare("SELECT * FROM user_leagues WHERE user_id=? ORDER BY updated_at DESC LIMIT 1").bind(auth.user.id).first();
}

async function leagueSnapshot(ws) {
  const leagueId = ws.fantrax_league_id;
  const warnings = [];
  const [rosters, standings, picks, matchups, leagueInfo, playerIds] = await Promise.all([
    fantrax("getTeamRosters", leagueId),
    fantrax("getStandings", leagueId).catch((e) => { warnings.push("Standings: " + e.message); return null; }),
    fantrax("getDraftPicks", leagueId).catch((e) => { warnings.push("Draft picks: " + e.message); return null; }),
    fantrax("getMatchupScores", leagueId).catch((e) => { warnings.push("Matchups: " + e.message); return null; }),
    fantrax("getLeagueInfo", leagueId).catch((e) => { warnings.push("League info: " + e.message); return null; }),
    fantrax("getPlayerIds", leagueId).catch((e) => { warnings.push("Player IDs: " + e.message); return null; })
  ]);

  const [allPool, availablePool, weeklyLog] = await Promise.all([
    fetchStatPool(leagueId, null, 8).catch((e) => { warnings.push("Player stats: " + e.message); return emptyPool(); }),
    fetchStatPool(leagueId, "AVAILABLE", 8).catch((e) => { warnings.push("Free agents: " + e.message); return emptyPool(); }),
    fetchWeeklyLog(leagueId).catch((e) => { warnings.push("Weekly scoring log: " + e.message); return []; })
  ]);
  const volatility = GMSAnalysisEngine.weeklyLogLooksReal(weeklyLog) ? GMSAnalysisEngine.computeVolatilityMap(weeklyLog) : {};
  if (weeklyLog.length && !Object.keys(volatility).length) warnings.push("Weekly scoring log: Fantrax did not return distinct per-week data for this league; boom/bust volatility is unavailable this sync.");

  const playerMap = mergePlayerData(playerIds, allPool);
  const freeAgents = mergeStatGroups(availablePool);
  Object.values(playerMap).forEach((p) => { p.volatility = volatility[p.id] || null; });
  freeAgents.forEach((p) => { p.volatility = volatility[p.id] || null; });
  const teams = buildTeams(rosters, playerMap, picks);
  const engine = new GMSAnalysisEngine(prideFinancialRules());
  const rankings = engine.analyzeLeague(teams).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const myTeam = teams.find((team) => String(team.id) === String(ws.team_id)) || teams.find((team) => team.name === ws.team_name) || null;
  const recommendations = myTeam ? engine.recommendFreeAgents(myTeam, freeAgents, 15, { leagueTeams: teams, leagueInfo }) : [];

  return {
    ok: true,
    source: "Fantrax live",
    syncedAt: new Date().toISOString(),
    workspace: { id: ws.id, leagueId, leagueName: ws.league_name, teamId: ws.team_id, teamName: ws.team_name },
    rosters,
    standings,
    picks,
    matchups,
    leagueInfo,
    teams,
    freeAgents,
    freeAgentCount: freeAgents.length,
    rankings,
    myAnalysis: rankings.find((report) => String(report.teamId) === String(myTeam?.id)) || null,
    recommendations,
    warnings,
    partial: warnings.length > 0
  };
}

async function leagueData(url, env, auth) {
  const ws = await ownedLeague(env, auth, url.searchParams.get("workspaceId"));
  if (!ws) return json({ error: "Link a Fantrax league first" }, 404);
  try { return json(await leagueSnapshot(ws)); }
  catch (error) { return json({ error: "Fantrax sync failed", detail: String(error?.message || error) }, 502); }
}

function emptyPool() { return { season: {}, weekly: {}, performance: {} }; }

async function fetchStatPool(leagueId, statusOrTeamFilter, maxPages = 8) {
  const aggregate = emptyPool();
  const seen = new Set();
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await fetch(FANTRAX_PA + "?leagueId=" + encodeURIComponent(leagueId), {
      method: "POST",
      headers: requestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ msgs: [
        statsMessage(leagueId, SEASON_PROJ, page, statusOrTeamFilter),
        statsMessage(leagueId, WEEKLY_PROJ, page, statusOrTeamFilter),
        statsMessage(leagueId, LAST_SEASON, page, statusOrTeamFilter)
      ] })
    });
    if (!response.ok) throw new Error("fxpa page " + page + " HTTP " + response.status);
    const batch = await response.json();
    const season = parseStats(batch.responses?.[0]);
    const weekly = parseStats(batch.responses?.[1]);
    const performance = parseStats(batch.responses?.[2]);
    Object.assign(aggregate.season, season.players);
    Object.assign(aggregate.weekly, weekly.players);
    Object.assign(aggregate.performance, performance.players);
    const ids = new Set([...Object.keys(season.players), ...Object.keys(weekly.players), ...Object.keys(performance.players)]);
    if (!ids.size) break;
    let added = 0;
    ids.forEach((id) => { if (!seen.has(id)) { seen.add(id); added += 1; } });
    if (!added) break;
  }
  return aggregate;
}

async function fetchWeeklyLog(leagueId, maxWeeks = 17) {
  const weeks = Array.from({ length: maxWeeks }, (_, i) => i + 1);
  const attempts = await Promise.all(weeks.map(async (week) => {
    try {
      const response = await fetch(FANTRAX_PA + "?leagueId=" + encodeURIComponent(leagueId), {
        method: "POST",
        headers: requestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ msgs: [{ method: "getPlayerStats", data: { leagueId, pageNumber: 1, maxResultsPerPage: 750, view: "STATS", seasonOrProjection: LAST_SEASON, period: String(week), sortType: "SCORE", sortDirection: -1 } }] })
      });
      if (!response.ok) return null;
      const batch = await response.json();
      const parsed = parseStats(batch.responses?.[0]);
      return Object.keys(parsed.players).length ? { week, players: parsed.players } : null;
    } catch (_) { return null; }
  }));
  return attempts.filter(Boolean);
}

function statsMessage(leagueId, seasonOrProjection, pageNumber, statusOrTeamFilter) {
  const data = { leagueId, pageNumber, maxResultsPerPage: 750, view: "STATS", seasonOrProjection, sortType: "SCORE", sortDirection: -1 };
  if (statusOrTeamFilter) data.statusOrTeamFilter = statusOrTeamFilter;
  return { method: "getPlayerStats", data };
}

function parseStats(response) {
  const data = response?.data || {};
  const headers = data.tableHeader?.cells || data.tables?.[0]?.header?.cells || [];
  const rows = data.statsTable || data.tables?.flatMap((table) => table.rows || []) || [];
  const index = {};
  headers.forEach((header, i) => { index[header.key || header.shortName || String(i)] = i; });
  const cell = (row, key, fallback) => row.cells?.[index[key] == null ? fallback : index[key]]?.content;
  const players = {};
  for (const row of rows) {
    const scorer = row.scorer || {};
    const id = String(scorer.scorerId || row.scorerId || "");
    if (!id) continue;
    const notes = (scorer.icons || []).map((icon) => plain(icon.tooltip)).filter(Boolean);
    players[id] = {
      id,
      name: scorer.name || id,
      nflTeam: scorer.teamShortName || null,
      position: plain(scorer.posShortNames) || null,
      rank: num(scorer.rank ?? cell(row, "rankOv", 0)),
      status: plain(cell(row, "status", 1)) || null,
      age: num(cell(row, "age", 2)),
      opponent: plain(cell(row, "opponent", 3)) || null,
      salary: num(cell(row, "salary", 4)),
      contract: num(cell(row, "contract", 5)),
      fpts: num(cell(row, "fpts", 6)),
      ppg: num(cell(row, "fptsPerGame", 7)),
      bye: num(cell(row, "bye", 8)),
      rosteredPct: num(cell(row, "OVERVIEW_PERCENT_OWNED_2", 9)),
      rosterTrend: num(cell(row, "OVERVIEW_PLUS_MINUS_PERCENT_OWNED_2", 10)),
      injury: notes.find((note) => /questionable|doubtful|out|injur|ir|suspend|concussion|hamstring|knee|ankle|groin|shoulder/i.test(note)) || null,
      notes
    };
  }
  return { players };
}

function mergeStatGroups(pool) {
  const ids = new Set([...Object.keys(pool.season || {}), ...Object.keys(pool.weekly || {}), ...Object.keys(pool.performance || {})]);
  return [...ids].map((id) => mergeOne(id, pool)).filter((player) => player.name && player.name !== player.id);
}

function mergeOne(id, pool) {
  const season = pool.season?.[id] || {};
  const weekly = pool.weekly?.[id] || {};
  const performance = pool.performance?.[id] || {};
  return {
    ...performance,
    ...season,
    ...weekly,
    id,
    name: weekly.name || season.name || performance.name || id,
    weeklyProjection: weekly.fpts ?? weekly.ppg ?? null,
    seasonProjection: season.fpts ?? null,
    performancePpg: performance.ppg ?? null,
    ppg: performance.ppg ?? null,
    salary: weekly.salary ?? season.salary ?? performance.salary ?? null,
    contract: weekly.contract ?? season.contract ?? performance.contract ?? null,
    rosteredPct: weekly.rosteredPct ?? season.rosteredPct ?? performance.rosteredPct ?? null,
    rosterTrend: weekly.rosterTrend ?? season.rosterTrend ?? performance.rosterTrend ?? null,
    age: weekly.age ?? season.age ?? performance.age ?? null,
    position: weekly.position || season.position || performance.position || null,
    nflTeam: weekly.nflTeam || season.nflTeam || performance.nflTeam || null,
    injury: weekly.injury || season.injury || performance.injury || null,
    status: weekly.status || season.status || performance.status || null
  };
}

function mergePlayerData(playerIds, allPool) {
  const merged = {};
  mergeStatGroups(allPool).forEach((player) => { merged[player.id] = player; });
  const source = playerIds?.playerIds || playerIds?.players || playerIds || {};
  if (Array.isArray(source)) {
    source.forEach((row) => {
      const id = String(row.id || row.playerId || row.scorerId || "");
      if (!id) return;
      merged[id] = { ...(merged[id] || { id }), name: merged[id]?.name || row.name || row.playerName || id, position: merged[id]?.position || row.position || row.pos || null, nflTeam: merged[id]?.nflTeam || row.team || row.nflTeam || null };
    });
  } else if (source && typeof source === "object") {
    Object.entries(source).forEach(([key, value]) => {
      const row = value && typeof value === "object" ? value : { name: value };
      const id = String(row.id || row.playerId || row.scorerId || key);
      merged[id] = { ...(merged[id] || { id }), name: merged[id]?.name || row.name || row.playerName || String(value || id), position: merged[id]?.position || row.position || row.pos || null, nflTeam: merged[id]?.nflTeam || row.team || row.nflTeam || null };
    });
  }
  return merged;
}

function rosterItemId(item) {
  return String(item?.id || item?.playerId || item?.scorerId || item?.fantasyPlayerId || item?.player?.id || item?.player?.scorerId || "");
}

function buildTeams(rosters, playerMap, picksPayload) {
  const pickRows = picksPayload?.futureDraftPicks || picksPayload?.picks || [];
  return Object.entries(rosters?.rosters || {}).map(([id, roster]) => {
    const players = (roster.rosterItems || []).map((item) => {
      const pid = rosterItemId(item);
      const stats = playerMap[pid] || {};
      return {
        ...stats,
        ...item,
        id: pid || String(item?.name || item?.playerName || crypto.randomUUID()),
        name: stats.name || item?.name || item?.playerName || item?.player?.name || (pid || "Unavailable"),
        position: stats.position || item?.position || item?.pos || item?.player?.position || null,
        salary: stats.salary ?? num(item?.salary) ?? null,
        rosterSlot: item?.rosterSlot || item?.slot || item?.status || null
      };
    });
    const picks = (pickRows || []).filter((pick) => [pick.teamId, pick.ownerTeamId, pick.currentTeamId, pick.fantasyTeamId].some((value) => String(value || "") === String(id)));
    return { id, name: roster.teamName || id, players, picks, deadCap: num(roster.deadCap) };
  });
}

function prideFinancialRules() {
  return { now: new Date() };
}

function tradePickKey(pick) { return String(pick?.id || pick?.pickId || [pick?.year ?? pick?.season ?? pick?.draftYear, pick?.round ?? pick?.draftRound, pick?.originalTeamId ?? pick?.originalOwnerTeamId ?? pick?.teamId].join("-")); }

async function tradeSuggestion(request, env, auth) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await request.json().catch(() => ({}));
  const ws = await ownedLeague(env, auth, body.workspaceId);
  if (!ws) return json({ error: "League not found" }, 404);
  const snapshot = await leagueSnapshot(ws);
  const myTeam = snapshot.teams.find((team) => String(team.id) === String(ws.team_id)) || snapshot.teams.find((team) => team.name === ws.team_name);
  const targetTeam = snapshot.teams.find((team) => String(team.id) === String(body.targetTeamId));
  if (!myTeam || !targetTeam || String(myTeam.id) === String(targetTeam.id)) return json({ error: "Choose another team as the trade partner" }, 400);
  const targetPlayer = targetTeam.players.find((player) => String(player.id) === String(body.targetPlayerId));
  if (!targetPlayer) return json({ error: "Choose a live player from the other team's roster" }, 400);
  const targetPick = body.targetPickKey ? targetTeam.picks.find((pick) => tradePickKey(pick) === String(body.targetPickKey)) : null;
  if (body.targetPickKey && !targetPick) return json({ error: "The selected pick is not currently owned by that team" }, 400);
  const engine = new GMSAnalysisEngine(prideFinancialRules());
  const suggestions = engine.suggestTradeOffers(myTeam, targetTeam, targetPlayer, targetPick, { leagueTeams: snapshot.teams });
  return json({ myTeam:{id:myTeam.id,name:myTeam.name},targetTeam:{id:targetTeam.id,name:targetTeam.name},targetPlayer,targetPick,suggestions,note:"Suggestions rank who to offer; they do not guarantee acceptance. Missing Fantrax salary, contract, pick round/year, dead money, or scoring evidence remains unavailable." });
}

async function tradeAnalysis(request, env, auth) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  const body = await request.json().catch(() => ({}));
  const ws = await ownedLeague(env, auth, body.workspaceId);
  if (!ws) return json({ error: "League not found" }, 404);
  const snapshot = await leagueSnapshot(ws);
  const teamA = snapshot.teams.find((team) => String(team.id) === String(body.teamA));
  const teamB = snapshot.teams.find((team) => String(team.id) === String(body.teamB));
  if (!teamA || !teamB || teamA.id === teamB.id) return json({ error: "Choose two different synced teams" }, 400);
  const giveA = new Set((body.giveA || []).map(String));
  const giveB = new Set((body.giveB || []).map(String));
  const pickKeysA = new Set((body.picksA || []).map(String));
  const pickKeysB = new Set((body.picksB || []).map(String));
  const playersA = teamA.players.filter((p) => giveA.has(String(p.id)));
  const playersB = teamB.players.filter((p) => giveB.has(String(p.id)));
  const picksA = teamA.picks.filter((pick) => pickKeysA.has(tradePickKey(pick)));
  const picksB = teamB.picks.filter((pick) => pickKeysB.has(tradePickKey(pick)));
  if (picksA.length !== pickKeysA.size || picksB.length !== pickKeysB.size) return json({ error: "One or more selected picks are not owned by that team" }, 400);
  if (!playersA.length && !playersB.length && !picksA.length && !picksB.length) return json({ error: "Select at least one player or pick in the trade" }, 400);

  const beforeTeams = snapshot.teams;
  const afterA = { ...teamA, players: [...teamA.players.filter((p) => !giveA.has(String(p.id))), ...playersB], picks: [...teamA.picks.filter((pick) => !pickKeysA.has(tradePickKey(pick))), ...picksB] };
  const afterB = { ...teamB, players: [...teamB.players.filter((p) => !giveB.has(String(p.id))), ...playersA], picks: [...teamB.picks.filter((pick) => !pickKeysB.has(tradePickKey(pick))), ...picksA] };
  const afterTeams = beforeTeams.map((team) => team.id === teamA.id ? afterA : team.id === teamB.id ? afterB : team);
  const engine = new GMSAnalysisEngine(prideFinancialRules());
  const before = engine.analyzeLeague(beforeTeams);
  const after = engine.analyzeLeague(afterTeams);
  const beforeA = before.find((r) => r.teamId === teamA.id); const beforeB = before.find((r) => r.teamId === teamB.id);
  const afterAReport = after.find((r) => r.teamId === teamA.id); const afterBReport = after.find((r) => r.teamId === teamB.id);
  const deltaA = delta(afterAReport?.score, beforeA?.score); const deltaB = delta(afterBReport?.score, beforeB?.score);
  return json({
    teamA: { id: teamA.id, name: teamA.name, sends: playersA, receives: playersB, sendsPicks: picksA, receivesPicks: picksB, before: beforeA, after: afterAReport, delta: deltaA },
    teamB: { id: teamB.id, name: teamB.name, sends: playersB, receives: playersA, sendsPicks: picksB, receivesPicks: picksA, before: beforeB, after: afterBReport, delta: deltaB },
    verdict: tradeVerdict(deltaA, deltaB),
    note: "Scores use only available Fantrax inputs. The Pride cap is anchored at $1,403.90 for 2026, rises 5% each March 1, and active contracts rise 20% each league year. IR salary is excluded; cut-player dead cap remains charged. Missing projections, contracts, salary, or penalties are not treated as zero."
  });
}

function delta(after, before) { return after == null || before == null ? null : after - before; }
function tradeVerdict(a, b) {
  if (a == null || b == null) return "Insufficient live data for a complete grade";
  if (a > 2 && b > 2) return "Mutually beneficial";
  if (a > 2 && b < -2) return "Favors Team A";
  if (b > 2 && a < -2) return "Favors Team B";
  if (Math.abs(a) <= 2 && Math.abs(b) <= 2) return "Roughly even";
  return "Mixed impact";
}

const CHAT_SYSTEM_PROMPT = "You are the GMS Locker GM Chat advisor: a cutthroat, Belichick-style fantasy football GM, not a hype man. You are given a JSON block of this manager's live Fantrax league data (roster, salaries, contracts, projections, cap room, power rankings, free-agent recommendations). Use ONLY player names, numbers, and facts present in that JSON. Never invent a player, stat, salary, contract, injury, or projection. If something is not present in the JSON, say it is unavailable instead of guessing. Never suggest submitting a trade, cut, or lineup change directly on Fantrax on the user's behalf — Fantrax stays read-only and the manager executes every move themselves. Be direct, specific, and cite the real numbers you were given.";

async function chatRoute(request, env, auth) {
  if (request.method === "GET") return chatHistory(request, env, auth);
  if (request.method !== "POST") return json({ error: "GET or POST only" }, 405);
  if (!env.AI) return json({ error: "AI advisor is not configured for this environment" }, 503);
  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim().slice(0, 2000);
  if (!message) return json({ error: "Message required" }, 400);
  const ws = await ownedLeague(env, auth, body.workspaceId);
  if (!ws) return json({ error: "Link a Fantrax league first" }, 404);
  let snapshot;
  try { snapshot = await leagueSnapshot(ws); }
  catch (error) { return json({ error: "Fantrax sync failed", detail: String(error?.message || error) }, 502); }
  const myTeam = snapshot.teams.find((team) => String(team.id) === String(ws.team_id)) || snapshot.teams.find((team) => team.name === ws.team_name) || null;
  const history = await loadChatHistory(env, ws.id);
  const messages = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    { role: "system", content: "Live league context (JSON, the only source of truth for numbers):\n" + JSON.stringify(buildChatContext(snapshot, myTeam)) },
    ...history,
    { role: "user", content: message }
  ];
  let reply;
  try {
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, max_tokens: 700 });
    reply = String(result?.response || "").trim() || "No response generated.";
  } catch (error) { return json({ error: "AI advisor failed", detail: String(error?.message || error) }, 502); }
  await saveChatTurn(env, ws.id, "user", message);
  await saveChatTurn(env, ws.id, "assistant", reply);
  return json({ reply, syncedAt: snapshot.syncedAt });
}

async function chatHistory(request, env, auth) {
  const url = new URL(request.url);
  const ws = await ownedLeague(env, auth, url.searchParams.get("workspaceId"));
  if (!ws) return json({ error: "Link a Fantrax league first" }, 404);
  return json({ messages: await loadChatHistory(env, ws.id) });
}

async function loadChatHistory(env, workspaceId) {
  const result = await env.DB.prepare("SELECT role, content FROM chat_messages WHERE user_league_id=? ORDER BY created_at DESC LIMIT 12").bind(workspaceId).all();
  return (result.results || []).reverse().map((row) => ({ role: row.role, content: row.content }));
}

async function saveChatTurn(env, workspaceId, role, content) {
  await env.DB.prepare("INSERT INTO chat_messages (id,user_league_id,role,content) VALUES (?,?,?,?)").bind(crypto.randomUUID(), workspaceId, role, content).run();
}

function buildChatContext(snapshot, myTeam) {
  return {
    leagueName: snapshot.workspace?.leagueName,
    myTeam: myTeam ? {
      name: myTeam.name,
      deadCap: myTeam.deadCap,
      players: (myTeam.players || []).map((p) => ({ name: p.name, position: p.position, nflTeam: p.nflTeam, salary: p.salary, contractYears: p.contract, age: p.age, projection: p.weeklyProjection ?? p.seasonProjection ?? p.performancePpg ?? null, volatility: p.volatility, injury: p.injury, status: p.status, rosterSlot: p.rosterSlot }))
    } : null,
    myAnalysis: snapshot.myAnalysis ? { grade: snapshot.myAnalysis.grade, score: snapshot.myAnalysis.score, verdict: snapshot.myAnalysis.verdict, summary: snapshot.myAnalysis.summary, capRoom: snapshot.myAnalysis.pillars?.capHealth?.room, deadCap: snapshot.myAnalysis.pillars?.capHealth?.deadCap } : null,
    myLineup: snapshot.myAnalysis?.lineupReport ? { total: snapshot.myAnalysis.lineupReport.total, openSlots: snapshot.myAnalysis.lineupReport.open, bench: snapshot.myAnalysis.lineupReport.bench.slice(0, 6).map((row) => ({ name: row.player?.name, score: row.score, reason: row.reason })) } : null,
    leagueRankings: (snapshot.rankings || []).slice(0, 14).map((r) => ({ team: r.teamName, grade: r.grade, score: r.score, verdict: r.verdict })),
    topFreeAgentRecommendations: (snapshot.recommendations || []).slice(0, 8).map((r) => ({ player: r.player?.name, position: r.player?.position, verdict: r.verdict, needScore: r.needScore, fit: r.fit, volatility: r.volatility, maxBlindBid: r.maxBlindBid, lineupGain: r.lineupGain })),
    warnings: snapshot.warnings
  };
}

async function currentGames(url) {
  const requested = String(url.searchParams.get("season") || new Date().getUTCFullYear()).replace(/\D/g, "");
  for (const season of [requested, String(Number(requested) + 1), String(Number(requested) - 1)]) {
    for (const type of ["1", "2"]) {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=${season}&seasontype=${type}`, { headers: requestHeaders() });
      if (!response.ok) continue;
      const board = await response.json();
      const schedule = (board.events || []).map((event) => {
        const competition = event.competitions?.[0]; if (!competition) return null;
        const home = (competition.competitors || []).find((team) => team.homeAway === "home");
        const away = (competition.competitors || []).find((team) => team.homeAway === "away");
        return { id: String(event.id), date: event.date, name: event.name || event.shortName, state: event.status?.type?.state || "pre", status: event.status?.type?.shortDetail || event.status?.type?.detail || "Scheduled", home: { abbreviation: home?.team?.abbreviation || null, name: home?.team?.displayName || null, score: home?.score ?? null }, away: { abbreviation: away?.team?.abbreviation || null, name: away?.team?.displayName || null, score: away?.score ?? null }, venue: competition.venue?.fullName || null };
      }).filter(Boolean).sort((a, b) => new Date(a.date) - new Date(b.date));
      if (schedule.length) return json({ schedule, games: [], scheduleSource: "ESPN", season: Number(season), seasonType: Number(type), syncedAt: new Date().toISOString() });
    }
  }
  return json({ schedule: [], games: [], error: "No NFL schedule found" }, 502);
}

function num(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function plain(value) { return String(value == null ? "" : value).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim(); }
