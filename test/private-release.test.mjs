import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const file = name => new URL(name, root);

async function loadAppForTest() {
  const source = await readFile(file("app.js"), "utf8");
  const storage = new Map();
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: "",
        innerHTML: "",
        textContent: "",
        classList: { toggle() {} },
        addEventListener() {}
      });
    }
    return elements.get(id);
  };
  const context = {
    console,
    __GMS_TEST__: true,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    document: {
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    fetch: async () => { throw new Error("unexpected fetch"); },
    URL,
    Headers,
    Request,
    Response,
    Date,
    JSON,
    Math,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "app.js" });
  return { context, storage, testApi: context.GMS.__test };
}

function fantraxFixture() {
  return [
    {
      period: 1,
      rosters: {
        nsf1b7esmk4b6bgd: {
          teamName: "Capitol Carnage",
          salaryCap: 1403.9,
          rosterItems: [
            { id: "p1", position: "QB", salary: 48, status: "ACTIVE", contract: { smallId: "3" } }
          ]
        },
        partner1: {
          teamName: "Agent Smith",
          salaryCap: 1403.9,
          rosterItems: [
            { id: "p2", position: "WR", salary: 31, status: "ACTIVE", contract: { smallId: "2" } }
          ]
        }
      }
    },
    {
      p1: { name: "Alpha, Ace", position: "QB", team: "IND" },
      p2: { name: "Beta, Bob", position: "WR", team: "DET" },
      ignored: 7
    },
    {
      standings: [
        { teamId: "partner1", teamName: "Agent Smith", rank: 2 },
        { teamId: "nsf1b7esmk4b6bgd", teamName: "Capitol Carnage", rank: 1 }
      ]
    },
    {
      futureDraftPicks: [
        { currentOwnerTeamId: "nsf1b7esmk4b6bgd", originalOwnerTeamId: "nsf1b7esmk4b6bgd", year: 2027, round: 1 },
        { currentOwnerTeamId: "partner1", originalOwnerTeamId: "partner1", year: 2027, round: 2 }
      ]
    },
    { period: 1, matchups: [{ home: { teamId: "partner1" }, away: { teamId: "nsf1b7esmk4b6bgd" } }] },
    {
      leagueName: "Pride Dynasty",
      seasonYear: 2026,
      rosterInfo: { maxTotalPlayers: 37 },
      playerInfo: { p1: { eligiblePos: "QB,SFX" } }
    }
  ];
}

test("the public shell exposes every GMS Locker tool and loads the live transport first", async () => {
  const [html, app, proxy] = await Promise.all([
    readFile(file("index.html"), "utf8"),
    readFile(file("app.js"), "utf8"),
    readFile(file("fantrax-proxy.js"), "utf8")
  ]);

  assert.match(html, /GMS Locker — GM Sports Assistant/);
  assert.equal([...html.matchAll(/data-view="[^"]+"/g)].length, 13);
  assert.ok(html.indexOf('src="fantrax-proxy.js?v=') < html.indexOf('src="app.js?v='));
  assert.match(html, /src="gmslocker-logo\.png"/);
  assert.match(html, /src="pinvault-collectibles-logo\.png"/);
  assert.match(html, /id="gmChatLauncher"/);
  assert.match(app, /openChat: openChat/);
  assert.match(proxy, /gmslocker-fantrax-proxy\.robinharvey001\.workers\.dev/);
  assert.match(app, /gms-locker-ai\.robinharvey001\.workers\.dev/);
  assert.match(app, /Cloudflare Llama/);
  assert.match(app, /Gemini/);
  assert.doesNotMatch(app, /Prototype evaluation|api\.openai\.com|Claude|Grok/i);
  assert.doesNotMatch(html, /access code|password|sign in required/i);
});

test("real Fantrax payloads normalize into rosters, players, standings, picks, matchups, and rules", async () => {
  const { testApi } = await loadAppForTest();
  const snapshot = testApi.normalizeFantrax(fantraxFixture());

  assert.equal(Object.keys(snapshot.teams).length, 2);
  assert.equal(snapshot.teams.nsf1b7esmk4b6bgd.items[0].salary, 48);
  assert.equal(snapshot.players.p1.name, "Alpha, Ace");
  assert.equal(snapshot.standings[0].teamName, "Capitol Carnage");
  assert.equal(snapshot.picks.length, 2);
  assert.equal(snapshot.matchups.matchups.length, 1);
  assert.equal(snapshot.leagueInfo.leagueName, "Pride Dynasty");
  assert.equal("playerInfo" in snapshot.leagueInfo, false);
});

test("Trade Lab grades synced assets and rejects the wrong roster owner", async () => {
  const { testApi } = await loadAppForTest();
  testApi.applyFantraxSnapshot(testApi.normalizeFantrax(fantraxFixture()));

  const valid = testApi.scoreTrade("Ace Alpha, 2027 1st", "Bob Beta, 2027 2nd", "Agent Smith");
  assert.deepEqual(Array.from(valid.errors), []);
  assert.equal(valid.give.length, 2);
  assert.equal(valid.get.length, 2);
  assert.equal(valid.partner, "Agent Smith");
  assert.match(valid.grade, /^(A|B\+|B|C|D|F)$/);
  assert.ok(Number.isFinite(valid.salaryDelta));

  const invalid = testApi.scoreTrade("Bob Beta", "Ace Alpha", "Agent Smith");
  assert.match(invalid.errors.join(" "), /rostered by Agent Smith, not Capitol Carnage/);
});

test("the Fantrax Worker enforces endpoint, league, and browser-origin boundaries", async () => {
  const source = await readFile(file("cloudflare-worker.js"), "utf8");
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const { default: worker } = await import(moduleUrl);
  const originalFetch = globalThis.fetch;
  let upstreamUrl = "";
  let upstreamCalls = 0;
  globalThis.fetch = async url => {
    upstreamCalls += 1;
    upstreamUrl = String(url);
    return new Response(JSON.stringify({ leagueName: "Pride Dynasty" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  try {
    const allowed = await worker.fetch(new Request("https://worker.example/?endpoint=getLeagueInfo&leagueId=astbqxhwmk4b6bg9", {
      headers: { Origin: "https://gmslocker.com" }
    }));
    assert.equal(allowed.status, 200);
    assert.match(upstreamUrl, /fantrax\.com\/fxea\/general\/getLeagueInfo/);
    assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), "https://gmslocker.com");

    const wrongLeague = await worker.fetch(new Request("https://worker.example/?endpoint=getStandings&leagueId=wrong", {
      headers: { Origin: "https://gmslocker.com" }
    }));
    assert.equal(wrongLeague.status, 400);

    const wrongEndpoint = await worker.fetch(new Request("https://worker.example/?endpoint=getDraftResults&leagueId=astbqxhwmk4b6bg9", {
      headers: { Origin: "https://gmslocker.com" }
    }));
    assert.equal(wrongEndpoint.status, 400);

    const wrongOrigin = await worker.fetch(new Request("https://worker.example/?endpoint=getLeagueInfo&leagueId=astbqxhwmk4b6bg9", {
      headers: { Origin: "https://example.com" }
    }));
    assert.equal(wrongOrigin.status, 403);
    assert.equal(upstreamCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("both GitHub Actions deploy to workers.dev and run production smoke tests", async () => {
  const [proxyWorkflow, aiWorkflow, proxyConfig, aiConfigText, aiWorker] = await Promise.all([
    readFile(file(".github/workflows/deploy-cloudflare-worker.yml"), "utf8"),
    readFile(file(".github/workflows/deploy-ai-worker.yml"), "utf8"),
    readFile(file("wrangler.toml"), "utf8"),
    readFile(file("public-release/multi-ai-worker/wrangler.jsonc"), "utf8"),
    readFile(file("public-release/multi-ai-worker/src/worker.js"), "utf8")
  ]);
  const aiConfig = JSON.parse(aiConfigText);

  assert.doesNotMatch(proxyConfig, /^routes\s*=|zone_name/m);
  assert.match(proxyConfig, /workers_dev\s*=\s*true/);
  assert.match(proxyWorkflow, /cloudflare\/wrangler-action@v4/);
  assert.match(proxyWorkflow, /Verify live Fantrax response/);
  assert.match(aiWorkflow, /deploy --config wrangler\.jsonc --keep-vars/);
  assert.match(aiWorkflow, /Verify AI gateway health/);
  assert.equal(aiConfig.name, "gms-locker-ai");
  assert.equal(aiConfig.ai.binding, "AI");
  assert.equal(aiConfig.vars.LLAMA_MODEL, "@cf/meta/llama-4-scout-17b-16e-instruct");
  assert.equal(aiConfig.vars.GEMINI_MODEL, "gemini-3.5-flash-lite");
  assert.equal("GMSLOCKER_ACCESS_TOKEN" in aiConfig.vars, false);
  assert.match(aiWorker, /new Set\(\["gemini", "llama"\]\)/);
  assert.match(aiWorker, /if \(!env\.GMSLOCKER_ACCESS_TOKEN\)/);
  assert.match(aiWorker, /publicGeminiContext/);
  assert.doesNotMatch(aiWorker, /api\.openai\.com|api\.anthropic\.com|api\.x\.ai/);
});
