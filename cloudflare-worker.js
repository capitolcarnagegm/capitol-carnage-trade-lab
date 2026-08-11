// GM's Locker API: authoritative Fantrax data plus Cloudflare Workers AI chat.
const LEAGUE_ID = "astbqxhwmk4b6bg9";
const ALLOWED_ENDPOINTS = new Set(["getTeamRosters", "getPlayerIds", "getStandings", "getDraftPicks", "getMatchupScores", "getLeagueInfo"]);
const SEASON_PROJ = "PROJECTION_0_23l_SEASON";
const WEEKLY_PROJ = "PROJECTION_0_23l_EVENT_PROJECTED_WEEKLY";
const LAST_SEASON = "SEASON_23j_YEAR_TO_DATE";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
    if (url.pathname === "/chat") return handleChat(request, env);
    if (url.pathname === "/league-data") return handleLeagueData(request, url);
    if (url.pathname === "/news") return handleNews(request);
    return handleFantrax(request, url);
  }
};

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

function statsMessage(teamId, seasonOrProjection) {
  return { method: "getTeamRosterInfo", data: { leagueId: LEAGUE_ID, teamId, view: "STATS", seasonOrProjection } };
}

function poolMessage(seasonOrProjection) {
  return { method: "getPlayerStats", data: { leagueId: LEAGUE_ID, pageNumber: 1, maxResultsPerPage: 750, statusOrTeamFilter: "AVAILABLE", view: "STATS", seasonOrProjection, sortType: "SCORE", sortDirection: -1 } };
}

async function handleLeagueData(request, url) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const leagueId = url.searchParams.get("leagueId") || LEAGUE_ID;
  try {
    const [rosters, players, standings, picks, matchups, leagueInfo] = await Promise.all([
      fantrax("getTeamRosters", leagueId), fantrax("getPlayerIds", leagueId), fantrax("getStandings", leagueId),
      fantrax("getDraftPicks", leagueId), fantrax("getMatchupScores", leagueId), fantrax("getLeagueInfo", leagueId)
    ]);
    const teamIds = Object.keys(rosters.rosters || {});
    const teamResponses = await Promise.all(teamIds.map(async (teamId) => {
      const result = await fantraxPa(leagueId, [statsMessage(teamId, SEASON_PROJ), statsMessage(teamId, WEEKLY_PROJ), statsMessage(teamId, LAST_SEASON)]);
      const responses = result.responses || [];
      return { teamId, season: parseStatsResponse(responses[0]), weekly: parseStatsResponse(responses[1]), performance: parseStatsResponse(responses[2]) };
    }));
    const poolResult = await fantraxPa(leagueId, [poolMessage(SEASON_PROJ), poolMessage(WEEKLY_PROJ), poolMessage(LAST_SEASON)]);
    const poolResponses = poolResult.responses || [];
    const poolSeason = parseStatsResponse(poolResponses[0]);
    const poolWeekly = parseStatsResponse(poolResponses[1]);
    const poolPerformance = parseStatsResponse(poolResponses[2]);
    const teamData = {};
    for (const result of teamResponses) teamData[result.teamId] = result;
    return json({
      ok: true, source: "Fantrax live", syncedAt: new Date().toISOString(), rosters, players, standings, picks, matchups, leagueInfo,
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
    if (!response.ok) throw new Error("ESPN HTTP " + response.status);
    const data = await response.json();
    const articles = (data.articles || []).map((article) => ({
      headline: article.headline || "", description: article.description || "", published: article.published || article.lastModified || "",
      link: article.links?.web?.href || "", teams: (article.categories || []).map((category) => category.team?.abbreviation || category.description).filter(Boolean)
    }));
    return json({ source: "ESPN", articles });
  } catch (error) {
    return json({ error: "News request failed", detail: String(error?.message || error) }, 502);
  }
}

async function handleFantrax(request, url) {
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const endpoint = url.searchParams.get("endpoint") || "";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return json({ error: "Unsupported Fantrax endpoint" }, 400);
  try {
    const data = await fantrax(endpoint, url.searchParams.get("leagueId") || LEAGUE_ID);
    return json(data);
  } catch (error) {
    return json({ error: "Fantrax upstream failed", detail: String(error?.message || error) }, 502);
  }
}

async function handleChat(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!env.AI) return json({ error: "Cloudflare Workers AI is not connected to the Worker" }, 503);
  let input;
  try { input = await request.json(); } catch (_) { return json({ error: "Invalid JSON" }, 400); }
  const message = String(input.message || "").trim();
  if (!message) return json({ error: "Message is required" }, 400);
  const personality = input.personality || {};
  const system = [
    "You are GM's Locker, a conversational personal assistant and the user's fantasy-football general manager partner.",
    "Your visible personality is " + String(personality.name || "Process") + ": " + String(personality.lens || "evidence-first and direct") + ". Apply that style consistently without hiding contrary evidence.",
    "For fantasy football, use only supplied Fantrax facts. Never invent a projection, performance value, injury, salary, contract, ownership fact, or cap value.",
    "The league context contains all rosters, Fantrax season and weekly projections, prior performance, injuries, picks, matchups, standings, free agents, and Fantrax dead-cap penalties.",
    "Explain recommendations with player names and specific supplied numbers. If data is unavailable, say so.",
    "Help with ordinary conversation too. You have no live web or maps access, so flag time-sensitive details that should be verified.",
    "Learn stable preferences from the conversation. Return only valid JSON with two strings: reply and preferences."
  ].join(" ");
  const history = Array.isArray(input.history) ? input.history.slice(-40) : [];
  const messages = [{ role: "system", content: system }].concat(history.map((entry) => ({ role: entry.role === "ai" ? "assistant" : "user", content: String(entry.text || "").slice(0, 2500) })));
  const context = { league: input.league || {}, team: input.team || {}, leagueRosters: input.leagueRosters || [], freeAgents: input.freeAgents || [], draftPicks: input.draftPicks || [], standings: input.standings || [], matchups: input.matchups || {}, deadCap: input.deadCap || {}, savedPreferences: String(input.preferences || "").slice(0, 12000) };
  messages.push({ role: "user", content: message + "\n\nCurrent live league context:\n" + JSON.stringify(context).slice(0, 90000) });
  try {
    const data = await env.AI.run("@cf/meta/llama-3.2-3b-instruct", { messages, temperature: 0.35, max_tokens: 2400 });
    const raw = String(data?.response || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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
    const reply = String(parsed.reply || "").trim();
    if (!reply) return json({ error: "Llama returned no answer" }, 502);
    return json({ reply, preferences: String(parsed.preferences || input.preferences || "").slice(0, 12000) });
  } catch (error) {
    return json({ error: "Workers AI request failed", detail: String(error?.message || error) }, 502);
  }
}

function corsHeaders() {
  return new Headers({ "Access-Control-Allow-Origin": "https://gmslocker.com", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Accept, Content-Type", Vary: "Origin", "X-Content-Type-Options": "nosniff" });
}

function json(value, status = 200) {
  const headers = corsHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(value), { status, headers });
}
