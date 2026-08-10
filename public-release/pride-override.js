// Pride Dynasty v7.0 — Force full Fantrax league load, Teams+values, Schedule, matchup analysis
(function () {
  const MY_TEAM = "Capitol Carnage";
  const MY_TEAM_ID = "nsf1b7esmk4b6bgd";
  const LEAGUE_ID = "astbqxhwmk4b6bg9";
  const GATEWAY = (typeof AI_GATEWAY_URL !== "undefined" && AI_GATEWAY_URL) || "https://gms-locker-ai.robinharvey001.workers.dev";
  let liveCache = null;

  function forceConfig() {
    if (typeof DEFAULT_CONFIG !== "undefined") {
      Object.assign(DEFAULT_CONFIG, {
        leagueName: "Pride Dynasty", teamName: MY_TEAM, teams: 14, salaryCap: 1404,
        superflex: true, tep: true, idp: true, sackPremium: true,
        fantraxLeagueId: LEAGUE_ID, fantraxTeamId: MY_TEAM_ID
      });
    }
    if (typeof db !== "undefined" && db.config) {
      Object.assign(db.config, {
        leagueName: "Pride Dynasty", teamName: MY_TEAM, teams: 14, salaryCap: 1404,
        superflex: true, tep: true, idp: true, sackPremium: true
      });
    }
  }

  function hideLock() {
    const lock = document.getElementById("serverAuthLock");
    if (lock) lock.style.display = "none";
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]));
  }

  function ensureView(id) {
    if (document.getElementById(id)) return;
    const sec = document.createElement("section");
    sec.id = id;
    sec.className = "view";
    (document.querySelector(".app") || document.body).appendChild(sec);
  }

  async function forceLoadFantraxLeague() {
    forceConfig();
    hideLock();
    let payload;
    try {
      const res = await fetch(GATEWAY + "/fantrax/live", { cache: "no-store" });
      payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "HTTP " + res.status);
    } catch (e) {
      console.warn("[Pride] fantrax/live failed", e);
      return null;
    }
    liveCache = payload;
    const snaps = payload.snapshots || {};
    const players = snaps.players || {};
    const rosterMap = (snaps.rosters && snaps.rosters.rosters) || {};
    const standings = snaps.standings || [];
    if (typeof db === "undefined") return payload;

    const franchises = Object.entries(rosterMap).map(([id, t]) => ({ id, name: t.teamName || id }));
    db.mfl = db.mfl || {};
    db.mfl.franchises = franchises;
    db.mfl.standings = (Array.isArray(standings) ? standings : []).map((s) => ({
      franchise: s.teamName, wins: 0, losses: 0, points: s.totalPointsFor || 0, raw: s
    }));

    const byId = new Map();
    (db.assets || []).forEach((a) => { if (a.fantraxId) byId.set(String(a.fantraxId), a); });
    const rosteredIds = new Set();
    let created = 0, updated = 0;

    for (const [teamId, team] of Object.entries(rosterMap)) {
      const teamName = team.teamName || teamId;
      for (const item of team.rosterItems || []) {
        const id = String(item.id || "");
        if (!id) continue;
        rosteredIds.add(id);
        const p = players[id] || {};
        const name = p.name || id;
        const pos = String(item.position || p.position || "").toUpperCase();
        const salary = Number(item.salary || 0);
        const years = Number(item.contract && (item.contract.smallId || item.contract.name) || 0) || 0;
        const status = item.status || "ACTIVE";
        const nfl = p.team || "";
        let asset = byId.get(id);
        if (!asset) {
          asset = {
            id: "fantrax-" + id, fantraxId: id, name, type: "PLAYER", pos, nfl, age: 0,
            market: Math.max(200, salary * 40), adp: 0, ecr: 0, proj: 0, ppg: 0, role: 55, trend: 0, risk: 40, liquidity: 55,
            salary, years, roster: teamName, status, source: "Fantrax Live",
            sources: { roster: "Fantrax Live", salary: "Fantrax Live", name: "Fantrax Live", pos: "Fantrax Live" }
          };
          db.assets = db.assets || [];
          db.assets.push(asset);
          byId.set(id, asset);
          created++;
        } else {
          asset.fantraxId = id;
          asset.name = name || asset.name;
          asset.pos = pos || asset.pos;
          asset.nfl = nfl || asset.nfl;
          asset.salary = salary;
          asset.years = years || asset.years;
          asset.roster = teamName;
          asset.status = status;
          asset.source = "Fantrax Live";
          asset.sources = asset.sources || {};
          asset.sources.roster = "Fantrax Live";
          asset.sources.salary = "Fantrax Live";
          if (!Number(asset.market) || Number(asset.market) < 50) asset.market = Math.max(200, salary * 40);
          updated++;
        }
      }
    }

    db.fantraxLiveMeta = { configured: true, syncedAt: payload.syncedAt || new Date().toISOString(), teamCount: franchises.length, rosteredCount: rosteredIds.size };
    db.fantraxMatchups = snaps.matchups || null;
    db.fantraxStandings = standings;
    db.config.teams = franchises.length;
    db.config.leagueName = "Pride Dynasty";
    db.config.teamName = MY_TEAM;
    db.lastSync = payload.syncedAt || new Date().toISOString();
    dedupeAssets();
    try { if (typeof persist === "function") persist(); } catch (e) {}
    console.log("[Pride] League loaded:", franchises.length, "teams,", rosteredIds.size, "rostered, +", created, "new,", updated, "updated");
    const health = document.getElementById("buildHealth");
    if (health) health.innerHTML = `<b>GM's Locker v7.0</b> · <span class="good">${franchises.length} teams · ${rosteredIds.size} rostered from Fantrax</span>`;
    return payload;
  }

  function dedupeAssets() {
    if (typeof db === "undefined" || !Array.isArray(db.assets)) return 0;
    const byKey = new Map();
    const kept = [];
    let removed = 0;
    for (const a of db.assets) {
      const fid = String(a.fantraxId || "").trim();
      const nameKey = String(a.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = fid ? "id:" + fid : "name:" + nameKey + "|" + String(a.pos || "").toUpperCase();
      if (!nameKey && !fid) { kept.push(a); continue; }
      if (byKey.has(key)) {
        const prev = byKey.get(key);
        const score = (x) => (x.fantraxId ? 5 : 0) + (Number(x.salary || 0) / 100) + (x.roster && !/free agent/i.test(x.roster) ? 2 : 0);
        if (score(a) > score(prev)) {
          const idx = kept.indexOf(prev);
          if (idx >= 0) kept[idx] = a;
          byKey.set(key, a);
        }
        removed++;
      } else {
        byKey.set(key, a);
        kept.push(a);
      }
    }
    if (removed) {
      db.assets = kept;
      try { if (typeof persist === "function") persist(); } catch (e) {}
    }
    return removed;
  }

  function allTeams() {
    const f = (db.mfl && db.mfl.franchises) || [];
    if (f.length) return f.map((x) => x.name).filter(Boolean).sort((a, b) => a.localeCompare(b));
    const names = new Set();
    (db.assets || []).forEach((a) => {
      if (a.roster && !/free agent|^fa$/i.test(String(a.roster))) names.add(a.roster);
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  function teamPlayers(team) {
    return (db.assets || []).filter(
      (a) => a.type !== "PICK" && String(a.roster || "").toLowerCase() === String(team || "").toLowerCase()
    );
  }

  function prideVal(a) {
    try { if (typeof modelValue === "function") return modelValue(a); } catch (e) {}
    return Number(a.market || 0) || Math.max(100, Number(a.salary || 0) * 40);
  }

  function teamStrength(team) {
    const players = teamPlayers(team);
    const salary = players.reduce((s, a) => s + Number(a.salary || 0), 0);
    const value = players.reduce((s, a) => s + prideVal(a), 0);
    const active = players.filter((a) => /ACTIVE/i.test(String(a.status || "ACTIVE")));
    const byPos = {};
    players.forEach((a) => {
      let p = String(a.pos || "?").toUpperCase();
      if (/DE|DT|EDGE|DL/.test(p)) p = "DL";
      if (/CB|S|DB/.test(p)) p = "DB";
      if (/SFX/.test(p)) p = "QB";
      byPos[p] = (byPos[p] || 0) + prideVal(a);
    });
    return { team, players: players.length, salary, value, active: active.length, byPos };
  }

  function renderTeamsPage() {
    ensureView("teams");
    const root = document.getElementById("teams");
    if (!root) return;
    const teams = allTeams();
    const selected = window.__teamsSelected || MY_TEAM;
    window.__teamsSelected = selected;
    const players = teamPlayers(selected).sort((a, b) => prideVal(b) - prideVal(a) || Number(b.salary || 0) - Number(a.salary || 0));
    const strength = teamStrength(selected);
    const snap = teams.map(teamStrength).sort((a, b) => b.value - a.value);

    root.innerHTML = `
      <div class="card">
        <div class="sectionhead"><h2>League Teams</h2><span class="pill">FANTRAX · ${teams.length} TEAMS</span></div>
        <div class="notice"><b>Full league roster board.</b> Values use Pride model (salary-seeded when market empty). Analyze compares any two teams.</div>
        <div class="actions" style="margin-top:8px">
          <button type="button" onclick="window.prideForceRefresh()">REFRESH ALL ROSTERS FROM FANTRAX</button>
        </div>
        <div class="field" style="margin-top:10px"><label>Team</label>
          <select onchange="window.__teamsSelected=this.value;renderTeamsPage()">
            ${teams.map((t) => `<option value="${esc(t)}" ${t === selected ? "selected" : ""}>${esc(t)}${t === MY_TEAM ? " (YOU)" : ""}</option>`).join("")}
          </select>
        </div>
        <div class="grid4" style="margin-top:10px">
          <div class="metric"><b>${strength.players}</b><span>Players</span></div>
          <div class="metric"><b>$${strength.salary.toFixed(1)}</b><span>Salary</span></div>
          <div class="metric"><b>${Math.round(strength.value).toLocaleString()}</b><span>Roster value</span></div>
          <div class="metric"><b>${strength.active}</b><span>Active</span></div>
        </div>
        <div class="actions" style="margin-top:10px">
          <button type="button" onclick="window.__analyzeA='${String(selected).replace(/'/g, "\\'")}';window.__analyzeB='${MY_TEAM === selected ? (teams.find((t) => t !== MY_TEAM) || "") : MY_TEAM}';showView('matchup')">ANALYZE MATCHUP</button>
          <button type="button" class="secondary" onclick="window.teamAnalyzerTeam='${String(selected).replace(/'/g, "\\'")}';showView('teamanalyzer')">FULL TEAM ANALYSIS</button>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>${esc(selected)} Roster</h2><span class="pill">${players.length}</span></div>
        <div class="tableWrap"><table><thead><tr>
          <th>Player</th><th>Pos</th><th>NFL</th><th>Status</th><th>Salary</th><th>Yrs</th><th>Value</th>
        </tr></thead><tbody>
          ${players.length ? players.map((a) => `<tr>
            <td><b>${esc(a.name)}</b></td><td>${esc(a.pos || "")}</td><td>${esc(a.nfl || "")}</td>
            <td>${esc(a.status || "")}</td><td>$${Number(a.salary || 0).toFixed(1)}</td>
            <td>${a.years || "—"}</td><td><b>${Math.round(prideVal(a)).toLocaleString()}</b></td>
          </tr>`).join("") : "<tr><td colspan=7>No players — tap REFRESH ALL ROSTERS FROM FANTRAX</td></tr>"}
        </tbody></table></div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>Power Snapshot (all teams)</h2></div>
        <div class="tableWrap"><table><thead><tr>
          <th>#</th><th>Team</th><th>Players</th><th>Salary</th><th>Value</th><th></th>
        </tr></thead><tbody>
          ${snap.map((t, i) => `<tr>
            <td><b>${i + 1}</b></td>
            <td><b>${esc(t.team)}</b>${t.team === MY_TEAM ? ' <span class="teamBadge">YOU</span>' : ""}</td>
            <td>${t.players}</td><td>$${t.salary.toFixed(1)}</td>
            <td><b>${Math.round(t.value).toLocaleString()}</b></td>
            <td>
              <button type="button" class="secondary" onclick="window.__teamsSelected='${String(t.team).replace(/'/g, "\\'")}';renderTeamsPage()">Roster</button>
              <button type="button" onclick="window.__analyzeA='${MY_TEAM.replace(/'/g, "\\'")}';window.__analyzeB='${String(t.team).replace(/'/g, "\\'")}';showView('matchup')">Analyze</button>
            </td>
          </tr>`).join("")}
        </tbody></table></div>
      </div>`;
  }
  window.renderTeamsPage = renderTeamsPage;

  function renderMatchupPage() {
    ensureView("matchup");
    const root = document.getElementById("matchup");
    if (!root) return;
    const teams = allTeams();
    const aName = window.__analyzeA || MY_TEAM;
    const bName = window.__analyzeB || teams.find((t) => t !== aName) || teams[0];
    window.__analyzeA = aName;
    window.__analyzeB = bName;
    const A = teamStrength(aName);
    const B = teamStrength(bName);
    const positions = ["QB", "RB", "WR", "TE", "DL", "LB", "DB"];
    const rows = positions.map((p) => {
      const av = A.byPos[p] || 0, bv = B.byPos[p] || 0;
      return { p, av, bv, edge: av - bv };
    });
    root.innerHTML = `
      <div class="card">
        <div class="sectionhead"><h2>Team Matchup Analysis</h2><span class="pill">HEAD TO HEAD</span></div>
        <div class="grid">
          <div class="field"><label>Team A</label>
            <select onchange="window.__analyzeA=this.value;renderMatchupPage()">
              ${teams.map((t) => `<option ${t === aName ? "selected" : ""}>${esc(t)}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Team B</label>
            <select onchange="window.__analyzeB=this.value;renderMatchupPage()">
              ${teams.map((t) => `<option ${t === bName ? "selected" : ""}>${esc(t)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="grid4" style="margin-top:10px">
          <div class="metric"><b>${Math.round(A.value).toLocaleString()}</b><span>${esc(aName)} value</span></div>
          <div class="metric"><b>${Math.round(B.value).toLocaleString()}</b><span>${esc(bName)} value</span></div>
          <div class="metric"><b>$${A.salary.toFixed(0)}</b><span>${esc(aName)} salary</span></div>
          <div class="metric"><b>$${B.salary.toFixed(0)}</b><span>${esc(bName)} salary</span></div>
        </div>
        <div class="notice" style="margin-top:10px">
          <b>Overall edge:</b> ${A.value >= B.value ? esc(aName) : esc(bName)} by ${Math.round(Math.abs(A.value - B.value)).toLocaleString()} Pride value
          · Size ${A.players} vs ${B.players} · Active ${A.active} vs ${B.active}
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>Position Group Values</h2></div>
        ${rows.map((r) => `
          <div class="gate">
            <span><b>${r.p}</b><br><span class="small">${esc(aName)} ${Math.round(r.av).toLocaleString()} · ${esc(bName)} ${Math.round(r.bv).toLocaleString()}</span></span>
            <b class="${r.edge > 0 ? "good" : r.edge < 0 ? "bad" : "muted"}">${r.edge > 0 ? "+" : ""}${Math.round(r.edge).toLocaleString()}</b>
          </div>`).join("")}
      </div>
      <div class="grid" style="margin-top:12px">
        <div class="card"><h2>${esc(aName)} top assets</h2>
          ${teamPlayers(aName).sort((x, y) => prideVal(y) - prideVal(x)).slice(0, 8).map((p) =>
            `<div class="gate"><span><b>${esc(p.name)}</b> · ${esc(p.pos)}</span><b>${Math.round(prideVal(p)).toLocaleString()}</b></div>`
          ).join("")}
        </div>
        <div class="card"><h2>${esc(bName)} top assets</h2>
          ${teamPlayers(bName).sort((x, y) => prideVal(y) - prideVal(x)).slice(0, 8).map((p) =>
            `<div class="gate"><span><b>${esc(p.name)}</b> · ${esc(p.pos)}</span><b>${Math.round(prideVal(p)).toLocaleString()}</b></div>`
          ).join("")}
        </div>
      </div>`;
  }
  window.renderMatchupPage = renderMatchupPage;

  function renderSchedulePage() {
    ensureView("schedule");
    const root = document.getElementById("schedule");
    if (!root) return;
    const mu = db.fantraxMatchups || (liveCache && liveCache.snapshots && liveCache.snapshots.matchups) || {};
    const period = mu.period || 1;
    const games = mu.matchups || [];
    const standings = db.fantraxStandings || [];
    root.innerHTML = `
      <div class="card">
        <div class="sectionhead"><h2>League Schedule</h2><span class="pill">PERIOD ${period}</span></div>
        <div class="notice"><b>Current Fantrax matchups.</b> Your games are highlighted.</div>
        <div class="actions"><button type="button" onclick="window.prideForceRefresh().then(function(){renderSchedulePage()})">REFRESH</button></div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>This Period's Games</h2><span class="pill">${games.length}</span></div>
        ${games.length ? games.map((g) => {
          const home = g.home || {}, away = g.away || {};
          const mine = home.teamName === MY_TEAM || away.teamName === MY_TEAM;
          return `<div class="gate" style="${mine ? "border-color:#d4af37" : ""}">
            <span><b>${esc(away.teamName || "Away")}</b> ${Number(away.score || 0)}
            <span class="small"> @ </span>
            <b>${esc(home.teamName || "Home")}</b> ${Number(home.score || 0)}
            ${mine ? '<br><span class="pill">YOUR GAME</span>' : ""}</span>
            <b class="muted">P${period}</b>
          </div>`;
        }).join("") : '<div class="notice">No matchups loaded. Tap REFRESH.</div>'}
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>Standings</h2></div>
        <div class="tableWrap"><table><thead><tr><th>Rank</th><th>Team</th><th>Record</th><th>PF</th></tr></thead><tbody>
          ${(standings || []).map((s) => `<tr>
            <td><b>${s.rank || ""}</b></td>
            <td><b>${esc(s.teamName)}</b>${s.teamName === MY_TEAM ? ' <span class="teamBadge">YOU</span>' : ""}</td>
            <td>${esc(s.points || "0-0-0")}</td>
            <td>${Number(s.totalPointsFor || 0).toFixed(1)}</td>
          </tr>`).join("") || "<tr><td colspan=4>Standings after refresh</td></tr>"}
        </tbody></table></div>
      </div>`;
  }
  window.renderSchedulePage = renderSchedulePage;

  function patchNav() {
    window.nav = function () {
      const tabs = [
        ["dashboard", "War Room"], ["teams", "Teams"], ["matchup", "Matchup"], ["schedule", "Schedule"],
        ["myroster", "My Roster"], ["buysell", "Buy / Sell / Hold"], ["teamanalyzer", "Team Analysis"],
        ["fa", "Free Agents"], ["trade", "Trade Lab"], ["draft", "Draft & Picks"], ["edgefinder", "Edge Finder"],
        ["transactions", "Transactions"], ["livecenter", "NFL Live"], ["leagueanalyzer", "League Power"],
        ["aigm", "AI GM"], ["sync", "Live Sync"], ["settings", "Settings"]
      ];
      const navEl = document.getElementById("nav");
      if (!navEl) return;
      navEl.innerHTML = tabs.map(([id, l]) => `<button type="button" data-view="${id}" onclick="showView('${id}')">${l}</button>`).join("");
    };
    const origShow = window.showView;
    window.showView = function (id) {
      ["teams", "matchup", "schedule", "buysell"].forEach(ensureView);
      const custom = { teams: renderTeamsPage, matchup: renderMatchupPage, schedule: renderSchedulePage };
      if (custom[id]) {
        document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
        const el = document.getElementById(id);
        if (el) el.classList.add("active");
        document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === id));
        localStorage.setItem("ccgm_view", id);
        custom[id]();
        return;
      }
      if (typeof origShow === "function") origShow(id);
    };
  }

  window.prideForceRefresh = async function () {
    const health = document.getElementById("buildHealth");
    if (health) health.innerHTML = `<b>GM's Locker</b> · Refreshing Fantrax…`;
    try { await fetch(GATEWAY + "/fantrax/sync", { method: "POST", cache: "no-store" }); } catch (e) {}
    await forceLoadFantraxLeague();
    const view = localStorage.getItem("ccgm_view") || "teams";
    if (typeof showView === "function") showView(view);
    else renderTeamsPage();
  };

  window.initializePrivateVault = async function () {
    hideLock();
    forceConfig();
    await forceLoadFantraxLeague();
    try { if (typeof startPrivateServices === "function") await startPrivateServices(); } catch (e) {}
    dedupeAssets();
  };

  function boot() {
    forceConfig();
    hideLock();
    ["teams", "matchup", "schedule", "buysell"].forEach(ensureView);
    patchNav();
    if (typeof nav === "function") nav();
    forceLoadFantraxLeague().then(() => {
      if (typeof nav === "function") nav();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
