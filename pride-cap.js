// Pride Cap Engine — dead money + 5-year move projections (gmslocker.com)
// Bylaw model (adjust when exact clause differs):
// - Current salary cap: $1404
// - Cap inflates ~5%/yr for projection
// - Contract years on Fantrax = remaining years including this season
// - Cut before March 1 window: dead = remaining salary after this year (years-1)*salary
// - Cut after / mid-season style: dead = full remaining years * salary (accelerated)
// - Dead hits the year of the cut (not spread) unless BYLAW_SPREAD is true
(function () {
  var MY_TEAM = "Capitol Carnage";
  var CAP_NOW = 1404;
  var CAP_INFLATION = 0.05;
  var BYLAW_SPREAD = false; // set true if dead is prorated across remaining years
  var MARCH1_SOFT = true;   // soft cuts leave current-year salary as paid, residual as dead

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
    return y > 0 ? y : 1;
  }

  function salary(a) {
    return Number(a.salary || 0);
  }

  // Remaining obligation if kept for full contract
  function remainingObligation(a) {
    return salary(a) * yearsLeft(a);
  }

  // Dead money if cut now (March 1 soft window assumed for planning)
  function deadOnCut(a, mode) {
    mode = mode || (MARCH1_SOFT ? "march1" : "full");
    var sal = salary(a);
    var yrs = yearsLeft(a);
    if (mode === "march1") {
      // This year already budgeted / paid → dead is residual years
      return Math.max(0, sal * Math.max(0, yrs - 1));
    }
    // Full acceleration of remaining contract
    return sal * yrs;
  }

  function capForYear(offset) {
    return Math.round(CAP_NOW * Math.pow(1 + CAP_INFLATION, offset) * 10) / 10;
  }

  // Baseline 5-year projection if roster unchanged (contracts roll off)
  function baselineProjection() {
    var players = myPlayers();
    var years = [];
    for (var y = 0; y < 5; y++) {
      var active = 0;
      var count = 0;
      players.forEach(function (a) {
        if (yearsLeft(a) > y) {
          active += salary(a);
          count++;
        }
      });
      var cap = capForYear(y);
      years.push({
        year: 2026 + y,
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

  // Project after cutting a set of player ids (fantrax or asset id)
  function projectCuts(cutIds, mode) {
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
          if (y === 0) {
            // Dead hits year of cut
            var d = deadOnCut(a, mode);
            if (BYLAW_SPREAD) {
              var residualYrs = Math.max(1, yearsLeft(a) - (MARCH1_SOFT ? 1 : 0));
              dead += d / residualYrs;
            } else {
              dead += d;
            }
          } else if (BYLAW_SPREAD) {
            var residualYrs2 = Math.max(1, yearsLeft(a) - (MARCH1_SOFT ? 1 : 0));
            if (y < residualYrs2) dead += deadOnCut(a, mode) / residualYrs2;
          }
          // cut players do not count as active in any year
          return;
        }
        if (yearsLeft(a) > y) {
          active += salary(a);
          count++;
        }
      });
      var cap = capForYear(y);
      var total = active + dead;
      years.push({
        year: 2026 + y,
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

  // Trade: give away players (and their future salary), receive players (and theirs)
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
        if (yearsLeft(a) > y) {
          active += salary(a);
          count++;
        }
      });
      var cap = capForYear(y);
      years.push({
        year: 2026 + y,
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
    baselineProjection: baselineProjection,
    projectCuts: projectCuts,
    projectTrade: projectTrade,
    remainingObligation: remainingObligation,
    myPlayers: myPlayers
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
      '<div class="tableWrap"><table><thead><tr><th>Year</th><th>Active</th><th>Dead</th><th>Total</th><th>Cap</th><th>Space</th><th>Players</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var spaceClass = r.space >= 0 ? "good" : "bad";
        return '<tr><td><b>' + esc(r.label) + '</b></td><td>$' + r.active.toFixed(1) +
          '</td><td>$' + r.dead.toFixed(1) + '</td><td><b>$' + r.total.toFixed(1) +
          '</b></td><td>$' + r.cap.toFixed(1) + '</td><td class="' + spaceClass + '">$' +
          r.space.toFixed(1) + '</td><td>' + r.players + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  window.renderCapRoom = function () {
    ensureView();
    var root = document.getElementById("caproom");
    if (!root) return;
    var players = myPlayers().slice().sort(function (a, b) {
      return deadOnCut(b) - deadOnCut(a);
    });
    var base = baselineProjection();
    var cutProj = projectCuts(window.__capCutIds, "march1");

    var cutSet = {};
    (window.__capCutIds || []).forEach(function (id) { cutSet[String(id)] = true; });

    var rows = players.map(function (a) {
      var id = String(a.fantraxId || a.id);
      var on = !!cutSet[id];
      return '<tr style="' + (on ? 'background:rgba(180,40,40,0.2)' : '') + '">' +
        '<td><input type="checkbox" ' + (on ? 'checked' : '') +
        ' onchange="window.prideCapToggleCut(\'' + id.replace(/'/g, "\\'") + '\')"></td>' +
        '<td><b>' + esc(a.name) + '</b></td><td>' + esc(a.pos || '') +
        '</td><td>$' + salary(a).toFixed(1) + '</td><td>' + yearsLeft(a) +
        '</td><td>$' + remainingObligation(a).toFixed(1) +
        '</td><td><b>$' + deadOnCut(a, "march1").toFixed(1) + '</b></td></tr>';
    }).join('');

    root.innerHTML =
      '<div class="card">' +
      '<div class="sectionhead"><h2>Cap Room &amp; Dead Money</h2><span class="pill">5-YEAR</span></div>' +
      '<div class="notice"><b>Pride model:</b> Cap starts $' + CAP_NOW +
      ', +5%/yr for planning. March 1-style cut → dead = residual years × salary (this year not double-counted). ' +
      'Check players to simulate cuts. Exact bylaw % can be tightened if your clause differs.</div>' +
      '<div class="grid4" style="margin-top:10px">' +
      '<div class="metric"><b>$' + base[0].active.toFixed(1) + '</b><span>Active now</span></div>' +
      '<div class="metric"><b>$' + base[0].space.toFixed(1) + '</b><span>Space now</span></div>' +
      '<div class="metric"><b>$' + cutProj[0].dead.toFixed(1) + '</b><span>Dead if cuts</span></div>' +
      '<div class="metric"><b>$' + cutProj[0].space.toFixed(1) + '</b><span>Space after cuts</span></div>' +
      '</div></div>' +

      renderTable(base, "Baseline — keep everyone (contracts roll off)") +
      renderTable(cutProj, "After selected cuts (March 1 dead model)") +

      '<div class="card" style="margin-top:12px">' +
      '<div class="sectionhead"><h2>Simulate cuts</h2><span class="pill">' +
      (window.__capCutIds.length) + ' selected</span></div>' +
      '<div class="actions"><button type="button" class="secondary" onclick="window.__capCutIds=[];window.renderCapRoom()">CLEAR CUTS</button></div>' +
      '<div class="tableWrap" style="margin-top:8px"><table><thead><tr><th></th><th>Player</th><th>Pos</th><th>Sal</th><th>Yrs</th><th>Remain $</th><th>Dead if cut</th></tr></thead><tbody>' +
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
