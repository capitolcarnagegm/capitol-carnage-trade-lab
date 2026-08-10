// Pride Dynasty v6.9 — Teams, Buy/Sell/Hold, dedupe, FA alerts, Fantrax-only
(function () {
  const MY_TEAM = "Capitol Carnage";
  const MY_TEAM_ID = "nsf1b7esmk4b6bgd";
  const LEAGUE_ID = "astbqxhwmk4b6bg9";

  function forceConfig() {
    if (typeof DEFAULT_CONFIG !== "undefined") {
      Object.assign(DEFAULT_CONFIG, {
        leagueName: "Pride Dynasty",
        teamName: MY_TEAM,
        teams: 14,
        salaryCap: 1404,
        superflex: true,
        tep: true,
        idp: true,
        sackPremium: true,
        fantraxLeagueId: LEAGUE_ID,
        fantraxTeamId: MY_TEAM_ID
      });
    }
    if (typeof db !== "undefined" && db.config) {
      Object.assign(db.config, {
        leagueName: "Pride Dynasty",
        teamName: MY_TEAM,
        teams: 14,
        salaryCap: 1404,
        superflex: true,
        tep: true,
        idp: true,
        sackPremium: true
      });
      try { localStorage.setItem("ccgm_db", JSON.stringify(db)); } catch (e) {}
    }
  }

  function hideLock() {
    var lock = document.getElementById("serverAuthLock");
    if (lock) lock.style.display = "none";
  }

  function dedupeAssets() {
    if (typeof db === "undefined" || !Array.isArray(db.assets)) return 0;
    const byKey = new Map();
    const kept = [];
    let removed = 0;
    for (const a of db.assets) {
      const fid = String(a.fantraxId || a.mflId || "").trim();
      const nameKey = String(a.name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const key = fid ? "id:" + fid : "name:" + nameKey + "|" + String(a.pos || "").toUpperCase();
      if (!nameKey && !fid) { kept.push(a); continue; }
      if (byKey.has(key)) {
        const prev = byKey.get(key);
        const score = (x) => {
          let s = 0;
          if (String(x.source || "").toUpperCase().includes("FANTRAX")) s += 10;
          if (x.fantraxId) s += 5;
          if (x.roster && !/free agent|^fa$/i.test(String(x.roster))) s += 3;
          s += Number(x.salary || 0) / 1000;
          s += Number(x.proj || 0) / 10000;
          return s;
        };
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
      console.log("[Pride] Deduped assets, removed", removed);
    }
    return removed;
  }

  function ensureView(id) {
    if (document.getElementById(id)) return;
    const sec = document.createElement("section");
    sec.id = id;
    sec.className = "view";
    const app = document.querySelector(".app") || document.body;
    app.appendChild(sec);
  }

  function patchNav() {
    if (typeof nav !== "function") return;
    window.nav = function () {
      const tabs = [
        ["dashboard", "War Room"],
        ["teams", "Teams"],
        ["myroster", "My Roster"],
        ["buysell", "Buy / Sell / Hold"],
        ["teamanalyzer", "Team Analysis"],
        ["fa", "Free Agents"],
        ["trade", "Trade Lab"],
        ["draft", "Draft & Picks"],
        ["edgefinder", "Edge Finder"],
        ["transactions", "Transactions"],
        ["livecenter", "NFL Live"],
        ["leagueanalyzer", "League Power"],
        ["aigm", "AI GM"],
        ["sync", "Live Sync"],
        ["settings", "Settings"]
      ];
      const navEl = document.getElementById("nav");
      if (!navEl) return;
      navEl.innerHTML = tabs
        .map(([id, l]) => `<button type="button" data-view="${id}" onclick="showView('${id}')">${l}</button>`)
        .join("");
    };
    const origShow = window.showView;
    window.showView = function (id) {
      ensureView("teams");
      ensureView("buysell");
      if (id === "teams") {
        document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
        const el = document.getElementById("teams");
        if (el) el.classList.add("active");
        document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === id));
        localStorage.setItem("ccgm_view", id);
        renderTeamsPage();
        return;
      }
      if (id === "buysell") {
        document.querySelectorAll(".view").forEach((x) => x.classList.remove("active"));
        const el = document.getElementById("buysell");
        if (el) el.classList.add("active");
        document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("active", x.dataset.view === id));
        localStorage.setItem("ccgm_view", id);
        renderBuySellHoldPage();
        return;
      }
      if (typeof origShow === "function") {
        origShow(id);
        if (id === "teamanalyzer") setTimeout(enhanceTeamAnalysis, 50);
        if (id === "dashboard") setTimeout(injectFAAlerts, 80);
        if (id === "fa") setTimeout(markHelpfulFAs, 80);
        if (id === "sync") setTimeout(stripMFLFromSync, 50);
        if (id === "settings") setTimeout(stripMFLFromSettings, 50);
      }
    };
  }

  function allFranchiseNames() {
    const fromMfl = (db.mfl && db.mfl.franchises) || [];
    if (fromMfl.length) return fromMfl.map((f) => f.name).filter(Boolean);
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

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&", "<": "<", ">": ">", '"': """, "'": "&#39;" }[c]));
  }

  function renderTeamsPage() {
    ensureView("teams");
    const root = document.getElementById("teams");
    if (!root) return;
    dedupeAssets();
    const teams = allFranchiseNames();
    const selected = window.__teamsSelected || MY_TEAM;
    window.__teamsSelected = selected;
    const players = teamPlayers(selected).sort((a, b) => {
      const order = { ACTIVE: 0, RESERVE: 1, MINORS: 2, TAXI: 2, INJURED_RESERVE: 3 };
      const sa = String(a.status || a.rosterStatus || "ACTIVE").toUpperCase();
      const sb = String(b.status || b.rosterStatus || "ACTIVE").toUpperCase();
      return (order[sa] ?? 4) - (order[sb] ?? 4) || Number(b.salary || 0) - Number(a.salary || 0);
    });
    const totalSal = players.reduce((s, a) => s + Number(a.salary || 0), 0);
    const byStatus = {};
    players.forEach((a) => {
      const st = String(a.status || "ACTIVE").toUpperCase();
      byStatus[st] = (byStatus[st] || 0) + 1;
    });

    root.innerHTML = `
      <div class="card">
        <div class="sectionhead"><h2>League Teams</h2><span class="pill">FANTRAX LIVE · ${teams.length} TEAMS</span></div>
        <div class="notice"><b>All Pride Dynasty franchises.</b> Data from Fantrax live refresh. Pick a team to inspect the full roster.</div>
        <div class="field" style="margin-top:10px"><label>Franchise</label>
          <select id="teamsSelect" onchange="window.__teamsSelected=this.value;renderTeamsPage()">
            ${teams.map((t) => `<option value="${t.replace(/"/g, """)}" ${t === selected ? "selected" : ""}>${t}${t === MY_TEAM ? " (YOU)" : ""}</option>`).join("")}
          </select>
        </div>
        <div class="grid4" style="margin-top:10px">
          <div class="metric"><b>${players.length}</b><span>Players</span></div>
          <div class="metric"><b>$${totalSal.toFixed(1)}</b><span>Salary used</span></div>
          <div class="metric"><b>$${Math.max(0, 1404 - totalSal).toFixed(1)}</b><span>Est. cap left</span></div>
          <div class="metric"><b>${Object.keys(byStatus).length}</b><span>Status groups</span></div>
        </div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>${esc(selected)}</h2><span class="pill">${players.length} PLAYERS</span></div>
        <div class="tableWrap"><table><thead><tr>
          <th>Player</th><th>Pos</th><th>NFL</th><th>Status</th><th>Salary</th><th>Years</th><th>Proj</th>
        </tr></thead><tbody>
          ${players.length ? players.map((a) => `<tr>
            <td><b>${esc(a.name)}</b></td>
            <td>${esc(a.pos || "")}</td>
            <td>${esc(a.nfl || "")}</td>
            <td>${esc(a.status || "ACTIVE")}</td>
            <td>$${Number(a.salary || 0).toFixed(1)}</td>
            <td>${a.years || "—"}</td>
            <td>${a.proj ? Math.round(a.proj) : "—"}</td>
          </tr>`).join("") : "<tr><td colspan=\"7\">No roster loaded — open Live Sync and refresh Fantrax.</td></tr>"}
        </tbody></table></div>
      </div>
      <div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>All Franchises Snapshot</h2></div>
        <div class="tableWrap"><table><thead><tr><th>Team</th><th>Players</th><th>Salary</th><th></th></tr></thead><tbody>
          ${teams.map((t) => {
            const ps = teamPlayers(t);
            const sal = ps.reduce((s, a) => s + Number(a.salary || 0), 0);
            return `<tr>
              <td><b>${esc(t)}</b>${t === MY_TEAM ? ' <span class="teamBadge">YOU</span>' : ""}</td>
              <td>${ps.length}</td>
              <td>$${sal.toFixed(1)}</td>
              <td><button type="button" class="secondary" onclick="window.__teamsSelected='${String(t).replace(/'/g, "\\'")}';renderTeamsPage()">Open</button></td>
            </tr>`;
          }).join("")}
        </tbody></table></div>
      </div>`;
  }
  window.renderTeamsPage = renderTeamsPage;

  function signalFor(a) {
    if (typeof signal === "function") {
      try { return signal(a); } catch (e) {}
    }
    const mv = typeof modelValue === "function" ? modelValue(a) : Number(a.market || 0);
    const m = Number(a.market || mv || 1);
    const edge = (mv - m) / Math.max(1, m);
    const trend = Number(a.trend || 0);
    if (edge > 0.12 && trend >= 0) return ["BUY", "good"];
    if (edge < -0.12) return ["SELL", "bad"];
    return ["HOLD", "blue"];
  }

  function renderBuySellHoldPage() {
    ensureView("buysell");
    const root = document.getElementById("buysell");
    if (!root) return;
    dedupeAssets();
    const mine = teamPlayers(MY_TEAM);
    const rows = mine.map((a) => {
      const sig = signalFor(a);
      const mv = typeof modelValue === "function" ? modelValue(a) : Number(a.market || 0);
      return { a, sig, mv };
    });
    const buys = rows.filter((r) => String(r.sig[0]).includes("BUY")).sort((x, y) => y.mv - x.mv);
    const sells = rows.filter((r) => /SELL|SHOP/i.test(String(r.sig[0]))).sort((x, y) => y.mv - x.mv);
    const holds = rows.filter((r) => !String(r.sig[0]).includes("BUY") && !/SELL|SHOP/i.test(String(r.sig[0]))).sort((x, y) => y.mv - x.mv);

    function block(title, list, tone) {
      return `<div class="card" style="margin-top:12px">
        <div class="sectionhead"><h2>${title}</h2><span class="pill">${list.length}</span></div>
        ${list.length ? list.map(({ a, sig, mv }) => `
          <div class="gate">
            <span><b>${esc(a.name)}</b> · ${esc(a.pos || "")}<br>
            <span class="small">$${Number(a.salary || 0).toFixed(1)} · Proj ${a.proj ? Math.round(a.proj) : "—"} · Pride ${typeof fmt === "function" ? fmt(mv) : Math.round(mv)}</span></span>
            <b class="${sig[1]}">${esc(sig[0])}</b>
          </div>`).join("") : `<div class="notice">No ${tone} signals on your roster right now.</div>`}
      </div>`;
    }

    root.innerHTML = `
      <div class="card">
        <div class="sectionhead"><h2>Buy / Sell / Hold</h2><span class="pill">${MY_TEAM}</span></div>
        <div class="notice"><b>Your assets only.</b> BUY = undervalued keep/add exposure. SELL/SHOP = price looks rich or fit is weak. HOLD = core or fairly priced.</div>
        <div class="grid3" style="margin-top:10px">
          <div class="metric"><b>${buys.length}</b><span>Buy / hold-strong</span></div>
          <div class="metric"><b>${sells.length}</b><span>Sell / shop</span></div>
          <div class="metric"><b>${holds.length}</b><span>Hold</span></div>
        </div>
      </div>
      ${block("BUY — undervalued / keep exposure", buys, "buy")}
      ${block("SELL / SHOP — move candidates", sells, "sell")}
      ${block("HOLD — core & fair value", holds, "hold")}`;
  }
  window.renderBuySellHoldPage = renderBuySellHoldPage;

  function myNeeds() {
    const positions = ["QB", "RB", "WR", "TE", "DL", "LB", "DB"];
    const needs = [];
    for (const pos of positions) {
      let score = 50;
      if (typeof rosterNeedScore === "function") {
        try { score = rosterNeedScore(MY_TEAM, pos); } catch (e) {}
      } else {
        const count = teamPlayers(MY_TEAM).filter((a) => String(a.pos || "").toUpperCase().includes(pos) || (pos === "DB" && /S|CB|DB/i.test(a.pos || ""))).length;
        score = Math.max(0, 100 - count * 15);
      }
      needs.push({ pos, score });
    }
    return needs.sort((a, b) => b.score - a.score);
  }

  function helpfulFreeAgents(limit) {
    limit = limit || 12;
    let fas = [];
    if (typeof deriveLeagueFreeAgents === "function") {
      try { fas = deriveLeagueFreeAgents(); } catch (e) {}
    }
    if (!fas.length) {
      fas = (db.assets || []).filter((a) => a.type !== "PICK" && /free agent|^fa$/i.test(String(a.roster || "")));
    }
    const needs = myNeeds();
    const needMap = Object.fromEntries(needs.map((n) => [n.pos, n.score]));
    return fas
      .map((a) => {
        const pos = String(a.pos || "").toUpperCase();
        let npos = pos;
        if (/DE|DT|EDGE|DL/.test(pos)) npos = "DL";
        if (/CB|S|DB/.test(pos)) npos = "DB";
        const need = needMap[npos] || needMap[pos] || 0;
        const proj = Number(a.proj || 0);
        const score = need * 0.55 + Math.min(100, proj / 2) * 0.35 + Number(a.role || 50) * 0.1;
        return { a, need, npos, score, proj };
      })
      .filter((x) => x.need >= 40 || x.proj >= 80)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function injectFAAlerts() {
    const dash = document.getElementById("dashboard");
    if (!dash || dash.querySelector("#prideFaAlerts")) return;
    const helpful = helpfulFreeAgents(8);
    if (!helpful.length) return;
    const box = document.createElement("div");
    box.id = "prideFaAlerts";
    box.className = "card";
    box.style.marginTop = "12px";
    box.innerHTML = `
      <div class="sectionhead"><h2>Free Agents Who Can Help You</h2><span class="pill">${helpful.length} MATCHES</span></div>
      <div class="notice"><b>Based on Capitol Carnage positional need + projection.</b> Only players currently unowned in Pride Dynasty.</div>
      ${helpful.map(({ a, need, npos, score, proj }) => `
        <div class="gate">
          <span><b>${esc(a.name)}</b> · ${esc(a.pos || npos)} · ${esc(a.nfl || "")}<br>
          <span class="small">Need ${Math.round(need)}/100 · Proj ${proj ? Math.round(proj) : "—"} · Fit score ${Math.round(score)}</span></span>
          <button type="button" onclick="showView('fa')">Open FA</button>
        </div>`).join("")}`;
    dash.appendChild(box);
  }

  function markHelpfulFAs() {
    const fa = document.getElementById("fa");
    if (!fa || fa.querySelector("#prideFaBanner")) return;
    const helpful = helpfulFreeAgents(5);
    if (!helpful.length) return;
    const banner = document.createElement("div");
    banner.id = "prideFaBanner";
    banner.className = "card";
    banner.style.marginBottom = "12px";
    banner.innerHTML = `<div class="sectionhead"><h2>Helps Capitol Carnage</h2><span class="pill">NEED MATCH</span></div>
      ${helpful.map(({ a, need, proj }) => `<div class="gate"><span><b>${esc(a.name)}</b> · ${esc(a.pos)}</span><span class="small">Need ${Math.round(need)} · Proj ${proj ? Math.round(proj) : "—"}</span></div>`).join("")}`;
    fa.insertBefore(banner, fa.firstChild);
  }

  function enhanceTeamAnalysis() {
    if (!window.teamAnalyzerTeam) window.teamAnalyzerTeam = MY_TEAM;
  }

  function stripMFLFromSync() {
    const root = document.getElementById("sync");
    if (!root) return;
    root.querySelectorAll("h2").forEach((h) => {
      if (/MFL/i.test(h.textContent)) h.textContent = h.textContent.replace(/MFL/gi, "Legacy");
    });
  }
  function stripMFLFromSettings() {
    const root = document.getElementById("settings");
    if (!root) return;
    root.querySelectorAll("h2, .notice, .small").forEach((el) => {
      if (/MFL/i.test(el.textContent || "")) {
        el.innerHTML = (el.innerHTML || "").replace(/MFL/gi, "Fantrax");
      }
    });
  }

  window.initializePrivateVault = async function () {
    hideLock();
    forceConfig();
    try {
      if (typeof startPrivateServices === "function") await startPrivateServices();
    } catch (e) {
      console.warn(e);
      try { if (typeof loadFantraxLive === "function") await loadFantraxLive({ quiet: true }); } catch (err) {}
    }
    dedupeAssets();
    forceConfig();
  };

  if (typeof apiFetch === "function") {
    const _apiFetch = apiFetch;
    window.apiFetch = async function (path, options) {
      const res = await _apiFetch(path, options || {});
      if (res.status === 401) hideLock();
      return res;
    };
  }

  function boot() {
    forceConfig();
    hideLock();
    ensureView("teams");
    ensureView("buysell");
    patchNav();
    if (typeof nav === "function") nav();
    dedupeAssets();
    setTimeout(function () {
      hideLock();
      if (typeof startPrivateServices === "function" && !window.__prideStarted) {
        window.__prideStarted = true;
        startPrivateServices()
          .then(() => {
            dedupeAssets();
            forceConfig();
            if (typeof nav === "function") nav();
          })
          .catch(() => {});
      }
    }, 300);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
