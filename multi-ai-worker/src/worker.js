const ALLOWED_ORIGINS = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com",
  "https://capitolcarnagegm.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);

const ALLOWED_PROVIDERS = new Set(["gemini", "llama"]);
const MAX_REQUEST_BYTES = 384 * 1024;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 12000;
const MAX_SYSTEM_CHARS = 90000;
const MAX_OUTPUT_TOKENS = 1800;
const SESSION_DAYS = 30;
const GEMINI_REQUESTS_PER_DAY = 45;
const LLAMA_NEURONS_PER_DAY = 7500;
const LLAMA_REQUESTS_PER_DAY = 30;

const DEFAULT_MODELS = {
  gemini: "gemini-3.5-flash-lite",
  llama: "@cf/meta/llama-4-scout-17b-16e-instruct"
};

const FANTRAX_ENDPOINTS = {
  league: { endpoint: "getLeagueInfo", league: true },
  rosters: { endpoint: "getTeamRosters", league: true },
  standings: { endpoint: "getStandings", league: true },
  matchups: { endpoint: "getMatchupScores", league: true },
  draftPicks: { endpoint: "getDraftPicks", league: true },
  draftResults: { endpoint: "getDraftResults", league: true },
  players: { endpoint: "getPlayerIds", params: { sport: "NFL" } }
};

const SPORTS_FEEDS = {
  scores: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
  news: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=30"
};

const GM_SYSTEM_PROMPT = `You are GM's Locker, an elite NFL dynasty franchise operating system.
Your job is to maximize championship equity and long-term asset value, not to agree with the user.
League assumptions supplied in context are authoritative. Never invent roster ownership, salary, contract, draft-pick ownership, scoring rules, projections, or transaction facts.

Operating doctrine:
1. Think like an all-time great football executive and run the franchise with Moneyball discipline.
2. Every proposed move must clear a B+ minimum grade.
3. Every move must pass the four-question value test:
   A. Does this improve championship probability now or create a clearly superior future path?
   B. Are we buying below intrinsic/market value or selling above it?
   C. What is the opportunity cost, including cap, roster spot, picks, replacement value, and future flexibility?
   D. Is there a materially better alternative available or likely to become available?
4. Push back hard on weak assumptions, name uncertainty, and distinguish verified facts from user beliefs/model inference.
5. In superflex, TE premium, IDP/sack-premium formats, account for positional scarcity and scoring-specific replacement value.
6. Prefer current verified NFL information when current-news context is supplied. Never pretend stale model knowledge is current.
7. Give a verdict, grade, reasoning, major risks, and the best alternative when evaluating a move.
8. Never execute a roster-changing action merely because the user asks in chat. Return a proposed action object for the application to validate and confirm.

Truth labels:
- VERIFIED: sourced league/database fact.
- CURRENT: recent external information supplied in context.
- USER THESIS: user's opinion or forecast.
- MODEL INFERENCE: your analytical conclusion.
Keep these categories separate when they matter.`;

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...cors(origin)
    }
  });
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireDatabase(env) {
  if (!env.DB) throw httpError("Private storage is not configured", 503);
  return env.DB;
}

async function readJsonBody(request) {
  if (!request.body) throw httpError("A JSON request body is required", 400);

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw httpError(`Request body must be ${MAX_REQUEST_BYTES} bytes or smaller`, 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  try {
    return JSON.parse(text);
  } catch {
    throw httpError("Request body must be valid JSON", 400);
  }
}

async function readBoundedResponseText(response, maximumBytes) {
  const declaredLength = Number.parseInt(response.headers.get("Content-Length") || "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("response too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("response too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function cleanMessages(messages = []) {
  return messages
    .filter(message => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    .slice(-MAX_MESSAGES)
    .map(message => ({ role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
}

function buildSystem(context, memory) {
  const blocks = [GM_SYSTEM_PROMPT];
  if (context) {
    blocks.push(`\nCURRENT LEAGUE CONTEXT (treat structured database fields as authoritative):\n${JSON.stringify(context).slice(0, 70000)}`);
  }
  if (memory) {
    blocks.push(`\nPERSISTENT GM MEMORY (may contain user beliefs; preserve truth labels):\n${JSON.stringify(memory).slice(0, 18000)}`);
  }
  return blocks.join("\n").slice(0, MAX_SYSTEM_CHARS);
}

function publicGeminiContext(context) {
  return {
    asOf: context?.asOf || new Date().toISOString(),
    privacyBoundary: "No private league database, roster ownership, contracts, salaries, team identity, transactions, saved memory, or draft-pick ownership is included.",
    nflLive: context?.nflLive || null
  };
}

function transcript(messages) {
  return messages.map(message => `${message.role === "assistant" ? "ASSISTANT" : "USER"}:\n${message.content}`).join("\n\n");
}

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function clampPositiveInt(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function estimateLlamaNeurons(inputTokens, outputTokens) {
  // The configured safety ceiling is below Cloudflare's 10,000-neuron free daily allocation.
  return Math.ceil((inputTokens * 0.02455) + (outputTokens * 0.07727));
}

async function reserveDailyBudget(db, provider, units, requestCap, unitCap) {
  const row = await db.prepare(`
    INSERT INTO ai_daily_usage (usage_day, provider, request_count, reserved_units, updated_at)
    VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(usage_day, provider) DO UPDATE SET
      request_count = request_count + 1,
      reserved_units = reserved_units + excluded.reserved_units,
      updated_at = CURRENT_TIMESTAMP
    WHERE ai_daily_usage.request_count + 1 <= ?
      AND ai_daily_usage.reserved_units + excluded.reserved_units <= ?
    RETURNING request_count, reserved_units
  `).bind(utcDay(), provider, units, requestCap, unitCap).first();

  if (!row) {
    throw httpError(`${provider === "gemini" ? "Gemini" : "Cloudflare Llama"} daily safety ceiling reached. Try again after 00:00 UTC.`, 429);
  }
  return row;
}

async function recordUsage(db, provider, usage = {}) {
  const inputTokens = Number(usage.total_input_tokens ?? usage.prompt_tokens ?? 0) || 0;
  const outputTokens = Number(usage.total_output_tokens ?? usage.completion_tokens ?? 0) || 0;
  await db.prepare(`
    UPDATE ai_daily_usage
    SET input_tokens = input_tokens + ?, output_tokens = output_tokens + ?, updated_at = CURRENT_TIMESTAMP
    WHERE usage_day = ? AND provider = ?
  `).bind(inputTokens, outputTokens, utcDay(), provider).run();
}

function extractGeminiText(data) {
  const output = [];
  for (const step of data?.steps || []) {
    if (step?.type !== "model_output") continue;
    for (const item of step.content || []) {
      if (item?.type === "text" && typeof item.text === "string") output.push(item.text);
    }
  }
  return output.join("\n").trim();
}

async function callGemini(env, messages, system, options = {}) {
  if (!env.GEMINI_API_KEY) throw httpError("Gemini is not configured", 503);
  const db = requireDatabase(env);
  const model = options.model || env.GEMINI_MODEL || DEFAULT_MODELS.gemini;
  const maxTokens = clampPositiveInt(options.maxTokens, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  const input = transcript(messages);
  const estimated = estimateTokens(system) + estimateTokens(input) + maxTokens;
  const dailyRequests = clampPositiveInt(env.GEMINI_DAILY_REQUEST_LIMIT, GEMINI_REQUESTS_PER_DAY, GEMINI_REQUESTS_PER_DAY);
  await reserveDailyBudget(db, "gemini", estimated, dailyRequests, 1000000000);

  let response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        system_instruction: system,
        input,
        store: false,
        generation_config: {
          max_output_tokens: maxTokens,
          thinking_level: options.thinkingLevel || "minimal"
        }
      }),
      signal: AbortSignal.timeout(55000)
    });
  } catch (error) {
    throw httpError(`Gemini connection failed: ${String(error?.message || error).slice(0, 180)}`, 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw httpError("Gemini free-tier quota is temporarily exhausted.", 429);
    throw httpError(`Gemini request failed with HTTP ${response.status}.`, 502);
  }

  const text = extractGeminiText(data);
  if (!text) throw httpError("Gemini returned no text", 502);
  await recordUsage(db, "gemini", data.usage || {});
  return { provider: "gemini", model: data.model || model, text, usage: data.usage || null };
}

async function callLlama(env, messages, system, options = {}) {
  if (!env.AI?.run) throw httpError("Cloudflare Llama is not configured", 503);
  const db = requireDatabase(env);
  const model = options.model || env.LLAMA_MODEL || DEFAULT_MODELS.llama;
  const maxTokens = clampPositiveInt(options.maxTokens, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  const estimatedInput = estimateTokens(system) + estimateTokens(transcript(messages));
  const estimatedNeurons = estimateLlamaNeurons(estimatedInput, maxTokens);
  const dailyNeurons = clampPositiveInt(env.LLAMA_DAILY_NEURON_LIMIT, LLAMA_NEURONS_PER_DAY, LLAMA_NEURONS_PER_DAY);
  await reserveDailyBudget(db, "llama", estimatedNeurons, LLAMA_REQUESTS_PER_DAY, dailyNeurons);

  let data;
  try {
    data = await env.AI.run(model, {
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.25
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/quota|limit|neuron|exceeded/i.test(message)) throw httpError("Cloudflare Llama free allocation is temporarily exhausted.", 429);
    throw httpError(`Cloudflare Llama failed: ${message.slice(0, 180)}`, 502);
  }

  const text = String(data?.response || "").trim();
  if (!text) throw httpError("Cloudflare Llama returned no text", 502);
  await recordUsage(db, "llama", data.usage || {});
  return { provider: "llama", model, text, usage: data.usage || null };
}

async function askProvider(provider, env, messages, system) {
  if (provider === "gemini") return callGemini(env, messages, system);
  if (provider === "llama") return callLlama(env, messages, system);
  throw httpError(`Unknown provider mode: ${provider}`, 400);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function constantTimeEqual(left, right) {
  const [a, b] = await Promise.all([sha256Hex(left), sha256Hex(right)]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loginKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return sha256Hex(`gms-locker-login:${ip}`);
}

async function enforceLoginThrottle(db, request) {
  const key = await loginKey(request);
  const row = await db.prepare("SELECT failed_count, window_started_at, blocked_until FROM auth_attempts WHERE key_hash = ?").bind(key).first();
  const now = Date.now();
  if (row?.blocked_until && Date.parse(row.blocked_until) > now) {
    throw httpError("Too many sign-in attempts. Try again in 15 minutes.", 429);
  }
  return { key, row, now };
}

async function recordLoginFailure(db, throttle) {
  const tenMinutes = 10 * 60 * 1000;
  const currentWindow = throttle.row?.window_started_at && Date.parse(throttle.row.window_started_at) > throttle.now - tenMinutes;
  const failedCount = currentWindow ? Number(throttle.row.failed_count || 0) + 1 : 1;
  const windowStarted = currentWindow ? throttle.row.window_started_at : new Date(throttle.now).toISOString();
  const blockedUntil = failedCount >= 8 ? new Date(throttle.now + 15 * 60 * 1000).toISOString() : null;
  await db.prepare(`
    INSERT INTO auth_attempts (key_hash, failed_count, window_started_at, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key_hash) DO UPDATE SET
      failed_count = excluded.failed_count,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until,
      updated_at = CURRENT_TIMESTAMP
  `).bind(throttle.key, failedCount, windowStarted, blockedUntil).run();
}

async function login(request, env, origin) {
  const db = requireDatabase(env);
  if (!env.GMSLOCKER_ACCESS_TOKEN) throw httpError("Private access has not been configured", 503);
  const throttle = await enforceLoginThrottle(db, request);
  const body = await readJsonBody(request);
  const accessCode = typeof body.accessCode === "string" ? body.accessCode : "";
  const valid = accessCode.length >= 12 && await constantTimeEqual(accessCode, env.GMSLOCKER_ACCESS_TOKEN);
  if (!valid) {
    await recordLoginFailure(db, throttle);
    throw httpError("Access code not recognized", 401);
  }

  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.batch([
    db.prepare("DELETE FROM auth_attempts WHERE key_hash = ?").bind(throttle.key),
    db.prepare("DELETE FROM app_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").bind(new Date().toISOString()),
    db.prepare("INSERT INTO app_sessions (token_hash, expires_at) VALUES (?, ?)").bind(tokenHash, expiresAt)
  ]);
  return json({ ok: true, token, expiresAt }, 200, origin);
}

async function authenticate(request, env, ctx) {
  const db = requireDatabase(env);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 32 || token.length > 200) throw httpError("Sign in required", 401);
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare("SELECT token_hash, expires_at FROM app_sessions WHERE token_hash = ? AND revoked_at IS NULL").bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw httpError("Session expired. Sign in again.", 401);
  ctx?.waitUntil?.(db.prepare("UPDATE app_sessions SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?").bind(tokenHash).run());
  return { tokenHash, expiresAt: row.expires_at };
}

async function logout(env, session) {
  const db = requireDatabase(env);
  await db.prepare("UPDATE app_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ?").bind(session.tokenHash).run();
}

async function loadPrivateDataset(env) {
  const db = requireDatabase(env);
  const dataset = await db.prepare(`
    SELECT id, schema_version, dataset_version, source, league_json, counts_json, imported_at
    FROM league_datasets WHERE is_active = 1 ORDER BY imported_at DESC LIMIT 1
  `).first();
  if (!dataset) throw httpError("Private league dataset has not been imported", 404);
  const result = await db.prepare("SELECT assets_json FROM league_dataset_chunks WHERE dataset_id = ? ORDER BY chunk_index").bind(dataset.id).all();
  const assets = [];
  for (const row of result.results || []) {
    const chunk = parseJson(row.assets_json, []);
    if (Array.isArray(chunk)) assets.push(...chunk);
  }
  return {
    schemaVersion: Number(dataset.schema_version || 1),
    datasetVersion: dataset.dataset_version,
    source: dataset.source,
    league: parseJson(dataset.league_json, {}),
    counts: parseJson(dataset.counts_json, {}),
    assets,
    importedAt: dataset.imported_at
  };
}

async function fantraxRequest(spec, leagueId) {
  const url = new URL(`https://www.fantrax.com/fxea/general/${spec.endpoint}`);
  if (spec.league) url.searchParams.set("leagueId", leagueId);
  for (const [key, value] of Object.entries(spec.params || {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await readBoundedResponseText(response, 5 * 1024 * 1024);
  const data = parseJson(text);
  if (data === null) throw new Error("invalid JSON");
  return data;
}

function rosterState(snapshot) {
  const state = new Map();
  for (const [teamId, roster] of Object.entries(snapshot?.rosters || {})) {
    const teamName = roster?.teamName || teamId;
    for (const item of roster?.rosterItems || []) {
      const playerId = String(item?.id || "");
      if (playerId) state.set(playerId, { team: teamName, status: String(item.status || ""), slot: String(item.position || "") });
    }
  }
  return state;
}

async function rosterEventStatements(db, previousSnapshot, currentSnapshot, detectedAt) {
  if (!previousSnapshot || !currentSnapshot) return [];
  const previous = rosterState(previousSnapshot);
  const current = rosterState(currentSnapshot);
  if (!previous.size) return [];
  const changes = [];
  for (const playerId of new Set([...previous.keys(), ...current.keys()])) {
    const before = previous.get(playerId) || null;
    const after = current.get(playerId) || null;
    if (before?.team !== after?.team) {
      changes.push({
        playerId,
        type: before && after ? "MOVE" : after ? "ADD" : "DROP",
        fromTeam: before?.team || null,
        toTeam: after?.team || null,
        fromStatus: before?.status || null,
        toStatus: after?.status || null
      });
    } else if (before && after && (before.status !== after.status || before.slot !== after.slot)) {
      changes.push({
        playerId,
        type: "STATUS",
        fromTeam: before.team,
        toTeam: after.team,
        fromStatus: before.status || before.slot,
        toStatus: after.status || after.slot
      });
    }
  }

  const statements = [];
  for (const change of changes.slice(0, 250)) {
    const eventId = await sha256Hex(`${detectedAt}|${change.playerId}|${change.type}|${change.fromTeam}|${change.toTeam}|${change.fromStatus}|${change.toStatus}`);
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO fantrax_roster_events
        (event_id, player_id, event_type, from_team, to_team, from_status, to_status, detected_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(eventId, change.playerId, change.type, change.fromTeam, change.toTeam, change.fromStatus, change.toStatus, detectedAt));
  }
  return statements;
}

async function syncFantrax(env, trigger = "manual") {
  const db = requireDatabase(env);
  const leagueId = String(env.FANTRAX_LEAGUE_ID || "").trim();
  if (!leagueId) throw httpError("Fantrax live sync is not configured yet", 409);
  const startedAt = new Date().toISOString();
  const previousRosterRow = await db.prepare("SELECT payload_json FROM fantrax_snapshots WHERE kind = 'rosters'").first();
  const previousRosters = parseJson(previousRosterRow?.payload_json, null);
  const entries = Object.entries(FANTRAX_ENDPOINTS);
  const settled = await Promise.allSettled(entries.map(([, spec]) => fantraxRequest(spec, leagueId)));
  const statements = [];
  const successes = [];
  const errors = [];
  let currentRosters = null;
  settled.forEach((result, index) => {
    const [kind] = entries[index];
    if (result.status === "fulfilled") {
      successes.push(kind);
      if (kind === "rosters") currentRosters = result.value;
      statements.push(db.prepare(`
        INSERT INTO fantrax_snapshots (kind, payload_json, synced_at)
        VALUES (?, ?, ?)
        ON CONFLICT(kind) DO UPDATE SET payload_json = excluded.payload_json, synced_at = excluded.synced_at
      `).bind(kind, JSON.stringify(result.value), startedAt));
    } else {
      errors.push({ kind, error: String(result.reason?.message || result.reason).slice(0, 160) });
    }
  });
  statements.push(...await rosterEventStatements(db, previousRosters, currentRosters, startedAt));
  statements.push(db.prepare("DELETE FROM fantrax_roster_events WHERE detected_at < datetime('now', '-365 days')"));
  statements.push(db.prepare(`
    INSERT INTO fantrax_sync_runs (trigger_type, started_at, completed_at, status, success_json, error_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(trigger, startedAt, new Date().toISOString(), successes.length ? (errors.length ? "partial" : "success") : "failed", JSON.stringify(successes), JSON.stringify(errors)));
  await db.batch(statements);
  if (!successes.length) throw httpError(`Fantrax sync failed: ${errors.map(error => `${error.kind} ${error.error}`).join("; ")}`, 502);
  return { ok: true, configured: true, syncedAt: startedAt, refreshed: successes, errors };
}

async function loadFantraxSnapshots(env) {
  const db = requireDatabase(env);
  const [result, eventResult] = await Promise.all([
    db.prepare("SELECT kind, payload_json, synced_at FROM fantrax_snapshots ORDER BY kind").all(),
    db.prepare("SELECT event_id, player_id, event_type, from_team, to_team, from_status, to_status, detected_at FROM fantrax_roster_events ORDER BY detected_at DESC LIMIT 200").all()
  ]);
  const snapshots = {};
  let syncedAt = null;
  for (const row of result.results || []) {
    snapshots[row.kind] = parseJson(row.payload_json, null);
    if (!syncedAt || row.synced_at > syncedAt) syncedAt = row.synced_at;
  }
  return { ok: true, configured: Boolean(env.FANTRAX_LEAGUE_ID), syncedAt, snapshots, rosterEvents: eventResult.results || [] };
}

function compactScoreboard(data) {
  return {
    season: data?.season || null,
    week: data?.week || null,
    events: (data?.events || []).slice(0, 32).map(event => {
      const competition = event?.competitions?.[0] || {};
      return {
        id: event.id,
        date: event.date,
        name: event.name,
        shortName: event.shortName,
        status: competition.status || null,
        venue: competition.venue?.fullName || null,
        broadcasts: (competition.broadcasts || []).flatMap(item => item.names || []).slice(0, 5),
        competitors: (competition.competitors || []).map(team => ({
          homeAway: team.homeAway,
          score: team.score,
          winner: Boolean(team.winner),
          team: {
            id: team.team?.id,
            abbreviation: team.team?.abbreviation,
            displayName: team.team?.displayName,
            logo: team.team?.logo
          },
          linescores: team.linescores || []
        })),
        leaders: (competition.leaders || []).slice(0, 4).map(group => ({
          name: group.name,
          displayName: group.displayName,
          leaders: (group.leaders || []).slice(0, 2).map(leader => ({
            displayValue: leader.displayValue,
            athlete: leader.athlete?.displayName,
            team: leader.team?.abbreviation
          }))
        }))
      };
    })
  };
}

function headlineTags(article) {
  const text = `${article?.headline || ""} ${article?.description || ""}`.toLowerCase();
  const tags = [];
  if (/holdout|holding out|not report(?:ing|ed)|contract standoff/.test(text)) tags.push("HOLDOUT");
  if (/injur|out for|miss(?:es|ing|ed)|day.to.day|ir\b/.test(text)) tags.push("INJURY");
  if (/\btrade|traded|signs|signed|released|waived|cut\b/.test(text)) tags.push("TRANSACTION");
  if (/contract|extension|deal\b/.test(text)) tags.push("CONTRACT");
  return tags.length ? tags : ["NEWS"];
}

function compactNews(data) {
  return {
    articles: (data?.articles || []).slice(0, 30).map(article => ({
      id: String(article.id || ""),
      headline: article.headline,
      description: article.description,
      published: article.published || article.lastModified,
      link: article.links?.web?.href || null,
      image: article.images?.[0]?.url || null,
      premium: Boolean(article.premium),
      tags: headlineTags(article),
      categories: (article.categories || []).filter(category => ["team", "athlete"].includes(category.type)).slice(0, 12).map(category => ({
        type: category.type,
        name: category.description,
        abbreviation: category.team?.abbreviation || null
      }))
    }))
  };
}

async function sportsFeedRequest(kind) {
  const response = await fetch(SPORTS_FEEDS[kind], {
    headers: { "Accept": "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await readBoundedResponseText(response, 8 * 1024 * 1024);
  const data = parseJson(text);
  if (data === null) throw new Error("invalid JSON");
  return kind === "scores" ? compactScoreboard(data) : compactNews(data);
}

async function syncSportsFeeds(env, kinds = ["scores", "news"]) {
  const db = requireDatabase(env);
  const syncedAt = new Date().toISOString();
  const settled = await Promise.allSettled(kinds.map(kind => sportsFeedRequest(kind)));
  const statements = [];
  const refreshed = [];
  const errors = [];
  settled.forEach((result, index) => {
    const kind = kinds[index];
    if (result.status === "fulfilled") {
      refreshed.push(kind);
      statements.push(db.prepare(`
        INSERT INTO sports_snapshots (kind, payload_json, synced_at)
        VALUES (?, ?, ?)
        ON CONFLICT(kind) DO UPDATE SET payload_json = excluded.payload_json, synced_at = excluded.synced_at
      `).bind(kind, JSON.stringify(result.value), syncedAt));
    } else {
      errors.push({ kind, error: String(result.reason?.message || result.reason).slice(0, 160) });
    }
  });
  if (statements.length) await db.batch(statements);
  if (!refreshed.length) throw httpError(`Live sports feeds failed: ${errors.map(error => `${error.kind} ${error.error}`).join("; ")}`, 502);
  return { ok: true, syncedAt, refreshed, errors };
}

async function loadSportsSnapshots(env) {
  const db = requireDatabase(env);
  const result = await db.prepare("SELECT kind, payload_json, synced_at FROM sports_snapshots ORDER BY kind").all();
  const snapshots = {};
  const feedTimes = {};
  for (const row of result.results || []) {
    snapshots[row.kind] = parseJson(row.payload_json, null);
    feedTimes[row.kind] = row.synced_at;
  }
  return { ok: true, snapshots, feedTimes };
}

async function handleChat(request, env, origin) {
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
    throw httpError("Content-Type must be application/json", 415);
  }
  const body = await readJsonBody(request);
  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") throw httpError("A user message is required", 400);
  const requested = String(body.provider || "llama").toLowerCase();
  if (!ALLOWED_PROVIDERS.has(requested)) throw httpError(`Unknown provider mode: ${requested}`, 400);
  if (requested === "gemini" && body.geminiConsent !== true) {
    throw httpError("Gemini requires explicit consent because free-tier content may be used to improve Google products.", 400);
  }
  const context = requested === "gemini" ? publicGeminiContext(body.context || null) : body.context || null;
  const memory = requested === "gemini" ? null : body.memory || null;
  const system = buildSystem(context, memory);
  const answer = await askProvider(requested, env, messages, system);
  return json({ ok: true, mode: requested, routedTo: requested, answer }, 200, origin);
}

async function fetchHandler(request, env, ctx) {
  const origin = request.headers.get("Origin") || "";
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
    return new Response(null, { status: 204, headers: cors(origin) });
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    return json({
      ok: true,
      service: "GM's Locker Private AI Gateway",
      providers: {
        gemini: Boolean(env.GEMINI_API_KEY),
        llama: Boolean(env.AI),
        grok: "manual-only"
      },
      privateData: Boolean(env.DB),
      accessConfigured: Boolean(env.GMSLOCKER_ACCESS_TOKEN),
      fantraxConfigured: Boolean(env.FANTRAX_LEAGUE_ID),
      sportsFeeds: ["scores", "news"],
      defaultModels: DEFAULT_MODELS
    }, 200, origin);
  }

  if (!ALLOWED_ORIGINS.has(origin)) throw httpError("Origin not allowed", 403);
  if (url.pathname === "/auth/login" && request.method === "POST") return login(request, env, origin);

  const session = await authenticate(request, env, ctx);

  if (url.pathname === "/auth/status" && request.method === "GET") {
    return json({ ok: true, signedIn: true, expiresAt: session.expiresAt }, 200, origin);
  }
  if (url.pathname === "/auth/logout" && request.method === "POST") {
    await logout(env, session);
    return json({ ok: true }, 200, origin);
  }
  if (url.pathname === "/league-data" && request.method === "GET") {
    return json({ ok: true, dataset: await loadPrivateDataset(env) }, 200, origin);
  }
  if (url.pathname === "/fantrax/live" && request.method === "GET") {
    return json(await loadFantraxSnapshots(env), 200, origin);
  }
  if (url.pathname === "/fantrax/sync" && request.method === "POST") {
    return json(await syncFantrax(env, "manual"), 200, origin);
  }
  if (url.pathname === "/sports/live" && request.method === "GET") {
    return json(await loadSportsSnapshots(env), 200, origin);
  }
  if (url.pathname === "/sports/sync" && request.method === "POST") {
    return json(await syncSportsFeeds(env), 200, origin);
  }
  if (url.pathname === "/gm-chat" && request.method === "POST") return handleChat(request, env, origin);
  throw httpError("Not found", 404);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    try {
      return await fetchHandler(request, env, ctx);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      console.error(JSON.stringify({ event: "request_error", path: new URL(request.url).pathname, status, error: String(error?.message || error) }));
      return json({ ok: false, error: status === 500 ? "Internal service error" : String(error?.message || error) }, status, origin);
    }
  },

  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(syncSportsFeeds(env, ["scores"]).catch(error => {
        console.error(JSON.stringify({ event: "scores_cron_error", error: String(error?.message || error) }));
      }));
      return;
    }
    const jobs = [syncSportsFeeds(env, ["news"])];
    if (env.FANTRAX_LEAGUE_ID) jobs.push(syncFantrax(env, "cron"));
    ctx.waitUntil(Promise.allSettled(jobs).then(results => {
      for (const result of results) {
        if (result.status === "rejected") console.error(JSON.stringify({ event: "quarter_hour_cron_error", error: String(result.reason?.message || result.reason) }));
      }
    }));
  }
};
