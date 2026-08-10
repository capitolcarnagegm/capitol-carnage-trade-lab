// Optimize on gmslocker.com — local roster fallback
(function () {
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
    if (p.indexOf("QB") >= 0) return "QB";
    if (p.indexOf("RB") >= 0) return "RB";
    if (p.indexOf("WR") >= 0) return "WR";
    if (p.indexOf("TE") >= 0) return "TE";
    if (/DL|DE|DT|EDGE/.test(p)) return "DL";
    if (p.indexOf("LB") >= 0) return "LB";
    if (/DB|CB/.test(p)) return "DB";
    return "?";
  }

  function optimizeLocal(players) {
    var pool = players.map(function (p) {
      return {
        id: p.id || p.fantraxId,
        name: p.name,
        pos: p.pos,
        primary: primaryPos(p.pos),
        score: Number(p.weeklyProj || 0) || Number(p.proj || 0) / 17
      };
    }).sort(function (a, b) { return b.score - a.score; });
    var used = {}, starters = [];
    LINEUP_SLOTS.forEach(function (spec) {
      for (var n = 0; n < spec.need; n++) {
        var pick = null;
        for (var i = 0; i < pool.length; i++) {
          if (!used[pool[i].id] && spec.accept.indexOf(pool[i].primary) >= 0) { pick = pool[i]; break; }
        }
        if (!pick) { starters.push({ slot: spec.slot, empty: true }); continue; }
        used[pick.id] = true;
        starters.push({ slot: spec.slot, name: pick.name, pos: pick.pos, weekly: Math.round(pick.score * 10) / 10 });
      }
    });
    var total = starters.reduce(function (s, x) { return s + (x.weekly || 0); }, 0);
    return { starters: starters, projectedTotal: Math.round(total * 10) / 10 };
  }

  function ensureBtn() {
    var root = document.getElementById("myroster") || document.getElementById("dashboard");
    if (!root || root.querySelector("#prideOptimizeBtn")) return;
    var bar = document.createElement("div");
    bar.className = "card";
    bar.innerHTML = '<div class="sectionhead"><h2>Weekly Lineup Optimizer</h2></div>' +
      '<button type="button" id="prideOptimizeBtn" onclick="window.prideOptimizeLineup()">OPTIMIZE ROSTER FOR MATCHUP</button>' +
      '<div id="prideOptimizeResult" style="margin-top:10px"></div>';
    root.insertBefore(bar, root.firstChild);
  }

  window.prideOptimizeLineup = function () {
    var out = document.getElementById("prideOptimizeResult");
    ensureBtn();
    out = document.getElementById("prideOptimizeResult");
    if (out) out.innerHTML = "Optimizing…";
    try {
      if (typeof db === "undefined" || !db.assets) throw new Error("No roster yet — open Teams and refresh first.");
      var players = db.assets.filter(function (a) {
        return a.type !== "PICK" && String(a.roster || "") === MY_TEAM;
      });
      if (!players.length) throw new Error("Capitol Carnage roster empty. Refresh Teams first.");
      var L = optimizeLocal(players);
      var html = "<div class=\"notice\"><b>" + MY_TEAM + "</b> · " + L.projectedTotal + " pts</div>";
      L.starters.forEach(function (s) {
        html += s.empty
          ? "<div class=\"gate\"><span>" + s.slot + "</span><i>Empty</i></div>"
          : "<div class=\"gate\"><span><b>" + s.slot + "</b> " + s.name + "</span><b>" + s.weekly + "</b></div>";
      });
      if (out) out.innerHTML = html;
    } catch (e) {
      if (out) out.innerHTML = "<div class=\"notice\"><b>Optimize failed.</b> " + String(e.message || e) + "</div>";
    }
  };

  setTimeout(ensureBtn, 1500);
  setInterval(ensureBtn, 5000);
})();
