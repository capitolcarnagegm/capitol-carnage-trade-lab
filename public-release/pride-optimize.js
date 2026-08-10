// Optimize lineup + apply Fantrax projections on client
(function () {
  var GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";
  var MY_TEAM = "Capitol Carnage";

  function ensureBtn() {
    var hosts = [document.getElementById("myroster"), document.getElementById("dashboard"), document.getElementById("teams")];
    hosts.forEach(function (root) {
      if (!root || root.querySelector("#prideOptimizeBtn")) return;
      var bar = document.createElement("div");
      bar.className = "card";
      bar.style.marginTop = "12px";
      bar.innerHTML =
        '<div class="sectionhead"><h2>Weekly Lineup Optimizer</h2><span class="pill">FANTRAX PROJ</span></div>' +
        '<div class="notice"><b>Uses Fantrax weekly projections</b> and Pride active slots (QB, SFX, 2 RB, 3 WR, TE, RWT, 3 DL, 2 LB, 3 DB, 2 ID).</div>' +
        '<div class="actions" style="margin-top:8px">' +
        '<button type="button" id="prideOptimizeBtn" onclick="window.prideOptimizeLineup()">OPTIMIZE ROSTER FOR MATCHUP</button>' +
        '</div>' +
        '<div id="prideOptimizeResult" style="margin-top:10px"></div>';
      root.insertBefore(bar, root.firstChild);
    });
  }

  window.prideOptimizeLineup = async function () {
    var out = document.getElementById("prideOptimizeResult");
    if (!out) {
      ensureBtn();
      out = document.getElementById("prideOptimizeResult");
    }
    if (out) out.innerHTML = "<div class=\"notice\">Optimizing from Fantrax weekly projections…</div>";
    try {
      var res = await fetch(GATEWAY + "/optimize", { cache: "no-store" });
      var data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "HTTP " + res.status);
      var L = data.lineup || {};
      var starters = L.starters || [];
      var bench = L.bench || [];
      var opp = data.opponent;
      var oppLabel = "";
      if (opp) {
        var home = opp.home || {}, away = opp.away || {};
        oppLabel = (away.teamName || "?") + " @ " + (home.teamName || "?");
      }
      var html =
        '<div class="notice"><b>' + (data.team || MY_TEAM) + '</b> · Projected starters <b>' +
        (L.projectedTotal || 0) + '</b> pts' +
        (oppLabel ? ' · Matchup: ' + oppLabel : '') +
        '</div>' +
        '<div class="tableWrap" style="margin-top:8px"><table><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th>Weekly</th></tr></thead><tbody>';
      starters.forEach(function (s) {
        if (s.empty) {
          html += '<tr><td><b>' + s.slot + '</b></td><td colspan="3"><i>Empty</i></td></tr>';
        } else {
          html += '<tr><td><b>' + s.slot + '</b></td><td>' + s.name + '</td><td>' + (s.pos || '') +
            '</td><td><b>' + s.weekly + '</b></td></tr>';
        }
      });
      html += '</tbody></table></div>';
      if (bench.length) {
        html += '<div class="sectionhead" style="margin-top:12px"><h2>Bench / reserves</h2></div>';
        bench.slice(0, 20).forEach(function (b) {
          html += '<div class="gate"><span><b>' + b.name + '</b> · ' + (b.pos || '') +
            '</span><b>' + b.weekly + '</b></div>';
        });
      }
      if (out) out.innerHTML = html;

      // Also stamp weekly proj onto local assets when possible
      if (typeof db !== "undefined" && Array.isArray(db.assets)) {
        var byId = {};
        starters.concat(bench).forEach(function (p) {
          if (p.id) byId[p.id] = p;
        });
        db.assets.forEach(function (a) {
          if (a.fantraxId && byId[a.fantraxId]) {
            a.weeklyProj = byId[a.fantraxId].weekly;
            if (!a.proj && byId[a.fantraxId].season) a.proj = byId[a.fantraxId].season;
          }
        });
        try { if (typeof persist === "function") persist(); } catch (e) {}
      }
    } catch (e) {
      if (out) out.innerHTML = '<div class="notice"><b>Optimize failed.</b> ' + String(e.message || e) +
        ' Deploy the latest worker, then retry.</div>';
    }
  };

  // Hook navigation
  var orig = window.showView;
  if (typeof orig === "function") {
    window.showView = function (id) {
      orig(id);
      if (id === "myroster" || id === "dashboard" || id === "teams") setTimeout(ensureBtn, 80);
    };
  }
  setTimeout(ensureBtn, 1200);
  setInterval(ensureBtn, 4000);
})();
