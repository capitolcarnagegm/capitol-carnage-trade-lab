const API = "https://api.gmslocker.com";
const LEAGUE_ID = "astbqxhwmk4b6bg9";

const state = {
  league: null,
  teams: [],
  selectedTeamId: null,
  view: "now",
  loading: false,
  error: null,
  asOf: null,
  schedule: [],
  news: []
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;"
}[c]));

const money = (n) => {
  if (n == null || n === "") return "—";
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return "$" + (Math.round(v * 100) / 100).toLocaleString();
};

async function get(path) {
  const r = await fetch(API + path, { cache: "no-store", headers: { Accept: "application/json" } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || d.error || `HTTP ${r.status}`);
  return d;
}

function teamList() { return state.teams || []; }

function myTeam() {
  if (state.selectedTeamId) {
    return teamList().find((t) => String(t.id) === String(state.selectedTeamId)) || null;
  }
  return teamList().find((t) => /capitol carnage/i.test(t.name || "")) || teamList()[0] || null;
}

function slotLabel(slot) {
  const s = String(slot || "").toUpperCase();
  if (s.includes("ACTIVE")) return "Active";
  if (s.includes("RESERVE") || s.includes("BENCH")) return "Reserve";
  if (s.includes("INJURED") || s === "IR") return "IR";
  if (s.includes("MINOR") || s.includes("TAXI")) return "Taxi";
  return slot || "Roster";
}

function playerCard(p) {
  const slot = slotLabel(p.rosterSlot);
  return `
    <div class="player-row">
      <div class="player-main">
        <div class="player-name">${esc(p.name || "Unknown")}</div>
        <div class="player-meta">
          <span class="pos">${esc(p.position || "—")}</span>
          ${p.nflTeam ? `<span class="team">${esc(p.nflTeam)}</span>` : ""}
          <span class="slot">${esc(slot)}</span>
        </div>
      </div>
      <div class="player-side">
        <div class="salary">${money(p.salary)}</div>
        <div class="contract muted">${p.contract != null ? esc(String(p.contract)) + " yr" : "—"}</div>
      </div>
    </div>`;
}

function groupPlayers(players) {
  const order = ["ACTIVE", "RESERVE", "INJURED", "MINORS", "OTHER"];
  const buckets = { ACTIVE: [], RESERVE: [], INJURED: [], MINORS: [], OTHER: [] };
  for (const p of players || []) {
    const s = String(p.rosterSlot || "").toUpperCase();
    if (s.includes("ACTIVE")) buckets.ACTIVE.push(p);
    else if (s.includes("RESERVE") || s.includes("BENCH")) buckets.RESERVE.push(p);
    else if (s.includes("INJURED") || s === "IR") buckets.INJURED.push(p);
    else if (s.includes("MINOR") || s.includes("TAXI")) buckets.MINORS.push(p);
    else buckets.OTHER.push(p);
  }
  return order.filter((k) => buckets[k].length).map((k) => ({ key: k, label: slotLabel(k), players: buckets[k] }));
}

function teamPicker() {
  const mine = myTeam();
  const opts = teamList().map((t) =>
    `<option value="${esc(t.id)}" ${String(t.id) === String(mine?.id) ? "selected" : ""}>${esc(t.name)}</option>`
  ).join("");
  return `<select id="teamSelect">${opts}</select>`;
}

function viewPlaceholder(title, msg) {
  return `<div class="card"><h2>${esc(title)}</h2><p class="muted">${esc(msg)}</p></div>`;
}

function viewNow() {
  const t = myTeam();
  const count = t?.players?.length || 0;
  return `
    <div class="card">
      <div class="sectionhead"><h2>${esc(t?.name || "Team")}</h2><span class="pill">LIVE</span></div>
      <p>${count} live Fantrax roster entries.</p>
      <p class="muted">Public read-only Pride sync. Cap and scoring analysis expand when projection inputs are present.</p>
      ${teamPicker()}
    </div>`;
}

function viewTeam() {
  const t = myTeam();
  if (!t) return viewPlaceholder("My Team", "No team selected.");
  const groups = groupPlayers(t.players);
  return `
    <div class="card">
      <div class="sectionhead"><h2>${esc(t.name)}</h2><span class="pill">${(t.players || []).length} players</span></div>
      ${teamPicker()}
      ${groups.map((g) => `
        <div class="roster-group">
          <h3>${esc(g.label)} · ${g.players.length}</h3>
          ${g.players.map(playerCard).join("")}
        </div>`).join("")}
    </div>`;
}

function viewGames() {
  const games = state.schedule || [];
  if (!games.length) return `<div class="card"><h2>Game Day</h2><p class="muted">No schedule loaded yet.</p></div>`;
  return `<div class="card"><div class="sectionhead"><h2>Game Day</h2><span class="pill">${games.length} games</span></div>
    ${games.slice(0, 24).map((g) => `
      <div class="player-row">
        <div class="player-main">
          <div class="player-name">${esc(g.away?.abbreviation || g.away?.name || "?")} @ ${esc(g.home?.abbreviation || g.home?.name || "?")}</div>
          <div class="player-meta"><span class="slot">${esc(g.status || "")}</span><span class="team">${esc(g.venue || "")}</span></div>
        </div>
        <div class="player-side"><div class="salary">${esc(g.away?.score ?? "-")} – ${esc(g.home?.score ?? "-")}</div></div>
      </div>`).join("")}
  </div>`;
}

function viewBuzz() {
  const arts = state.news || [];
  if (!arts.length) return `<div class="card"><h2>Intel</h2><p class="muted">No news loaded.</p></div>`;
  return `<div class="card"><div class="sectionhead"><h2>Intel</h2><span class="pill">${arts.length}</span></div>
    ${arts.slice(0, 20).map((a) => `
      <div class="player-row">
        <div class="player-main">
          <div class="player-name">${esc(a.headline || "")}</div>
          <div class="player-meta"><span class="slot">${esc(a.published || "")}</span></div>
        </div>
      </div>`).join("")}
  </div>`;
}

function viewLeagues() {
  const rows = teamList().map((t) => `
    <div class="team-row" data-team="${esc(t.id)}">
      <strong>${esc(t.name)}</strong>
      <span class="muted">${(t.players || []).length} players · cap ${money(t.salaryCap)}</span>
    </div>`).join("");
  return `<div class="card"><h2>League</h2>${rows || "<p class=\"muted\">No teams</p>"}</div>`;
}

function render() {
  const main = document.getElementById("main");
  const asof = document.getElementById("asof");
  if (asof) asof.textContent = state.asOf ? `Updated ${new Date(state.asOf).toLocaleTimeString()}` : (state.loading ? "Loading…" : "");
  document.querySelectorAll("#nav button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === state.view);
  });
  let body = "";
  if (state.error) body += `<div class="error-banner">${esc(state.error)}</div>`;
  const views = {
    now: viewNow,
    team: viewTeam,
    games: viewGames,
    buzz: viewBuzz,
    leagues: viewLeagues,
    lineup: () => {
      const t = myTeam();
      if (!t) return `<div class="card"><h2>Lineup</h2><p class="muted">No team selected.</p></div>`;
      const active = (t.players || []).filter(p => String(p.rosterSlot || "").toUpperCase().includes("ACTIVE"));
      const byPos = {};
      for (const p of active) {
        const pos = String(p.position || "FLEX").toUpperCase();
        (byPos[pos] ||= []).push(p);
      }
      const order = ["QB","RB","WR","TE","RWT","LB","DL","DB","DE","DT","S","CB","K","FLEX"];
      const keys = [...order.filter(k => byPos[k]), ...Object.keys(byPos).filter(k => !order.includes(k))];
      return `<div class="card"><div class="sectionhead"><h2>Lineup · ${esc(t.name)}</h2><span class="pill">${active.length} ACTIVE</span></div>
        <p class="muted">Live Fantrax active roster. Full optimizer + projections attach when scoring inputs are available.</p>
        ${keys.map(pos => `<div class="roster-group"><h3>${esc(pos)}</h3>${byPos[pos].map(playerCard).join("")}</div>`).join("") || `<p class="muted">No ACTIVE players found.</p>`}
      </div>`;
    },
    trade: () => viewPlaceholder("Trade Lab", "Trade analyzer returns with the full analysis worker. Rosters are live for evaluation now."),
    waivers: () => viewPlaceholder("Waiver Edge", "Team-specific FA recommendations need the analysis engine + free-agent pool enrichment."),
    rankings: () => viewPlaceholder("Rankings", "Six-pillar power rankings attach after scoring inputs are available on this public build.")
  };
  body += (views[state.view] || viewNow)();
  if (main) main.innerHTML = body;

  const select = document.getElementById("teamSelect");
  if (select) {
    select.onchange = () => {
      state.selectedTeamId = select.value;
      render();
    };
  }
  document.querySelectorAll(".team-row[data-team]").forEach((row) => {
    row.style.cursor = "pointer";
    row.onclick = () => {
      state.selectedTeamId = row.getAttribute("data-team");
      state.view = "team";
      render();
    };
  });
}

async function sync() {
  state.loading = true;
  state.error = null;
  render();
  try {
    const [league, games, news] = await Promise.all([
      get("/public/pride-league"),
      get("/current-games").catch(() => ({ schedule: [] })),
      get("/news").catch(() => ({ articles: [] }))
    ]);
    if (!league.ok) throw new Error(league.detail || league.error || "League sync failed");
    state.league = league;
    state.teams = league.teams || [];
    state.asOf = league.syncedAt || new Date().toISOString();
    state.schedule = games.schedule || games.games || [];
    state.news = news.articles || [];
    if (!state.selectedTeamId) {
      const mine = state.teams.find((t) => /capitol carnage/i.test(t.name || ""));
      state.selectedTeamId = mine?.id || state.teams[0]?.id || null;
    }
  } catch (e) {
    state.error = String(e.message || e);
  } finally {
    state.loading = false;
    render();
  }
}

window.GMS = {
  sync,
  show(v) { state.view = v; render(); }
};

document.getElementById("syncBtn")?.addEventListener("click", sync);
document.querySelectorAll("#nav button[data-view]").forEach((b) => {
  b.addEventListener("click", () => GMS.show(b.dataset.view));
});
sync();
