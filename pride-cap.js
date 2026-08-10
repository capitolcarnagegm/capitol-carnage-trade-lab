// Pride Cap Engine — Article IX exact dead money + 5-year projections
// Bylaws (Article IX §6):
//   Dropped player:
//     A. Current year: 100% of salary still hits the cap
//     B. Following year ONLY (no year-3+ dead):
//        2 yrs remaining → 40% of salary
//        3 yrs remaining → 60%
//        4 yrs remaining → 80%
//        5 yrs remaining → 85% (rookie 5-yr extension only)
// Example: $20 × 3 yrs left → Year1 $20, Year2 $12, Year3 $0
// Cap: starts 1100, +5% each March 1 → current ~1404
// Player salaries: +20% each year while under contract (Art X §9)
(function () {
  var MY_TEAM = "Capitol Carnage";
  var CAP_NOW = 1404;
  var CAP_INFLATION = 0.05;
  var SALARY_INFLATION = 0.20;

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function myPlayers() {
    if (typeof db === "undefined" || !Array.isArray(db.assets)) return [];
    return db.assets.filter(function (a) {
      return a.type !== "PICK" && String(a.roster || "") === MY_TEAM;
    });
  }

  function yearsLeft(a) {
    var y = Number(a.years || 0);
    return y > 0 ? Math.min(5, y) : 1;
  }

  function baseSalary(a) {
    return Number(a.salary || 0);
  }

  // Salary in future year offset if kept (20% annual raise)
  function salaryInYear(a, yearOffset) {
    var s = baseSalary(a);
    for (var i = 0; i < yearOffset; i++) s = s * (1 + SALARY_INFLATION);
    return Math.round(s * 100) / 100;
  }

  function capForYear(offset) {
    return Math.round(CAP_NOW * Math.pow(1 + CAP_INFLATION, offset) * 10) / 10;
  }

  // Dead money schedule for a cut (Article IX §6)
  // yearsRemaining = contract years left at moment of cut (includes current)
  function deadSchedule(salary, yearsRemaining) {
    var y = Math.max(1, Number(yearsRemaining) || 1);
    var sal = Number(salary) || 0;
    var cur = sal; // 100% current year
    var next = 0;
    if (y >= 5) next = sal * 0.85;
    else if (y === 4) next = sal * 0.80;
    else if (y === 3) next = sal * 0.60;
    else if (y === 2) next = sal * 0.40;
    // y === 1 → next year 0
    return {
      year0: Math.round(cur * 100) / 100,
      year1: Math.round(next * 100) / 100,
      year2: 0,
      year3: 0,
      year4: 0
    };
  }

  function deadOnCut(a) {
    return deadSchedule(baseSalary(a), yearsLeft(a));
  }

  function baselineProjection() {
    var players = myPlayers();
    var years = [];
    for (var y = 0; y < 5; y++) {
      var active = 0, count = 0;
      players.forEach(function (a) {
        if (yearsLeft(a) > y) {
          active += salaryInYear(a, y);
          count++;
        }
      });
      var cap = capForYear(y);
      years.push({
        label: y === 0 ? "2026 (now)" : String(2026 + y),
        active: Math.round(active * 10) / 10,
        dead: 0,
        total: Math.round(active * 10) / 10,
        cap: cap,
        space: Math.round((cap - active) * 10) / 10,
        players: count
      });
    }
    return years;
  }

  function projectCuts(cutIds) {
    cutIds = cutIds || [];
    var set = {};
    cutIds.forEach(function (id) { set[String(id)] = true; });
    var players = myPlayers();
    var years = [];
    for (var y = 0; y < 5; y++) {
      var active = 0, dead = 0, count = 0;
      players.forEach(function (a) {
        var id = String(a.fantraxId || a.id);
        var isCut = set[id] || set[String(a.id)];
        if (isCut) {
          var sch = deadOnCut(a);
          if (y === 0) dead += sch.year0;
          else if (y === 1) dead += sch.year1;
          // years 2–4: no further dead per bylaws
          return;
        }
        if (yearsLeft(a) > y) {
          active += salaryInYear(a, y);
          count++;
        }
      });
      var cap = capForYear(y);
      var total = active + dead;
      years.push({
        label: y === 0 ? "2026 (now)" : String(2026 + y),
        active: Math.round(active * 10) / 10,
        dead: Math.round(dead * 10) / 10,
        total: Math.round(total * 10) / 10,
        cap: cap,
        space: Math.round((cap - total) * 10) / 10,
        players: count
      });
    }
    return years;
  }

  function projectTrade(giveIds, getAssets) {
    giveIds = giveIds || [];
    getAssets = getAssets || [];
    var giveSet = {};
    giveIds.forEach(function (id) { giveSet[String(id)] = true; });
    var kept = myPlayers().filter(function (a) {
      var id = String(a.fantraxId || a.id);
      return !(giveSet[id] || giveSet[String(a.id)]);
    });
    var roster = kept.concat(getAssets.filter(function (a) { return a && a.type !== "PICK"; }));
    var years = [];
    for (var y = 0; y < 5; y++) {
      var active = 0, count = 0;
      roster.forEach(function (a) {
        var yrs = yearsLeft(a);
        if (yrs > y) {
          active += salaryInYear(a, y);
          count++;
        }
      });
      var cap = capForYear(y);
      years.push({
        label: y === 0 ? "2026 (now)" : String(2026 + y),
        active: Math.round(active * 10) / 10,
        dead: 0,
        total: Math.round(active * 10) / 10,
        cap: cap,
        space: Math.round((cap - active) * 10) / 10,
        players: count
      });
    }
    return years;
  }

  window.PrideCap = {
    CAP_NOW: CAP_NOW,
    deadOnCut: deadOnCut,
    deadSchedule: deadSchedule,
    baselineProjection: baselineProjection,
    projectCuts: projectCuts,
    projectTrade: projectTrade,
    myPlayers: myPlayers,
    salaryInYear: salaryInYear
  };

  function ensureView() {
    if (document.getElementById("caproom")) return;
    var sec = document.createElement("section");
    sec.id = "caproom";
    sec.className = "view";
    (document.querySelector(".app") || document.body).appendChild(sec);
  }

  function patchNav() {
    var navEl = document.getElementById("nav");
    if (!navEl || navEl.querySelector('[data-view="caproom"]')) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.view = "caproom";
    btn.textContent = "Cap / Dead";
    btn.onclick = function () { showView("caproom"); };
    navEl.appendChild(btn);
  }

  window.__capCutIds = window.__capCutIds || [];

  function renderTable(rows, title) {
    return '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>' + esc(title) + '</h2></div>' +
      '<div class="tableWrap"><table><thead><tr><th>Year</th><th>Active</th><th>Dead</th><th>Total</th><th>Cap</th><th>Space</th><th>#</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var sc = r.space >= 0 ? "good" : "bad";
        return '<tr><td><b>' + esc(r.label) + '</b></td><td>$' + r.active.toFixed(1) +
          '</td><td>$' + r.dead.toFixed(1) + '</td><td><b>$' + r.total.toFixed(1) +
          '</b></td><td>$' + r.cap.toFixed(1) + '</td><td class="' + sc + '">$' +
          r.space.toFixed(1) + '</td><td>' + r.players + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  window.renderCapRoom = function () {
    ensureView();
    var root = document.getElementById("caproom");
    if (!root) return;
    var players = myPlayers().slice().sort(function (a, b) {
      return deadOnCut(b).year0 + deadOnCut(b).year1 - (deadOnCut(a).year0 + deadOnCut(a).year1);
    });
    var base = baselineProjection();
    var cutProj = projectCuts(window.__capCutIds);
    var cutSet = {};
    (window.__capCutIds || []).forEach(function (id) { cutSet[String(id)] = true; });

    var rows = players.map(function (a) {
      var id = String(a.fantraxId || a.id);
      var on = !!cutSet[id];
      var sch = deadOnCut(a);
      return '<tr style="' + (on ? 'background:rgba(180,40,40,0.2)' : '') + '">' +
        '<td><input type="checkbox" ' + (on ? 'checked' : '') +
        ' onchange="window.prideCapToggleCut(\'' + id.replace(/'/g, "\\'") + '\')"></td>' +
        '<td><b>' + esc(a.name) + '</b></td><td>' + esc(a.pos || '') +
        '</td><td>$' + baseSalary(a).toFixed(1) + '</td><td>' + yearsLeft(a) +
        '</td><td>$' + sch.year0.toFixed(1) + '</td><td>$' + sch.year1.toFixed(1) + '</td></tr>';
    }).join('');

    root.innerHTML =
      '<div class="card">' +
      '<div class="sectionhead"><h2>Cap Room &amp; Dead Money</h2><span class="pill">ARTICLE IX</span></div>' +
      '<div class="notice"><b>Pride Bylaws Article IX §6 (exact):</b> Drop → <b>100%</b> of salary hits <b>this year</b>. ' +
      'If 2+ years left, <b>only next year</b> takes a second hit: 2yr=40%, 3yr=60%, 4yr=80%, 5yr=85% (rookie ext). ' +
      'No dead in year 3+. Cap +5% each March 1. Kept players +20% salary each year.</div>' +
      '<div class="grid4" style="margin-top:10px">' +
      '<div class="metric"><b>$' + base[0].active.toFixed(1) + '</b><span>Active now</span></div>' +
      '<div class="metric"><b>$' + base[0].space.toFixed(1) + '</b><span>Space now</span></div>' +
      '<div class="metric"><b>$' + cutProj[0].dead.toFixed(1) + '</b><span>Dead this year (cuts)</span></div>' +
      '<div class="metric"><b>$' + cutProj[0].space.toFixed(1) + '</b><span>Space after cuts</span></div>' +
      '</div></div>' +

      renderTable(base, "Baseline — keep everyone (+20% raises, contracts roll off)") +
      renderTable(cutProj, "After selected cuts (Article IX dead)") +

      '<div class="card" style="margin-top:12px">' +
      '<div class="sectionhead"><h2>Simulate cuts</h2><span class="pill">' +
      (window.__capCutIds.length) + ' selected</span></div>' +
      '<div class="actions"><button type="button" class="secondary" onclick="window.__capCutIds=[];window.renderCapRoom()">CLEAR CUTS</button></div>' +
      '<div class="tableWrap" style="margin-top:8px"><table><thead><tr><th></th><th>Player</th><th>Pos</th><th>Sal</th><th>Yrs</th><th>Dead Y1</th><th>Dead Y2</th></tr></thead><tbody>' +
      (rows || '<tr><td colspan=7>No roster — refresh Fantrax on Teams first</td></tr>') +
      '</tbody></table></div></div>';
  };

  window.prideCapToggleCut = function (id) {
    id = String(id);
    var i = window.__capCutIds.indexOf(id);
    if (i >= 0) window.__capCutIds.splice(i, 1);
    else window.__capCutIds.push(id);
    window.renderCapRoom();
  };

  var origShow = window.showView;
  window.showView = function (id) {
    ensureView();
    if (id === "caproom") {
      document.querySelectorAll(".view").forEach(function (x) { x.classList.remove("active"); });
      var el = document.getElementById("caproom");
      if (el) el.classList.add("active");
      document.querySelectorAll("#nav button").forEach(function (x) {
        x.classList.toggle("active", x.dataset.view === id);
      });
      try { localStorage.setItem("ccgm_view", id); } catch (e) {}
      window.renderCapRoom();
      return;
    }
    if (typeof origShow === "function") origShow(id);
  };

  function boot() {
    ensureView();
    patchNav();
    setInterval(patchNav, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
