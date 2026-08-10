// NFL News Feed — all teams + filter
(function () {
  var GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";
  var TEAMS = [
    { id: "", name: "All NFL" },
    { id: "1", name: "ATL" }, { id: "2", name: "BUF" }, { id: "3", name: "CHI" }, { id: "4", name: "CIN" },
    { id: "5", name: "CLE" }, { id: "6", name: "DAL" }, { id: "7", name: "DEN" }, { id: "8", name: "DET" },
    { id: "9", name: "GB" }, { id: "10", name: "TEN" }, { id: "11", name: "IND" }, { id: "12", name: "KC" },
    { id: "13", name: "LV" }, { id: "14", name: "LAR" }, { id: "15", name: "MIA" }, { id: "16", name: "MIN" },
    { id: "17", name: "NE" }, { id: "18", name: "NO" }, { id: "19", name: "NYG" }, { id: "20", name: "NYJ" },
    { id: "21", name: "PHI" }, { id: "22", name: "ARI" }, { id: "23", name: "PIT" }, { id: "24", name: "LAC" },
    { id: "25", name: "SF" }, { id: "26", name: "SEA" }, { id: "27", name: "TB" }, { id: "28", name: "WSH" },
    { id: "29", name: "CAR" }, { id: "30", name: "JAX" }, { id: "33", name: "BAL" }, { id: "34", name: "HOU" }
  ];

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function ensureView() {
    if (document.getElementById("newsfeed")) return;
    var sec = document.createElement("section");
    sec.id = "newsfeed";
    sec.className = "view";
    (document.querySelector(".app") || document.body).appendChild(sec);
  }

  function patchNav() {
    var navEl = document.getElementById("nav");
    if (!navEl) return;
    if (navEl.querySelector('[data-view="newsfeed"]')) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.view = "newsfeed";
    btn.textContent = "NFL News";
    btn.onclick = function () { showView("newsfeed"); };
    // insert after Schedule or near top
    var after = navEl.querySelector('[data-view="schedule"]') || navEl.querySelector('[data-view="livecenter"]');
    if (after && after.nextSibling) navEl.insertBefore(btn, after.nextSibling);
    else navEl.appendChild(btn);
  }

  window.renderNewsFeed = async function () {
    ensureView();
    var root = document.getElementById("newsfeed");
    if (!root) return;
    var team = window.__newsTeam || "";
    root.innerHTML =
      '<div class="card"><div class="sectionhead"><h2>NFL News Feed</h2><span class="pill">LIVE ESPN</span></div>' +
      '<div class="notice"><b>All 32 teams.</b> Filter by team or scan league-wide buzz for waiver and trade edges.</div>' +
      '<div class="field" style="margin-top:10px"><label>Team filter</label><select id="newsTeamSelect">' +
      TEAMS.map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === team ? " selected" : "") + '>' + esc(t.name) + "</option>";
      }).join("") +
      '</select></div>' +
      '<div class="actions" style="margin-top:8px"><button type="button" onclick="window.prideLoadNews()">REFRESH NEWS</button></div>' +
      '<div id="newsList" style="margin-top:12px"><div class="notice">Loading news…</div></div></div>';

    var sel = document.getElementById("newsTeamSelect");
    if (sel) sel.onchange = function () {
      window.__newsTeam = this.value;
      window.prideLoadNews();
    };
    await window.prideLoadNews();
  };

  window.prideLoadNews = async function () {
    var list = document.getElementById("newsList");
    if (!list) return;
    list.innerHTML = '<div class="notice">Loading…</div>';
    try {
      var team = window.__newsTeam || "";
      var url = GATEWAY + "/sports/news?limit=50" + (team ? "&team=" + encodeURIComponent(team) : "");
      var res = await fetch(url, { cache: "no-store" });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
      var arts = data.articles || [];
      if (!arts.length) {
        list.innerHTML = '<div class="notice">No articles right now.</div>';
        return;
      }
      list.innerHTML = arts.map(function (a) {
        var teams = (a.teams || []).map(function (t) { return t.abbr || t.name; }).filter(Boolean).join(" · ");
        var when = a.published ? new Date(a.published).toLocaleString() : "";
        return '<div class="gate" style="align-items:flex-start">' +
          '<span style="flex:1"><b>' + esc(a.headline) + '</b><br>' +
          '<span class="small">' + esc(a.description || "") + '</span><br>' +
          '<span class="small muted">' + esc(when) + (teams ? " · " + esc(teams) : "") +
          (a.byline ? " · " + esc(a.byline) : "") + '</span></span>' +
          (a.link ? '<a class="secondary" href="' + esc(a.link) + '" target="_blank" rel="noopener" style="padding:8px 12px;border:1px solid #6b5720;border-radius:8px;color:#f1cf62;text-decoration:none">Open</a>' : '') +
          '</div>';
      }).join("");
    } catch (e) {
      list.innerHTML = '<div class="notice"><b>News failed.</b> ' + esc(e.message || e) +
        ' Deploy worker v8, then refresh.</div>';
    }
  };

  var origShow = window.showView;
  window.showView = function (id) {
    ensureView();
    if (id === "newsfeed") {
      document.querySelectorAll(".view").forEach(function (x) { x.classList.remove("active"); });
      var el = document.getElementById("newsfeed");
      if (el) el.classList.add("active");
      document.querySelectorAll("#nav button").forEach(function (x) {
        x.classList.toggle("active", x.dataset.view === id);
      });
      try { localStorage.setItem("ccgm_view", id); } catch (e) {}
      window.renderNewsFeed();
      return;
    }
    if (typeof origShow === "function") origShow(id);
  };

  function boot() {
    ensureView();
    patchNav();
    setTimeout(patchNav, 1000);
    setInterval(patchNav, 5000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
