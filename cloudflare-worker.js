// GM's Locker API: authoritative Fantrax data plus Cloudflare Workers AI chat.
const LEGACY_LEAGUE_ID = "astbqxhwmk4b6bg9";
const ALLOWED_ENDPOINTS = new Set(["getTeamRosters", "getPlayerIds", "getStandings", "getDraftPicks", "getMatchupScores", "getLeagueInfo"]);
const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";
const LAST_SEASON = "SEASON_23j_YEAR_TO_DATE";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/auth/request-code") return requestLoginCode(request, env);
    if (url.pathname === "/auth/verify-code") return verifyLoginCode(request, env);
    const auth = await authenticatedUser(request, env);
    if (url.pathname === "/auth/me") return auth ? json({ user: auth.user }) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/auth/logout") return auth ? logout(request, env, auth) : json({ ok: true });
    if (url.pathname === "/account/leagues") return auth ? handleAccountLeagues(request, env, auth) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/account/league") return auth ? handleAccountLeague(request, env, auth) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/account/league/settings") return auth ? handleLeagueSettings(request, env, auth) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/account/conversation") return auth ? handleConversation(request, env, auth) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/account/league/inspect") return auth ? inspectLeague(request, env) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/chat") return auth ? handleChat(request, env, auth) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/league-data") return auth ? handleLeagueData(request, url, auth) : json({ error: "Sign in required" }, 401);
    if (url.pathname === "/current-games") return handleCurrentGames(request, url);
    if (url.pathname === "/news") return handleNews(request);
    if (url.pathname === "/waiver-context") return auth ? handleWaiverContext(request, url) : json({ error: "Sign in required" }, 401);
    return auth ? handleFantrax(request, url, auth) : json({ error: "Sign in required" }, 401);
  }
};

function normalizeEmail(value) { return String(value || "").trim().toLowerCase().slice(0, 254); }
function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function bytesToHex(bytes) { return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function sha256(value) { return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)))); }
function randomToken(bytes = 32) { const value = new Uint8Array(bytes); crypto.getRandomValues(value); return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function bearerToken(request) { const match = String(request.headers.get("Authorization") || "").match(/^Bearer\s+([A-Za-z0-9_-]{32,})$/); return match ? match[1] : ""; }

async function readJson(request) { try { return await request.json(); } catch (_) { return null; } }
async function requestLoginCode(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.DB) return json({ error: "Account database is not configured" }, 503);
  if (!env.RESEND_API_KEY) return json({ error: "Account email service is not configured" }, 503);
  const body = await readJson(request); const email = normalizeEmail(body?.email);
  if (!validEmail(email)) return json({ error: "Enter a valid email address" }, 400);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS total FROM login_codes WHERE email=? AND created_at>datetime('now','-10 minutes')").bind(email).first();
  if (Number(recent?.total || 0) >= 5) return json({ error: "Too many codes requested. Wait 10 minutes and try again." }, 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const id = crypto.randomUUID(); const codeHash = await sha256(id + ":" + code);
  await env.DB.prepare("INSERT INTO login_codes (id,email,code_hash,expires_at) VALUES (?,?,?,datetime('now','+10 minutes'))").bind(id, email, codeHash).run();
  const sent = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + env.RESEND_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.AUTH_FROM_EMAIL || "GMS Locker <login@gmslocker.com>", to: [email], subject: "Your GMS Locker login code", text: "Your GMS Locker code is " + code + ". It expires in 10 minutes. If you did not request it, ignore this email." }) });
  if (!sent.ok) { await env.DB.prepare("DELETE FROM login_codes WHERE id=?").bind(id).run(); return json({ error: "Login email could not be sent" }, 502); }
  return json({ ok: true, challengeId: id, expiresInSeconds: 600 });
}

async function verifyLoginCode(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readJson(request); const email = normalizeEmail(body?.email); const id = String(body?.challengeId || ""); const code = String(body?.code || "").replace(/\D/g, "").slice(0, 6);
  const row = id && env.DB ? await env.DB.prepare("SELECT id,email,code_hash,expires_at,attempts,consumed_at FROM login_codes WHERE id=? AND email=?").bind(id, email).first() : null;
  if (!row || row.consumed_at || new Date(row.expires_at) <= new Date() || row.attempts >= 5) return json({ error: "Code expired or unavailable" }, 401);
  const expected = await sha256(id + ":" + code);
  if (expected !== row.code_hash) { await env.DB.prepare("UPDATE login_codes SET attempts=attempts+1 WHERE id=?").bind(id).run(); return json({ error: "Code not recognized" }, 401); }
  let user = await env.DB.prepare("SELECT id,email,display_name FROM users WHERE email=?").bind(email).first();
  if (!user) { user = { id: crypto.randomUUID(), email, display_name: "" }; await env.DB.prepare("INSERT INTO users (id,email) VALUES (?,?)").bind(user.id, email).run(); }
  const token = randomToken(); const tokenHash = await sha256(token);
  await env.DB.batch([env.DB.prepare("UPDATE login_codes SET consumed_at=CURRENT_TIMESTAMP WHERE id=?").bind(id), env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.id), env.DB.prepare("INSERT INTO user_sessions (token_hash,user_id,expires_at) VALUES (?,?,datetime('now','+30 days'))").bind(tokenHash, user.id)]);
  return json({ token, user: { id: user.id, email: user.email, displayName: user.display_name || "" } });
}

async function authenticatedUser(request, env) {
  const token = bearerToken(request); if (!token || !env.DB) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare("SELECT s.token_hash,s.user_id,u.email,u.display_name FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP").bind(tokenHash).first();
  return row ? { tokenHash, env, user: { id: row.user_id, email: row.email, displayName: row.display_name || "" } } : null;
}
async function logout(request, env, auth) { if (request.method !== "POST") return json({ error: "Method not allowed" }, 405); await env.DB.prepare("UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?").bind(auth.tokenHash).run(); return json({ ok: true }); }
function extractLeagueId(value) { const raw = String(value || "").trim(); const query = raw.match(/[?&]leagueId=([A-Za-z0-9]+)/i); return (query ? query[1] : raw).replace(/[^A-Za-z0-9]/g, "").slice(0, 64); }
async function inspectLeague(request, env) { const body = await readJson(request); const leagueId = extractLeagueId(body?.league); if (!leagueId) return json({ error: "Enter a Fantrax league ID or link" }, 400); try { const [rosters, info] = await Promise.all([fantrax("getTeamRosters", leagueId), fantrax("getLeagueInfo", leagueId)]); return json({ leagueId, leagueName: info?.leagueName || info?.name || "Fantrax League", teams: Object.keys(rosters?.rosters || {}).map((id) => ({ id, name: rosters.rosters[id].teamName || id })) }); } catch (error) { return json({ error: "Fantrax league could not be read", detail: String(error?.message || error) }, 400); } }
async function handleAccountLeagues(request, env, auth) { if (request.method !== "GET") return json({ error: "Method not allowed" }, 405); const result = await env.DB.prepare("SELECT id,fantrax_league_id AS leagueId,league_name AS leagueName,team_id AS teamId,team_name AS teamName,settings_json AS settings FROM user_leagues WHERE user_id=? ORDER BY updated_at DESC").bind(auth.user.id).all(); return json({ leagues: (result.results || []).map((row) => ({ ...row, settings: JSON.parse(row.settings || "{}") })) }); }
async function handleAccountLeague(request, env, auth) {
  if (request.method === "POST") { const body = await readJson(request); const leagueId = extractLeagueId(body?.leagueId); const teamId = String(body?.teamId || "").slice(0, 80); const teamName = String(body?.teamName || "").trim().slice(0, 120); const leagueName = String(body?.leagueName || "Fantrax League").trim().slice(0, 120); if (!leagueId || !teamId || !teamName) return json({ error: "League and team are required" }, 400); const roster = await fantrax("getTeamRosters", leagueId); if (!roster?.rosters?.[teamId] || String(roster.rosters[teamId].teamName || teamId) !== teamName) return json({ error: "That team does not belong to this league" }, 400); const existing = await env.DB.prepare("SELECT id FROM user_leagues WHERE user_id=? AND fantrax_league_id=?").bind(auth.user.id, leagueId).first(); const id = existing?.id || crypto.randomUUID(); await env.DB.prepare("INSERT INTO user_leagues (id,user_id,fantrax_league_id,league_name,team_id,team_name) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,fantrax_league_id) DO UPDATE SET league_name=excluded.league_name,team_id=excluded.team_id,team_name=excluded.team_name,updated_at=CURRENT_TIMESTAMP").bind(id, auth.user.id, leagueId, leagueName, teamId, teamName).run(); return json({ league: { id, leagueId, leagueName, teamId, teamName } }); }
  if (request.method === "DELETE") { const body = await readJson(request); await env.DB.prepare("DELETE FROM user_leagues WHERE id=? AND user_id=?").bind(String(body?.id || ""), auth.user.id).run(); return json({ ok: true }); }
  return json({ error: "Method not allowed" }, 405);
}
async function handleLeagueSettings(request, env, auth) { if (request.method !== "POST") return json({ error: "Method not allowed" }, 405); const body = await readJson(request); const workspace = await ownedLeague(env, auth, String(body?.workspaceId || "")); if (!workspace) return json({ error: "League not found in your account" }, 404); const settings = JSON.stringify(body?.settings && typeof body.settings === "object" ? body.settings : {}).slice(0, 30000); await env.DB.prepare("UPDATE user_leagues SET settings_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(settings, workspace.id, auth.user.id).run(); return json({ ok: true }); }
async function handleConversation(request, env, auth) { const url = new URL(request.url); const body = request.method === "POST" ? await readJson(request) : null; const workspaceId = String(body?.workspaceId || url.searchParams.get("workspaceId") || ""); const mode = String(body?.mode || url.searchParams.get("mode") || "") === "war-room" ? "war-room" : "full"; const workspace = await ownedLeague(env, auth, workspaceId); if (!workspace) return json({ error: "League not found in your account" }, 404); if (request.method === "GET") { const row = await env.DB.prepare("SELECT history_json AS history,preferences FROM user_conversations WHERE user_id=? AND user_league_id=? AND mode=?").bind(auth.user.id, workspaceId, mode).first(); return json({ history: row ? JSON.parse(row.history || "[]") : [], preferences: row?.preferences || "" }); } if (request.method === "POST") { const history = JSON.stringify((Array.isArray(body?.history) ? body.history : []).slice(-40)).slice(0, 100000); const preferences = String(body?.preferences || "").slice(0, 12000); const id = crypto.randomUUID(); await env.DB.prepare("INSERT INTO user_conversations (id,user_id,user_league_id,mode,history_json,preferences) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,user_league_id,mode) DO UPDATE SET history_json=excluded.history_json,preferences=excluded.preferences,updated_at=CURRENT_TIMESTAMP").bind(id, auth.user.id, workspaceId, mode, history, preferences).run(); return json({ ok: true }); } return json({ error: "Method not allowed" }, 405); }
async function ownedLeague(env, auth, id) { return id ? env.DB.prepare("SELECT * FROM user_leagues WHERE id=? AND user_id=?").bind(id, auth.user.id).first() : null; }

function normalizedPlayerName(value) { return String(value || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]/g, ""); }
function playerSlug(value) { return String(value || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

async function handleWaiverContext(request, url) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const name = String(url.searchParams.get("name") || "").trim().slice(0, 80);
  const team = String(url.searchParams.get("team") || "").trim().toUpperCase().slice(0, 4);
  if (!name) return json({ error: "Player name is required" }, 400);
  try {
    const [espnResponse, nflResponse] = await Promise.all([
      fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100", { headers: { Accept: "application/json", "User-Agent": "GMSLocker/1.6" }, cf: { cacheTtl: 300, cacheEverything: true } }),
      fetch("https://www.nfl.com/players/" + encodeURIComponent(playerSlug(name)) + "/", { headers: { Accept: "text/html", "User-Agent": "GMSLocker/1.6" }, cf: { cacheTtl: 3600, cacheEverything: true } })
    ]);
    const espnData = espnResponse.ok ? await espnResponse.json() : { articles: [] };
    const needle = normalizedPlayerName(name);
    const espn = (espnData.articles || []).filter((article) => {
      const text = normalizedPlayerName((article.headline || "") + " " + (article.description || ""));
      const teams = (article.categories || []).map((category) => category.team?.abbreviation || "");
      return text.includes(needle) || (team && teams.includes(team));
    }).slice(0, 3).map((article) => ({ source: "ESPN", headline: plain(article.headline), summary: plain(article.description), published: article.published || article.lastModified || "", link: article.links?.web?.href || "" }));
    let nfl = null;
    if (nflResponse.ok) {
      const html = await nflResponse.text();
      const title = plain((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) || [])[1]);
      const summary = plain((html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i) || [])[1]);
      if (title && normalizedPlayerName(title).includes(needle)) nfl = { source: "NFL.com", headline: title, summary, link: "https://www.nfl.com/players/" + playerSlug(name) + "/" };
    }
    return json({ source: ["Fantrax", "ESPN", "NFL.com"], player: name, espn, nfl, syncedAt: new Date().toISOString() });
  } catch (error) { return json({ error: "Player context request failed", detail: String(error?.message || error) }, 502); }
}

async function handleCurrentGames(request, url) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const season = String(url.searchParams.get("season") || new Date().getUTCFullYear()).replace(/[^0-9]/g, "").slice(0, 4);
  const seasonType = url.searchParams.get("seasonType") === "1" ? "1" : "2";
  const scoreboardUrl = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=" + season + "&seasontype=" + seasonType;
  try {
    const scoreboardResponse = await fetch(scoreboardUrl, { headers: { Accept: "application/json", "User-Agent": "GMSLocker/1.6" }, cf: { cacheTtl: 20, cacheEverything: true } });
    if (!scoreboardResponse.ok) throw new Error("NFL scoreboard HTTP " + scoreboardResponse.status);
    const scoreboard = await scoreboardResponse.json();
    const events = (scoreboard.events || []).filter((event) => event.status?.type?.state !== "pre").slice(0, 16);
    const games = await Promise.all(events.map(async (event) => {
      const summaryResponse = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=" + encodeURIComponent(event.id), { headers: { Accept: "application/json", "User-Agent": "GMSLocker/1.6" }, cf: { cacheTtl: 20, cacheEverything: true } });
      if (!summaryResponse.ok) return { id: event.id, name: event.name || "NFL game", status: event.status?.type?.detail || "", players: [] };
      const summary = await summaryResponse.json();
      const players = [];
      for (const team of summary.boxscore?.players || []) {
        for (const category of team.statistics || []) {
          const labels = category.labels || category.names || [];
          for (const athleteRow of category.athletes || []) {
            const athlete = athleteRow.athlete || {};
            const stats = {};
            (athleteRow.stats || []).forEach((value, index) => { if (labels[index]) stats[labels[index]] = numberFrom(value); });
            players.push({ id: String(athlete.id || ""), name: athlete.displayName || athlete.fullName || "Unknown", team: team.team?.abbreviation || athlete.team?.abbreviation || "", position: athlete.position?.abbreviation || "", category: category.name || category.displayName || "", stats });
          }
        }
      }
      return { id: event.id, name: event.name || "NFL game", date: event.date || "", status: event.status?.type?.detail || "", state: event.status?.type?.state || "", seasonType: summary.header?.season?.type || Number(seasonType), players };
    }));
    const headers = corsHeaders();
    headers.set("Content-Type", "application/json; charset=utf-8");
    headers.set("Cache-Control", "public, max-age=15");
    return new Response(JSON.stringify({ source: "NFL live box scores", season: Number(season), seasonType: Number(seasonType), games, syncedAt: new Date().toISOString() }), { headers });
  } catch (error) {
    return json({ error: "Current game feed failed", detail: String(error?.message || error) }, 502);
  }
}

async function fantrax(endpoint, leagueId, extra = {}) {
  const upstream = new URL("https://www.fantrax.com/fxea/general/" + endpoint);
  if (endpoint === "getPlayerIds") upstream.searchParams.set("sport", "NFL");
  else upstream.searchParams.set("leagueId", leagueId);
  for (const [key, value] of Object.entries(extra)) upstream.searchParams.set(key, value);
  const response = await fetch(upstream.toString(), { headers: { Accept: "application/json", "User-Agent": "GMSLocker/1.6" } });
  if (!response.ok) throw new Error(endpoint + " HTTP " + response.status);
  return response.json();
}

async function fantraxPa(leagueId, msgs) {
  const response = await fetch("https://www.fantrax.com/fxpa/req?leagueId=" + encodeURIComponent(leagueId), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "GMSLocker/1.6" },
    body: JSON.stringify({ msgs })
  });
  if (!response.ok) throw new Error("Fantrax league data HTTP " + response.status);
  return response.json();
}

function numberFrom(value) {
  const n = Number(String(value == null ? "" : value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function plain(value) {
  return String(value == null ? "" : value).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
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
    selection: data.displayedSeasonOrProjection?.code || data.displayedSelections?.displayedSeasonOrProjection?.code || "",
    capPenaltyData: data.capHitPenaltyData || null,
    salaryInfo: data.miscData?.salaryInfo?.info || []
  };
}

function statsMessage(leagueId, teamId, seasonOrProjection) {
  return { method: "getTeamRosterInfo", data: { leagueId, teamId, view: "STATS", seasonOrProjection } };
}

function poolMessage(leagueId, seasonOrProjection) {
  return { method: "getPlayerStats", data: { leagueId, pageNumber: 1, maxResultsPerPage: 750, statusOrTeamFilter: "AVAILABLE", view: "STATS", seasonOrProjection, sortType: "SCORE", sortDirection: -1 } };
}

async function handleLeagueData(request, url, auth) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const workspace = await ownedLeague(auth.env || null, auth, url.searchParams.get("workspaceId"));
  if (!workspace) return json({ error: "League not found in your account" }, 404);
  const leagueId = workspace.fantrax_league_id;
  try {
    const [rosters, players, standings, picks, matchups, leagueInfo] = await Promise.all([
      fantrax("getTeamRosters", leagueId), fantrax("getPlayerIds", leagueId), fantrax("getStandings", leagueId),
      fantrax("getDraftPicks", leagueId), fantrax("getMatchupScores", leagueId), fantrax("getLeagueInfo", leagueId)
    ]);
    const teamIds = Object.keys(rosters.rosters || {});
    const teamResponses = await Promise.all(teamIds.map(async (teamId) => {
      const result = await fantraxPa(leagueId, [statsMessage(leagueId, teamId, SEASON_PROJ), statsMessage(leagueId, teamId, WEEKLY_PROJ), statsMessage(leagueId, teamId, LAST_SEASON)]);
      const responses = result.responses || [];
      return { teamId, season: parseStatsResponse(responses[0]), weekly: parseStatsResponse(responses[1]), performance: parseStatsResponse(responses[2]) };
    }));
    const poolResult = await fantraxPa(leagueId, [poolMessage(leagueId, SEASON_PROJ), poolMessage(leagueId, WEEKLY_PROJ), poolMessage(leagueId, LAST_SEASON)]);
    const poolResponses = poolResult.responses || [];
    const poolSeason = parseStatsResponse(poolResponses[0]);
    const poolWeekly = parseStatsResponse(poolResponses[1]);
    const poolPerformance = parseStatsResponse(poolResponses[2]);
    const teamData = {};
    for (const result of teamResponses) teamData[result.teamId] = result;
    return json({
      ok: true, source: "Fantrax live", syncedAt: new Date().toISOString(), workspace: { id: workspace.id, leagueId, leagueName: workspace.league_name, teamId: workspace.team_id, teamName: workspace.team_name }, rosters, players, standings, picks, matchups, leagueInfo,
      teamData,
      freeAgents: {
        season: poolSeason.players,
        // Fantrax labels this pool view "projected season" but its FP/G column is the weekly expectation.
        weekly: poolWeekly.players,
        // Do not mislabel a normalized projection response as actual prior performance.
        performance: poolPerformance.selection === LAST_SEASON ? poolPerformance.players : {}
      },
      projectionMeta: { season: SEASON_PROJ, weekly: WEEKLY_PROJ, performance: LAST_SEASON, note: "All displayed projections and performance are direct Fantrax values." }
    });
  } catch (error) {
    return json({ error: "Fantrax live-data sync failed", detail: String(error?.message || error) }, 502);
  }
}

async function handleNews(request) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  try {
    const response = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=30", { headers: { Accept: "application/json", "User-Agent": "GMSLocker/1.6" } });
    if (response.ok) {
      const data = await response.json();
      const articles = (data.articles || []).map((article) => ({
        headline: article.headline || "", description: article.description || "", published: article.published || article.lastModified || "",
        link: article.links?.web?.href || "", teams: (article.categories || []).map((category) => category.team?.abbreviation || category.description).filter(Boolean)
      }));
      return json({ source: "ESPN", articles, syncedAt: new Date().toISOString() });
    }

    // ESPN sometimes blocks its JSON endpoint from edge networks. Its official NFL RSS feed is the reliable fallback.
    const rssResponse = await fetch("https://www.espn.com/espn/rss/nfl/news", { headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "Mozilla/5.0 GMSLocker/1.6" } });
    if (!rssResponse.ok) throw new Error("ESPN JSON HTTP " + response.status + "; RSS HTTP " + rssResponse.status);
    const xml = await rssResponse.text();
    const decode = (value) => String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
    const articles = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)).slice(0, 30).map((match) => {
      const item = match[1];
      const field = (name) => decode((item.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)<\\/" + name + ">", "i")) || [])[1]);
      return { headline: field("title"), description: plain(field("description")), published: field("pubDate"), link: field("link"), teams: [] };
    }).filter((article) => article.headline);
    return json({ source: "ESPN RSS", articles, syncedAt: new Date().toISOString() });
  } catch (error) {
    return json({ error: "News request failed", detail: String(error?.message || error) }, 502);
  }
}

async function handleFantrax(request, url, auth) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const endpoint = url.searchParams.get("endpoint") || "";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return json({ error: "Unsupported Fantrax endpoint" }, 400);
  try {
    const workspace = await ownedLeague(auth.env || null, auth, url.searchParams.get("workspaceId"));
    if (!workspace) return json({ error: "League not found in your account" }, 404);
    const data = await fantrax(endpoint, workspace.fantrax_league_id);
    return json(data);
  } catch (error) {
    return json({ error: "Fantrax upstream failed", detail: String(error?.message || error) }, 502);
  }
}

async function handleChat(request, env, auth) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.AI) return json({ error: "Cloudflare Workers AI is not connected to the Worker" }, 503);
  let input;
  try { input = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const workspace = await ownedLeague(env, auth, String(input.workspaceId || ""));
  if (!workspace) return json({ error: "League not found in your account" }, 404);
  const message = String(input.message || "").trim();
  if (!message) return json({ error: "Message is required" }, 400);
  const personality = input.personality || {};
  const mode = input.mode === "war-room" ? "war-room" : "full";
  const system = [
    "You are GM's Locker, a conversational personal assistant and the user's fantasy-football general manager partner.",
    "Your visible personality is " + String(personality.name || "Process") + ": " + String(personality.lens || "evidence-first and direct") + ". Apply that style consistently without hiding contrary evidence.",
    "For fantasy football, use only supplied Fantrax facts. Never invent a projection, performance value, injury, salary, contract, ownership fact, or cap value.",
    "The league context contains all rosters, Fantrax season and weekly projections, prior performance, injuries, picks, matchups, standings, free agents, and Fantrax dead-cap penalties.",
    "Every team evaluation must analyze the entire roster, including starters, active depth, Taxi, IR/unavailable, injuries, age, salary value, projections, prior performance, contracts, and picks when supplied. Only a current-week Game Day or matchup question may compare best legal projected starters versus best legal projected starters.",
    "Explain every strength, weakness, recommendation, and verdict with the specific supplied facts that caused it. If data is unavailable, say so.",
    "Whenever you recommend adding, dropping, starting, sitting, or trading for a player, use that player's exact name from the supplied context. Never use placeholders such as WR1, WR2, Player A, or an unnamed position label.",
    "Never invent probability percentages or confidence scores. Only state a number when that exact value is present in the supplied context, and identify what the number measures.",
    "Answer the user's question immediately in this response. Never say 'let us start', 'we need to analyze', 'to evaluate', or tell the user what information should be examined when that information is already in the supplied context.",
    "A request such as 'do that', 'yes', 'continue', or 'give me a real answer' refers to the most recent unanswered request in conversation history. Complete that request now rather than restating it.",
    "For a best-roster or best-lineup question, lead with a direct yes/no verdict, compare the current lineup with the optimized legal lineup, name every recommended starter change, then cover depth, Taxi, unavailable/injured players, age, salary/value, prior performance, picks, standings/matchup, relevant free agents, and dead-cap consequences using the supplied facts.",
    "Do not reuse canned conclusions or repetitive wording. Make each explanation original to the exact player, team, transaction, and current evidence; vary both the facts emphasized and the sentence structure while preserving accuracy.",
    mode === "war-room" ? "This is the focused War Room discussion. Answer only about trades, roster moves, lineup choices, waivers, cap decisions, opponent strategy, and concrete ways to improve the user's team. Give a clear recommended action and cite the exact league facts behind it." : "This is the full GM Chat. Help with the league, the roster, and ordinary conversation. You have no live web or maps access, so flag time-sensitive details that should be verified.",
    "You are the only AI answering this request. Use the complete supplied league context and do not claim that Grok, ChatGPT, Claude, or any other paid provider participated.",
    "Learn only genuinely stable user preferences from the conversation. Instructions for the current analysis are not preferences. Return only valid JSON with two strings: reply and preferences. The reply must contain the completed user-facing answer, never JSON, a prompt, instructions, a plan, or a preferences object."
  ].join(" ");
  const history = Array.isArray(input.history) ? input.history.slice(-40) : [];
  const messages = [{ role: "system", content: system }].concat(history.map((entry) => ({ role: entry.role === "ai" ? "assistant" : "user", content: String(entry.text || "").slice(0, 2500) })));
  const context = { mode, evaluationPolicy: input.evaluationPolicy || {}, league: input.league || {}, leagueInfo: input.leagueInfo || {}, team: input.team || {}, leagueRosters: input.leagueRosters || [], freeAgents: input.freeAgents || [], draftPicks: input.draftPicks || [], standings: input.standings || [], matchups: input.matchups || {}, deadCap: input.deadCap || {}, savedPreferences: String(input.preferences || "").slice(0, 12000) };
  messages.push({ role: "user", content: message + "\n\nCurrent live league context:\n" + JSON.stringify(context).slice(0, 90000) });
  const parseModelAnswer = (response) => {
    const raw = String(response || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
      const replyMatch = raw.match(/(?:^|\n)\s*reply\s*=\s*"([\s\S]*?)"\s*(?:\n|$)/i);
      const preferencesMatch = raw.match(/(?:^|\n)\s*preferences\s*=\s*"([\s\S]*?)"\s*(?:\n|$)/i);
      const preferencesLine = raw.match(/(?:^|\n)\s*preferences\s*:\s*([^\n]*)/i);
      const clean = raw.replace(/(?:^|\n)\s*preferences\s*:\s*[^\n]*/i, "").trim();
      parsed = {
        reply: replyMatch ? replyMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') : clean,
        preferences: preferencesMatch ? preferencesMatch[1] : preferencesLine ? preferencesLine[1].trim() : String(input.preferences || "")
      };
    }
    let reply = String(parsed.reply || "").trim();
    // Some small-model responses put a second JSON object inside `reply`.
    if (/^\s*\{[\s\S]*\}\s*$/.test(reply)) {
      try {
        const nested = JSON.parse(reply);
        if (nested && typeof nested.reply === "string") reply = nested.reply.trim();
        else if (nested && Object.prototype.hasOwnProperty.call(nested, "preferences")) reply = "";
      } catch (_) {}
    }
    return { reply, preferences: String(parsed.preferences || input.preferences || "").slice(0, 12000) };
  };
  const isNonAnswer = (reply) => {
    const text = String(reply || "").trim();
    if (!text || /^\s*\{\s*["']?preferences["']?\s*:/i.test(text)) return true;
    if (/\b(?:QB|RB|WR|TE|DL|LB|DB|IDP|Player|Free Agent)\s*(?:#?\d+|[A-Z])\b/i.test(text)) return true;
    if (/^(to (?:evaluate|analyze|assess)|we (?:need to|will|should)|let(?:'s| us) (?:start|analyz|examin))/i.test(text)) return true;
    return /(?:provide|give) a clear recommended action and cite the exact league facts/i.test(text);
  };
  try {
    let data = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages, temperature: 0.25, max_tokens: 2400 });
    let answer = parseModelAnswer(data?.response);
    if (isNonAnswer(answer.reply)) {
      const retryMessages = messages.concat([
        { role: "assistant", content: String(data?.response || "").slice(0, 3000) },
        { role: "user", content: "That was not an answer. Complete my actual request now using the supplied live facts. Lead with the verdict and concrete roster or lineup changes. Every recommended add, drop, start, sit, or trade target must use an exact player name from the context. Do not use placeholders such as WR1 or invent percentages. Do not repeat my instructions, describe what you need to analyze, return preferences, or output JSON inside the reply." }
      ]);
      data = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages: retryMessages, temperature: 0.2, max_tokens: 2400 });
      answer = parseModelAnswer(data?.response);
    }
    if (isNonAnswer(answer.reply)) return json({ error: "GM did not produce a factual answer. Please retry." }, 502);
    return json(answer);
  } catch (error) {
    return json({ error: "Workers AI request failed", detail: String(error?.message || error) }, 502);
  }
}

function corsHeaders() {
  return new Headers({ "Access-Control-Allow-Origin": "https://gmslocker.com", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization", Vary: "Origin", "X-Content-Type-Options": "nosniff" });
}

function json(value, status = 200) {
  const headers = corsHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}
