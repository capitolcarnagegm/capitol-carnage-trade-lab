// Optimize lineup - worker first, client Fantrax fallback
(function () {
  var GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";
  var MY_TEAM = "Capitol Carnage";
  var LINEUP_SLOTS = [
    { slot: "QB", need: 1, accept: ["QB"] },
    { slot: "SFX", need: 1, accept: ["QB", "RB", "WR", "TE"] },
    { slot: "RB", need: 2, accept: ["RB"] },
    { slot: "WR", need: 3, accept: ["WR"] },
    { slot: "TE", need: 1, accept: ["TE"] },
    { slot: "RWT", need: 1, accept: ["RB", "WR", "TE"] },
    { slot: "DL", need: 3, accept: ["DL"] },
    { slot: "LB", need: 2, accept: ["LB"] },
    { slot: "DB", need: 3, accept: ["DB"] },
    { slot: "ID", need: 2, accept: ["DL", "LB", "DB"] }
  ];

  function primaryPos(posStr) {
    var p = String(posStr || "").toUpperCase();
    if (p.indexOf("QB") >= 0 || p.indexOf("SFX") >= 0) return "QB";
    if (p.indexOf("RB") >= 0) return "RB";
    if (p.indexOf("WR") >= 0) return "WR";
    if (p.indexOf("TE") >= 0) return "TE";
    if (/DL|DE|DT|EDGE/.test(p)) return "DL";
    if (p.indexOf("LB") >= 0) return "LB";
    if (/DB|CB/.test(p)) return "DB";
    return p.split(/[^A-Z]/)[0] || "?";
  }

  function optimizeLocal(players) {
    var pool = players.map(function (p) {
      return {
        id: p.id || p.fantraxId,
        name: p.name,
        pos: p.pos,
        primary: primaryPos(p.pos),
        score: Number(p.weeklyProj || p.weekly || 0) || Number(p.proj || p.season || 0) / 17
      };
    }).sort(function (a, b) { return b.score - a.score; });
    var used = {};
    var starters = [];
    LINEUP_SLOTS.forEach(function (spec) {
      for (var n = 0; n < spec.need; n++) {
        var pick = null;
        for (var i = 0; i < pool.length; i++) {
          if (!used[pool[i].id] && spec.accept.indexOf(pool[i].primary) >= 0) {
            pick = pool[i];
            break;
          }
        }
        if (!pick) {
          starters.push({ slot: spec.slot, empty: true });
          continue;
        }
        used[pick.id] = true;
        starters.push({
          slot: spec.slot,
          id: pick.id,
          name: pick.name,
          pos: pick.pos,
          weekly: Math.round(pick.score * 10) / 10
        });
      }
    });
    var bench = pool.filter(function (p) { return !used[p.id]; }).map(function (p) {
      return { id: p.id, name: p.name, pos: p.pos, weekly: Math.round(p.score * 10) / 10 };
    });
    var total = starters.reduce(function (s, x) { return s + (x.weekly || 0); }, 0);
    return { starters: starters, bench: bench, projectedTotal: Math.round(total * 10) / 10 };
  }

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

  function renderResult(out, L, source) {
    var starters = L.starters || [];
    var bench = L.bench || [];
    var html =
      '<div class="notice"><b>' + MY_TEAM + '</b> · Projected starters <b>' +
      (L.projectedTotal || 0) + '</b> pts · source: ' + source + '</div>' +
      '<div class="tableWrap" style="margin-top:8px"><table><thead><tr><th>Slot</th><th>Player</th><th>Pos</th><th>Weekly</th></tr></thead><tbody>';
    starters.forEach(function (s) {
      if (s.empty) html += '<tr><td><b>' + s.slot + '</b></td><td colspan="3"><i>Empty</i></td></tr>';
      else html += '<tr><td><b>' + s.slot + '</b></td><td>' + s.name + '</td><td>' + (s.pos || '') +
        '</td><td><b>' + s.weekly + '</b></td></tr>';
    });
    html += '</tbody></table></div>';
    if (bench.length) {
      html += '<div class="sectionhead" style="margin-top:12px"><h2>Bench</h2></div>';
      bench.slice(0, 15).forEach(function (b) {
        html += '<div class="gate"><span><b>' + b.name + '</b> · ' + (b.pos || '') +
          '</span><b>' + b.weekly + '</b></div>';
      });
    }
    if (out) out.innerHTML = html;
  }

  window.prideOptimizeLineup = async function () {
    var out = document.getElementById("prideOptimizeResult");
    if (!out) {
      ensureBtn();
      out = document.getElementById("prideOptimizeResult");
    }
    if (out) out.innerHTML = '<div class="notice">Optimizing…</div>';

    try {
      var res = await fetch(GATEWAY + "/optimize", { cache: "no-store" });
      var data = await res.json();
      if (res.ok && data.ok && data.lineup) {
        renderResult(out, data.lineup, data.source || "worker");
        return;
      }
      throw new Error(data.error || "worker failed");
    } catch (e) {
      try {
        if (typeof db === "undefined" || !Array.isArray(db.assets)) throw new Error("No local roster loaded yet. Open Teams and tap REFRESH first.");
        var players = db.assets.filter(function (a) {
          return a.type !== "PICK" && String(a.roster || "") === MY_TEAM;
        });
        if (!players.length) throw new Error("Capitol Carnage roster empty. Refresh Fantrax first.");
        var L = optimizeLocal(players);
        renderResult(out, L, "local roster (deploy worker v8 to unlock live Fantrax optimize)");
      } catch (e2) {
        if (out) out.innerHTML = '<div class="notice"><b>Optimize failed.</b> ' + String(e2.message || e2) +
          '</div>';
      }
    }
  };

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
