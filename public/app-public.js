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
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
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
    `<option value="${esc(t.id)}" ${String(t.id) === String(mine?.id) ? "selected" : ""}>${esc(t.name)} (${t.players?.length || 0})</option>`
  ).join("");
  return `<div class="field team-picker"><label>Team</label><select id="teamSelect">${opts}</select></div>`;
}

function viewNow() {
  const mine = myTeam();
  const groups = groupPlayers(mine?.players || []);
  const active = (mine?.players || []).filter((p) => /ACTIVE/i.test(p.rosterSlot || "")).length;
  const capUsed = (mine?.players || []).reduce((s, p) => s + (Number(p.salary) || 0), 0);
  return `
    <div class="card war-hero">
      <div class="sectionhead">
        <div>
          <div class="kicker">WAR ROOM</div>
          <h2>${esc(mine?.name || "Pride Dynasty")}</h2>
          <p class="muted">Live Fantrax · read-only · no login</p>
        </div>
        <span class="pill">${state.asOf ? "LIVE" : "CONNECTING"}</span>
      </div>
      <div class="grid3">
        <div class="metric"><span>Roster</span><b>${mine?.players?.length || 0}</b><small>${active} active</small></div>
        <div class="metric"><span>Salary on roster</span><b>${money(capUsed)}</b><small>live contracts</small></div>
        <div class="metric"><span>League teams</span><b>${teamList().length}</b><small>${esc(state.league?.leagueName || "Pride")}</small></div>
      </div>
      ${teamPicker()}
    </div>
    <div class="card">
      <div class="sectionhead"><h3>Roster board</h3><span class="muted">${mine?.players?.length || 0} players</span></div>
      ${groups.map((g) => `
        <div class="roster-group">
          <div class="group-head">${esc(g.label)} · ${g.players.length}</div>
          ${g.players.map(playerCard).join("")}
        </div>`).join("") || '<p class="muted">No roster rows yet. Hit Refresh League.</p>'}
    </div>`;
}

function viewTeam() {
  const mine = myTeam();
  const groups = groupPlayers(mine?.players || []);
  return `
    <div class="card">
      <div class="sectionhead"><div><h2>${esc(mine?.name || "My Team")}</h2><p class="muted">Full Pride roster</p></div></div>
      ${teamPicker()}
      ${groups.map((g) => `
        <div class="roster-group">
          <div class="group-head">${esc(g.label)}</div>
          ${g.players.map(playerCard).join("")}
        </div>`).join("") || '<p class="muted">No players.</p>'}
    </div>`;
}

function viewLeagues() {
  return `
    <div class="card">
      <h2>Pride Dynasty</h2>
      <p class="muted">League ${esc(LEAGUE_ID)} · ${teamList().length} teams</p>
      ${teamList().map((t) => {
        const cap = (t.players || []).reduce((s, p) => s + (Number(p.salary) || 0), 0);
        return `<div class="gate team-row" data-team="${esc(t.id)}">
          <span><b>${esc(t.name)}</b><br><span class="muted">${t.players?.length || 0} players</span></span>
          <span class="muted">${money(cap)}</span>
        </div>`;
      }).join("")}
    </div>`;
}

function viewGames() {
  const games = state.schedule || [];
  if (!games.length) return `<div class="card"><h2>Game Day</h2><p class="muted">No schedule loaded yet.</p></div>`;
  return `
    <div class="card">
      <div class="sectionhead"><h2>Game Day</h2><span class="pill">NFL</span></div>
      ${games.slice(0, 24).map((g) => `
        <div class="gate">
          <span>
            <b>${esc(g.away?.abbreviation || g.away?.name || "TBD")} @ ${esc(g.home?.abbreviation || g.home?.name || "TBD")}</b>
            <br><span class="muted">${esc(g.status || "Scheduled")}${g.date ? " · " + new Date(g.date).toLocaleString() : ""}</span>
          </span>
          <span class="muted">${g.away?.score != null || g.home?.score != null ? `${esc(g.away?.score ?? "—")}–${esc(g.home?.score ?? "—")}` : "—"}</span>
        </div>`).join("")}
    </div>`;
}

function viewIntel() {
  const articles = state.news || [];
  return `
    <div class="card">
      <div class="sectionhead"><h2>Intel</h2><span class="pill">NFL NEWS</span></div>
      ${articles.length ? articles.slice(0, 20).map((a) => `
        <div class="gate">
          <span>
            <b>${esc(a.headline || a.title || "Story")}</b>
            <br><span class="muted">${esc(a.description || "").slice(0, 140)}</span>
          </span>
          ${a.link ? `<a class="pill" href="${esc(a.link)}" target="_blank" rel="noopener">Open</a>` : ""}
        </div>`).join("") : '<p class="muted">News feed empty right now.</p>'}
    </div>`;
}

function viewPlaceholder(title, copy) {
  return `<div class="card"><h2>${esc(title)}</h2><p class="muted">${esc(copy)}</p></div>`;
}

function render() {
  const main = document.getElementById("main");
  const asof = document.getElementById("asof");
  if (asof) {
    asof.textContent = state.loading
      ? "Refreshing…"
      : state.asOf
        ? "Updated " + new Date(state.asOf).toLocaleTimeString()
        : "Not synced";
  }
  document.querySelectorAll("#nav button[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === state.view);
  });

  let body = state.error ? `<div class="error-banner"><b>Live data:</b> ${esc(state.error)}</div>` : "";
  const views = {
    now: viewNow,
    team: viewTeam,
    leagues: viewLeagues,
    games: viewGames,
    buzz: viewIntel,
    lineup: () => viewPlaceholder("Lineup", "Optimal lineup uses live projections once the full analysis pipeline is reattached. Roster data is live now."),
    trade: () => viewPlaceholder("Trade Lab", "Trade stress tests return with the full analysis engine. Live rosters are already available in War Room / My Team."),
    waivers: () => viewPlaceholder("Waiver Edge", "Free-agent recommendations attach after FA pool enrichment is restored."),
    rankings: () => viewPlaceholder("Rankings", "Six-pillar power rankings attach after the analysis endpoint is public again."),
    chat: () => viewPlaceholder("GM Chat", "Chat stays offline until the AI advisor path is re-enabled on the public build.")
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
