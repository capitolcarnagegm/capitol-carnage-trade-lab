import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import worker from "../src/worker.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const allowedOrigin = "https://gmslocker.com";
const authHeaders = {
  Origin: allowedOrigin,
  Authorization: `Bearer ${"a".repeat(43)}`,
  "Content-Type": "application/json"
};

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, " ").trim();
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes("FROM app_sessions")) {
      return { token_hash: "hash", expires_at: new Date(Date.now() + 86400000).toISOString() };
    }
    if (this.sql.includes("FROM auth_attempts")) return null;
    if (this.sql.includes("RETURNING request_count")) return { request_count: 1, reserved_units: this.values[2] };
    if (this.sql.includes("FROM league_datasets")) return this.db.dataset || null;
    if (this.sql.includes("FROM fantrax_snapshots")) return this.db.previousRoster || null;
    return null;
  }

  async run() {
    this.db.runs.push({ sql: this.sql, values: this.values });
    return { success: true };
  }

  async all() {
    if (this.sql.includes("FROM league_dataset_chunks")) return { results: this.db.chunks || [] };
    if (this.sql.includes("FROM fantrax_roster_events")) return { results: this.db.fantraxEvents || [] };
    if (this.sql.includes("FROM fantrax_snapshots")) return { results: [] };
    if (this.sql.includes("FROM sports_snapshots")) return { results: this.db.sports || [] };
    return { results: [] };
  }
}

class FakeDB {
  constructor() {
    this.runs = [];
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map(statement => statement.run()));
  }
}

const ctx = { waitUntil(promise) { void promise; } };

test("health reports configured bindings without exposing secret values", async () => {
  const response = await worker.fetch(new Request("https://worker.example/health"), {
    DB: {},
    GEMINI_API_KEY: "test-only",
    AI: { run() {} },
    GMSLOCKER_ACCESS_TOKEN: "test-private-access-code",
    FANTRAX_LEAGUE_ID: "test-private-league-id"
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.service, "GMS Locker AI Gateway");
  assert.equal(body.providers.gemini, true);
  assert.equal(body.providers.llama, true);
  assert.equal("grok" in body.providers, false);
  assert.equal(body.privateData, true);
  assert.equal(JSON.stringify(body).includes("test-only"), false);
  assert.equal(JSON.stringify(body).includes("test-private-access-code"), false);
  assert.equal(JSON.stringify(body).includes("test-private-league-id"), false);
});

test("preflight rejects an unapproved origin", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "OPTIONS",
    headers: { Origin: "https://attacker.example" }
  }), {});

  assert.equal(response.status, 403);
});

test("preflight allows the authorization header", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "OPTIONS",
    headers: { Origin: allowedOrigin }
  }), {});

  assert.equal(response.status, 204);
  assert.match(response.headers.get("Access-Control-Allow-Headers"), /Authorization/);
});

test("routes require a bearer session when an access code is configured", async () => {
  const response = await worker.fetch(new Request("https://worker.example/league-data", {
    headers: { Origin: allowedOrigin }
  }), { DB: new FakeDB(), GMSLOCKER_ACCESS_TOKEN: "configured-private-code" }, ctx);
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "Sign in required");
});

test("routes stay open when no access code is configured", async () => {
  const db = new FakeDB();
  db.sports = [{
    kind: "scores",
    payload_json: JSON.stringify({ events: [] }),
    synced_at: "2026-08-10T00:00:00Z"
  }];
  const response = await worker.fetch(new Request("https://worker.example/sports/live", {
    headers: { Origin: allowedOrigin }
  }), { DB: db }, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
});

test("chat rejects an unknown provider before calling an external API", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      provider: "grok",
      messages: [{ role: "user", content: "Test" }]
    })
  }), { DB: new FakeDB() }, ctx);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /Unknown provider mode/);
});

test("Gemini rejects requests without explicit free-tier data-use consent", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      provider: "gemini",
      messages: [{ role: "user", content: "Use only public context." }]
    })
  }), { DB: new FakeDB(), GEMINI_API_KEY: "test-only" }, ctx);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.error, /explicit consent/);
});

test("Gemini receives public NFL context and approved personalization but not private league context", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  let upstreamBody;
  globalThis.fetch = async (_url, options) => {
    upstreamBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: "test-gemini",
      steps: [{ type: "model_output", content: [{ type: "text", text: "Public-context answer" }] }],
      usage: { total_input_tokens: 10, total_output_tokens: 4 }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        provider: "gemini",
        geminiConsent: true,
        messages: [{ role: "user", content: "Discuss the public injury update." }],
        context: {
          myTeam: { secretMarker: "PRIVATE-ROSTER-MARKER" },
          league: { secretMarker: "PRIVATE-LEAGUE-MARKER" },
          nflLive: { breakingNews: [{ headline: "PUBLIC-NEWS-MARKER" }] }
        },
        memory: { personalization: "PERSONAL-PROFILE-MARKER", secretMarker: "PRIVATE-MEMORY-MARKER" }
      })
    }), { DB: new FakeDB(), GEMINI_API_KEY: "test-only" }, ctx);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.answer.text, "Public-context answer");
    assert.match(upstreamBody.system_instruction, /PUBLIC-NEWS-MARKER/);
    assert.match(upstreamBody.system_instruction, /PERSONAL-PROFILE-MARKER/);
    assert.doesNotMatch(upstreamBody.system_instruction, /PRIVATE-(?:ROSTER|LEAGUE|MEMORY)-MARKER/);
    assert.equal(upstreamBody.store, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("chat rejects malformed JSON", async () => {
  const response = await worker.fetch(new Request("https://worker.example/gm-chat", {
    method: "POST",
    headers: authHeaders,
    body: "{"
  }), { DB: new FakeDB() }, ctx);
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.equal(body.error, "Request body must be valid JSON");
});

test("login rejects weak or incorrect access codes", async () => {
  const db = new FakeDB();
  const response = await worker.fetch(new Request("https://worker.example/auth/login", {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: "wrong" })
  }), { DB: db, GMSLOCKER_ACCESS_TOKEN: "a-correct-long-access-code" }, ctx);
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "Access code not recognized");
  assert.equal(db.runs.some(run => run.sql.includes("INSERT INTO auth_attempts")), true);
});

test("login creates a bearer session without returning the access code", async () => {
  const db = new FakeDB();
  const accessCode = "a-correct-long-access-code";
  const response = await worker.fetch(new Request("https://worker.example/auth/login", {
    method: "POST",
    headers: { Origin: allowedOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode })
  }), { DB: db, GMSLOCKER_ACCESS_TOKEN: accessCode }, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(JSON.stringify(body).includes(accessCode), false);
  assert.equal(db.runs.some(run => run.sql.includes("INSERT INTO app_sessions")), true);
});

test("authenticated league data is assembled from private chunks", async () => {
  const db = new FakeDB();
  db.dataset = {
    id: "private-v1",
    schema_version: 1,
    dataset_version: "v1",
    source: "private import",
    league_json: JSON.stringify({ name: "Test League" }),
    counts_json: JSON.stringify({ totalPlayers: 2 }),
    imported_at: "2026-08-09T00:00:00Z"
  };
  db.chunks = [{ assets_json: JSON.stringify([{ id: "a" }, { id: "b" }]) }];

  const response = await worker.fetch(new Request("https://worker.example/league-data", {
    headers: { Origin: allowedOrigin, Authorization: authHeaders.Authorization }
  }), { DB: db }, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.dataset.assets.length, 2);
  assert.equal(body.dataset.league.name, "Test League");
});

test("authenticated live sports route returns stored scores and tagged news", async () => {
  const db = new FakeDB();
  db.sports = [
    {
      kind: "news",
      payload_json: JSON.stringify({ articles: [{ headline: "Player ends holdout", tags: ["HOLDOUT"] }] }),
      synced_at: "2026-08-09T12:15:00Z"
    },
    {
      kind: "scores",
      payload_json: JSON.stringify({ events: [{ id: "game-1", name: "Away at Home" }] }),
      synced_at: "2026-08-09T12:20:00Z"
    }
  ];

  const response = await worker.fetch(new Request("https://worker.example/sports/live", {
    headers: { Origin: allowedOrigin, Authorization: authHeaders.Authorization }
  }), { DB: db }, ctx);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.snapshots.scores.events[0].id, "game-1");
  assert.deepEqual(body.snapshots.news.articles[0].tags, ["HOLDOUT"]);
  assert.equal(body.feedTimes.scores, "2026-08-09T12:20:00Z");
});

test("authenticated Fantrax sync refreshes every documented league snapshot", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const upstream = [];
  globalThis.fetch = async url => {
    const parsed = new URL(url);
    upstream.push(parsed);
    const endpoint = parsed.pathname.split("/").pop();
    const payload = endpoint === "getTeamRosters"
      ? { rosters: { team1: { teamName: "Test Team", rosterItems: [{ id: "p1", position: "ACTIVE", status: "ACTIVE" }] } } }
      : endpoint === "getPlayerIds"
        ? { p1: { name: "Test Player", position: "QB", team: "IND" } }
        : { endpoint, ok: true };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  };

  try {
    const db = new FakeDB();
    const response = await worker.fetch(new Request("https://worker.example/fantrax/sync", {
      method: "POST",
      headers: authHeaders
    }), { DB: db, FANTRAX_LEAGUE_ID: "test-private-league-id" }, ctx);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(new Set(body.refreshed), new Set(["league", "rosters", "standings", "matchups", "draftPicks", "draftResults", "players"]));
    assert.deepEqual(new Set(upstream.map(url => url.pathname.split("/").pop())), new Set([
      "getLeagueInfo", "getTeamRosters", "getStandings", "getMatchupScores", "getDraftPicks", "getDraftResults", "getPlayerIds"
    ]));
    assert.equal(upstream.find(url => url.pathname.endsWith("getPlayerIds")).searchParams.get("sport"), "NFL");
    assert.equal(upstream.filter(url => !url.pathname.endsWith("getPlayerIds")).every(url => url.searchParams.get("leagueId") === "test-private-league-id"), true);
    assert.equal(db.runs.filter(run => run.sql.includes("INSERT INTO fantrax_snapshots")).length, 7);
    assert.equal(JSON.stringify(body).includes("test-private-league-id"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Fantrax sync rejects oversized upstream responses before buffering them", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", {
    status: 200,
    headers: { "Content-Length": String(6 * 1024 * 1024) }
  });

  try {
    const response = await worker.fetch(new Request("https://worker.example/fantrax/sync", {
      method: "POST",
      headers: authHeaders
    }), { DB: new FakeDB(), FANTRAX_LEAGUE_ID: "test-private-league-id" }, ctx);
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.match(body.error, /response too large/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
