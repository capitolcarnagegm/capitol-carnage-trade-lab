import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const htmlPath = new URL('../index.html', import.meta.url);
const workerPath = new URL('../multi-ai-worker/src/worker.js', import.meta.url);
const configPath = new URL('../multi-ai-worker/wrangler.example.jsonc', import.meta.url);
const serviceWorkerPath = new URL('../service-worker.js', import.meta.url);
const legacyWorkerPath = new URL('../cloudflare-worker/src/worker.js', import.meta.url);

function appContext(fetchImpl = async () => { throw new Error('unexpected fetch'); }) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        id,
        value: '',
        innerHTML: '',
        textContent: '',
        style: {},
        scrollTop: 0,
        scrollHeight: 0,
        hidden: false,
        disabled: false,
        classList: {add() {}, remove() {}, toggle() {}, contains() { return false; }},
        addEventListener() {},
        setAttribute() {},
        focus() {},
        select() {},
        remove() {},
      });
    }
    return elements.get(id);
  };
  const storage = new Map();
  const context = {
    console,
    document: {
      readyState: 'loading',
      body: {appendChild() {}, classList: {toggle() {}, contains() { return false; }}},
      createElement: () => element('created'),
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener() {},
      execCommand: () => true,
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    navigator: {},
    installBtn: element('installBtn'),
    requestAnimationFrame() {},
    requestIdleCallback() {},
    setTimeout(callback) { if (callback) callback(); },
    clearTimeout() {},
    setInterval() {},
    alert() {},
    confirm: () => true,
    prompt: () => null,
    fetch: fetchImpl,
    Headers,
    URL,
    Blob,
    FormData,
    FileReader: class {},
    location: {reload() {}},
  };
  context.window = context;
  context.addEventListener = () => {};
  return {context, elements, storage};
}

async function loadApp(fetchImpl) {
  const html = await readFile(htmlPath, 'utf8');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const app = appContext(fetchImpl);
  vm.createContext(app.context);
  vm.runInContext(script, app.context);
  return {...app, html};
}

test('the public app contains no raw Fantrax dataset path or league identifier', async () => {
  const [html, config, legacyWorker] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(configPath, 'utf8'),
    readFile(legacyWorkerPath, 'utf8'),
  ]);
  assert.doesNotMatch(html, /FANTRAX_DATASET_URL|data\/pride-dynasty/);
  assert.doesNotMatch(`${html}\n${config}`, /leagueId=[A-Za-z0-9]{8,}/);
  assert.match(html, /const configuredTeamName=String\(db\.config\.teamName/);
  assert.doesNotMatch(html, /franchises\.find\(f=>\/[A-Za-z ]+\/i\.test\(f\.name\)\)/);
  assert.match(html, /a\.download=`gmslocker-backup-/);
  assert.doesNotMatch(config, /"FANTRAX_LEAGUE_ID"\s*:/);
  assert.match(html, /const seedAssets=\[\];/);
  assert.doesNotMatch(legacyWorker, /const LEAGUE_ID\s*=/);
  assert.match(legacyWorker, /env\.MFL_LEAGUE_ID/);
  assert.match(legacyWorker, /BRIDGE_ACCESS_TOKEN/);
  assert.match(legacyWorker, /constantTimeEqual/);
  assert.match(legacyWorker, /readBoundedResponseText/);
  assert.match(html, /apiFetch\('\/league-data'\)/);
  assert.match(html, /SESSION_TOKEN_KEY='gmslocker_private_session_v1'/);
});

test('the Worker protects private data and AI routes with bearer sessions', async () => {
  const worker = await readFile(workerPath, 'utf8');
  assert.match(worker, /url\.pathname === "\/auth\/login"/);
  assert.match(worker, /url\.pathname === "\/league-data"/);
  assert.match(worker, /const session = await authenticate/);
  assert.match(worker, /GMSLOCKER_ACCESS_TOKEN/);
  assert.doesNotMatch(worker, /api\.openai\.com|api\.x\.ai|OPENAI_API_KEY|XAI_API_KEY/);
});

test('Llama is private by default while Gemini is consented public-context only', async () => {
  const [html, worker, config] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(workerPath, 'utf8'),
    readFile(configPath, 'utf8'),
  ]);
  assert.match(html, /<option value="gemini"/);
  assert.match(html, /<option value="llama"/);
  assert.doesNotMatch(html, /<option value="council"/);
  assert.match(html, /buildGeminiPublicContext/);
  assert.match(html, /ensureGeminiConsent/);
  assert.match(html, /copyForManualGrok/);
  assert.match(worker, /body\.geminiConsent !== true/);
  assert.match(worker, /publicGeminiContext/);
  assert.doesNotMatch(worker, /new Set\(\["gemini", "llama", "council"\]\)/);
  assert.match(worker, /store: false/);
  assert.match(worker, /gemini-3\.5-flash-lite/);
  assert.match(config, /@cf\/meta\/llama-4-scout-17b-16e-instruct/);
  assert.match(config, /"binding": "AI"/);
});

test('the Gemini side conversation keeps separate local history and sends authorization', async () => {
  let request;
  const {context, storage} = await loadApp(async (url, options) => {
    request = {url, options, body: JSON.parse(options.body)};
    return {ok: true, status: 200, json: async () => ({ok: true, answer: {text: 'Gemini reply', model: 'test-gemini'}})};
  });
  storage.set('gmslocker_private_session_v1', 's'.repeat(43));
  storage.set('gmslocker_private_session_expiry_v1', new Date(Date.now() + 86400000).toISOString());
  context.document.getElementById('sideChatInput').value = 'Audit my wide receivers.';
  await vm.runInContext('sendSideChatMessage()', context);

  assert.equal(request.body.provider, 'gemini');
  assert.equal(request.body.conversationId, 'public-gemini-side-chat');
  assert.equal(request.body.geminiConsent, true);
  assert.equal(request.body.memory, null);
  assert.equal('myTeam' in request.body.context, false);
  assert.match(request.body.context.privacyBoundary, /No league identity/);
  assert.equal(new Headers(request.options.headers).get('Authorization'), `Bearer ${'s'.repeat(43)}`);
  assert.equal(storage.has('gmslocker_ai_messages_v1'), false);
  const saved = JSON.parse(storage.get('gmslocker_gemini_messages_v2'));
  assert.deepEqual(saved.map(message => message.role), ['user', 'assistant']);
});

test('Fantrax live rosters update API-owned fields but preserve manual ownership', async () => {
  const {context} = await loadApp();
  context.__payload = {
    configured: true,
    syncedAt: '2026-08-09T12:00:00Z',
    snapshots: {
      rosters: {
        rosters: {
          team1: {teamName: 'Test Franchise', rosterItems: [{id: 'p1', position: 'ACTIVE', status: 'ACTIVE'}, {id: 'p2', position: 'RESERVE', status: 'RESERVE'}]},
        },
      },
      standings: {standings: []},
      matchups: {matchups: []},
    },
  };
  const result = vm.runInContext(`(()=>{
    db={config:clone(DEFAULT_CONFIG),assets:[
      {id:'a',fantraxId:'p1',name:'One',type:'PLAYER',source:FANTRAX_SOURCE,sources:{roster:FANTRAX_SOURCE}},
      {id:'b',fantraxId:'p2',name:'Two',type:'PLAYER',roster:'Manual Team',source:'Manual Override',sources:{roster:'Manual Override'}},
      {id:'c',fantraxId:'p3',name:'Three',type:'PLAYER',roster:'Old Team',source:FANTRAX_SOURCE,sources:{roster:FANTRAX_SOURCE}}
    ],mfl:{}};
    const summary=applyFantraxLive(__payload);
    return {summary,teamCount:db.config.teams,liveMeta:db.fantraxLiveMeta,assets:db.assets.map(a=>({id:a.id,roster:a.roster,status:a.status}))};
  })()`, context);

  assert.equal(result.summary.players, 2);
  assert.equal(result.teamCount, 1);
  assert.equal(result.liveMeta.rosteredCount, 2);
  assert.equal(result.assets.find(asset => asset.id === 'a').roster, 'Test Franchise');
  assert.equal(result.assets.find(asset => asset.id === 'b').roster, 'Manual Team');
  assert.equal(result.assets.find(asset => asset.id === 'c').roster, 'FREE AGENT');
});

test('Fantrax live player pool adds missing free agents and imports status tags and rules', async () => {
  const {context} = await loadApp();
  context.__payload = {
    configured: true,
    syncedAt: '2026-08-09T12:00:00Z',
    snapshots: {
      league: {
        leagueName: 'Test League',
        playerInfo: {
          p1: {eligiblePos: 'QB, Flex', status: 'IR'},
          p4: {eligiblePos: 'WR, Flex', status: ''},
        },
        draftSettings: {draftType: 'SLOW'},
        rosterInfo: {maxTotalPlayers: 50},
        poolSettings: {playerSourceType: 'NFL'},
        scoringSystem: {type: 'POINTS'},
      },
      players: {
        p1: {name: 'One Updated', fantraxId: 'p1', position: 'QB', team: 'IND'},
        p4: {name: 'Four', fantraxId: 'p4', position: 'WR', team: 'DET'},
      },
      rosters: {
        rosters: {
          team1: {teamName: 'Test Franchise', rosterItems: [{id: 'p1', position: 'ACTIVE', status: 'ACTIVE'}]},
        },
      },
    },
  };

  const result = vm.runInContext(`(()=>{
    db={config:clone(DEFAULT_CONFIG),assets:[
      {id:'a',fantraxId:'p1',name:'Old Name',type:'PLAYER',source:FANTRAX_SOURCE,sources:{name:FANTRAX_SOURCE,roster:FANTRAX_SOURCE}}
    ],mfl:{}};
    const summary=applyFantraxLive(__payload);
    const added=db.assets.find(asset=>asset.fantraxId==='p4');
    const updated=db.assets.find(asset=>asset.fantraxId==='p1');
    return {
      summary,
      added:{name:added.name,pos:added.pos,nfl:added.nfl,roster:added.roster,inPool:added.inFantraxPool},
      updated:{name:updated.name,tags:updated.fantraxTags,eligiblePositions:updated.eligiblePositions},
      rules:db.fantraxRules,
      leagueName:db.config.leagueName
    };
  })()`, context);

  assert.equal(result.summary.pool, 2);
  assert.equal(result.added.name, 'Four');
  assert.equal(result.added.roster, 'FREE AGENT');
  assert.equal(result.added.inPool, true);
  assert.equal(result.updated.name, 'One Updated');
  assert.equal(result.updated.tags.includes('IR'), true);
  assert.equal(result.updated.eligiblePositions, 'QB, Flex');
  assert.equal(result.leagueName, 'Test League');
  assert.equal(result.rules.rosterInfo.maxTotalPlayers, 50);
  assert.equal(result.rules.scoringSystem.type, 'POINTS');
});

test('private contract notes become visible tag and holdout flags', async () => {
  const {context} = await loadApp();
  const flags = vm.runInContext(`({
    holdout:contractFlags({contractNote:'Contract holdout'}),
    tag:contractFlags({contractNote:'Franchise tag'}),
    rookie:contractFlags({contractNote:'Rookie contract'})
  })`, context);

  assert.equal(flags.holdout.includes('HOLDOUT'), true);
  assert.equal(flags.tag.includes('FRANCHISE TAG'), true);
  assert.equal(flags.rookie.includes('ROOKIE CONTRACT'), true);
});

test('manual trades audit and persist without referencing undefined transaction variables', async () => {
  const {context, storage} = await loadApp();
  context.document.getElementById('txGiveAsset').value = 'give';
  context.document.getElementById('txRecvAsset').value = 'receive';
  context.document.getElementById('txTeamA').value = 'Team A';
  context.document.getElementById('txTeamB').value = 'Team B';
  vm.runInContext(`
    db={config:clone(DEFAULT_CONFIG),assets:[
      {id:'give',name:'Give Player',type:'PLAYER',roster:'Team A',source:'Manual'},
      {id:'receive',name:'Receive Player',type:'PLAYER',roster:'Team B',source:'Manual'}
    ],mfl:{},history:[],savedTrades:[],savedFA:[]};
    renderAssetList=()=>{};renderTransactions=()=>{};
  `, context);

  assert.doesNotThrow(() => vm.runInContext('addTradePair()', context));
  const saved = JSON.parse(storage.get('ccgm_db'));
  assert.equal(saved.assets.find(asset => asset.id === 'give').roster, 'Team B');
  assert.equal(saved.assets.find(asset => asset.id === 'receive').roster, 'Team A');
  assert.equal(saved.manualTransactions.length, 2);
  assert.equal(saved.audit[0].action, 'MANUAL TRADE');
});

test('live NFL routes and private cron cadence are present', async () => {
  const [html, worker, config] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(workerPath, 'utf8'),
    readFile(configPath, 'utf8'),
  ]);
  assert.match(html, /id="livecenter"/);
  assert.match(html, /Verified Holdout Watch/);
  assert.match(html, /Authenticated Fantrax League Data/);
  assert.match(html, /draftPicks:fantraxLiveSnapshots\.draftPicks/);
  assert.doesNotMatch(html, /JSON\.stringify\(db\.fantraxRules\|\|\{\},null,2\)\.slice/);
  assert.match(worker, /url\.pathname === "\/sports\/live"/);
  assert.match(worker, /site\.api\.espn\.com\/apis\/site\/v2\/sports\/football\/nfl\/scoreboard/);
  assert.match(config, /"\*\/5 \* \* \* \*"/);
  assert.match(config, /"2,17,32,47 \* \* \* \*"/);
});

test('the service worker caches only the public shell', async () => {
  const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
  assert.match(serviceWorker, /gmslocker-v6-6-private-gemini/);
  assert.doesNotMatch(serviceWorker, /league-data|gm-chat|fantrax/);
  assert.match(serviceWorker, /preloaded\|\|await fetch\(event\.request,\{cache:'no-cache'\}\)/);
  assert.doesNotMatch(serviceWorker, /if\(cached\)return cached/);
});
