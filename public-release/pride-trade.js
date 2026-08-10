// Pride Trade Lab — players + draft picks in every trade analysis
(function () {
  var MY_TEAM = "Capitol Carnage";

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function allTeams() {
    var names = new Set();
    if (typeof db !== "undefined" && db.mfl && db.mfl.franchises) {
      db.mfl.franchises.forEach(function (f) { if (f && f.name) names.add(f.name); });
    }
    if (typeof db !== "undefined" && db.assets) {
      db.assets.forEach(function (a) {
        if (a.roster && !/free agent|^fa$/i.test(String(a.roster))) names.add(a.roster);
      });
    }
    return Array.from(names).sort();
  }

  function teamAssets(team, includePicks) {
    if (typeof db === "undefined" || !db.assets) return [];
    return db.assets.filter(function (a) {
      if (String(a.roster || "") !== team) return false;
      if (a.type === "PICK") return !!includePicks;
      return a.type !== "PICK";
    });
  }

  function val(a) {
    try { if (typeof modelValue === "function") return Number(modelValue(a)) || 0; } catch (e) {}
    if (a.type === "PICK") {
      var r = Number(a.pickRound || 3);
      if (r === 1) return 4500;
      if (r === 2) return 2200;
      if (r === 3) return 900;
      return Number(a.market || 400);
    }
    return Number(a.market || 0) || Math.max(100, Number(a.salary || 0) * 40);
  }

  function label(a) {
    if (a.type === "PICK") return a.name + " [PICK]";
    return a.name + (a.pos ? " (" + a.pos + ")" : "");
  }

  window.__tradeGive = window.__tradeGive || [];
  window.__tradeGet = window.__tradeGet || [];
  window.__tradePartner = window.__tradePartner || "";

  function ensureTradeView() {
    if (document.getElementById("tradepicks")) return;
    var sec = document.createElement("section");
    sec.id = "tradepicks";
    sec.className = "view";
    (document.querySelector(".app") || document.body).appendChild(sec);
  }

  function patchNav() {
    var navEl = document.getElementById("nav");
    if (!navEl || navEl.querySelector('[data-view="tradepicks"]')) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.view = "tradepicks";
    btn.textContent = "Trade + Picks";
    btn.onclick = function () { showView("tradepicks"); };
    var after = navEl.querySelector('[data-view="trade"]');
    if (after && after.nextSibling) navEl.insertBefore(btn, after.nextSibling);
    else navEl.appendChild(btn);
  }

  function assetById(id) {
    if (typeof db === "undefined") return null;
    return (db.assets || []).find(function (a) { return a.id === id || a.fantraxId === id; }) || null;
  }

  function toggleSide(side, id) {
    var arr = side === "give" ? window.__tradeGive : window.__tradeGet;
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
    if (side === "give") window.__tradeGive = arr;
    else window.__tradeGet = arr;
    window.renderTradePicks();
  }

  function analyze() {
    var give = window.__tradeGive.map(assetById).filter(Boolean);
    var get = window.__tradeGet.map(assetById).filter(Boolean);
    var giveVal = give.reduce(function (s, a) { return s + val(a); }, 0);
    var getVal = get.reduce(function (s, a) { return s + val(a); }, 0);
    var giveSal = give.reduce(function (s, a) { return s + (a.type === "PICK" ? 0 : Number(a.salary || 0)); }, 0);
    var getSal = get.reduce(function (s, a) { return s + (a.type === "PICK" ? 0 : Number(a.salary || 0)); }, 0);
    var givePicks = give.filter(function (a) { return a.type === "PICK"; });
    var getPicks = get.filter(function (a) { return a.type === "PICK"; });
    var net = getVal - giveVal;
    var verdict;
    if (Math.abs(net) < 300) verdict = "FAIR — values are close";
    else if (net > 0) verdict = "YOU WIN on paper by ~" + Math.round(net).toLocaleString();
    else verdict = "YOU LOSE on paper by ~" + Math.round(-net).toLocaleString();

    var notes = [];
    if (givePicks.length || getPicks.length) {
      notes.push("Picks in deal: give " + givePicks.map(function (p) { return p.name; }).join(", ") +
        (givePicks.length ? "" : "(none)") + " · get " +
        getPicks.map(function (p) { return p.name; }).join(", ") +
        (getPicks.length ? "" : "(none)"));
    }
    notes.push("Cap: you move out $" + giveSal.toFixed(1) + " salary, take on $" + getSal.toFixed(1) +
      " → net cap " + ((giveSal - getSal) >= 0 ? "+" : "") + (giveSal - getSal).toFixed(1));
    if (getPicks.some(function (p) { return Number(p.pickRound) === 1; })) notes.push("Acquiring 1st-round capital — hold for 2027 spike window.");
    if (givePicks.some(function (p) { return Number(p.pickRound) === 1; })) notes.push("Shipping a 1st — only do this if the player return is a clear starter upgrade.");

    return { give: give, get: get, giveVal: giveVal, getVal: getVal, net: net, verdict: verdict, notes: notes, giveSal: giveSal, getSal: getSal };
  }

  window.renderTradePicks = function () {
    ensureTradeView();
    var root = document.getElementById("tradepicks");
    if (!root) return;
    var teams = allTeams();
    if (!window.__tradePartner || teams.indexOf(window.__tradePartner) < 0) {
      window.__tradePartner = teams.find(function (t) { return t !== MY_TEAM; }) || teams[0] || "";
    }
    var partner = window.__tradePartner;
    var mine = teamAssets(MY_TEAM, true).concat(teamAssets(MY_TEAM, false));
    // unique by id
    var seen = {};
    mine = mine.filter(function (a) {
      var k = a.id || a.fantraxId;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).sort(function (a, b) {
      if (a.type === "PICK" && b.type !== "PICK") return 1;
      if (b.type === "PICK" && a.type !== "PICK") return -1;
      return val(b) - val(a);
    });
    var theirs = teamAssets(partner, true).concat(teamAssets(partner, false));
    seen = {};
    theirs = theirs.filter(function (a) {
      var k = a.id || a.fantraxId;
      if (seen[k]) return false;
      seen[k] = 1;
      return true;
    }).sort(function (a, b) {
      if (a.type === "PICK" && b.type !== "PICK") return 1;
      if (b.type === "PICK" && a.type !== "PICK") return -1;
      return val(b) - val(a);
    });

    var A = analyze();

    function rows(list, side) {
      var selected = side === "give" ? window.__tradeGive : window.__tradeGet;
      if (!list.length) return "<tr><td colspan=5>No assets — refresh Fantrax load first.</td></tr>";
      return list.map(function (a) {
        var id = a.id || a.fantraxId;
        var on = selected.indexOf(id) >= 0;
        var isPick = a.type === "PICK";
        return "<tr style=\"" + (on ? "background:rgba(212,175,55,0.15)" : "") + "\">" +
          "<td><input type=\"checkbox\" " + (on ? "checked" : "") +
          " onchange=\"window.prideTradeToggle('" + side + "','" + String(id).replace(/'/g, "\\'") + "')\"></td>" +
          "<td><b>" + esc(a.name) + "</b>" + (isPick ? " <span class=\"pill\">PICK</span>" : "") + "</td>" +
          "<td>" + esc(isPick ? ("R" + (a.pickRound || "?")) : (a.pos || "")) + "</td>" +
          "<td>" + (isPick ? "—" : ("$" + Number(a.salary || 0).toFixed(1))) + "</td>" +
          "<td><b>" + Math.round(val(a)).toLocaleString() + "</b></td></tr>";
      }).join("");
    }

    root.innerHTML =
      '<div class="card">' +
      '<div class="sectionhead"><h2>Trade Lab + Draft Picks</h2><span class="pill">DYNASTY ASSETS</span></div>' +
      '<div class="notice"><b>Picks are first-class assets.</b> Check players and future picks on both sides. Values use roster market + pick-round scales (R1≈4500, R2≈2200, R3≈900).</div>' +
      '<div class="field" style="margin-top:10px"><label>Trade partner</label>' +
      '<select onchange="window.__tradePartner=this.value;window.__tradeGet=[];window.renderTradePicks()">' +
      teams.filter(function (t) { return t !== MY_TEAM; }).map(function (t) {
        return '<option value="' + esc(t) + '"' + (t === partner ? " selected" : "") + ">" + esc(t) + "</option>";
      }).join("") +
      '</select></div></div>' +

      '<div class="grid" style="margin-top:12px">' +
      '<div class="card"><div class="sectionhead"><h2>You give (' + esc(MY_TEAM) + ')</h2><span class="pill">' + window.__tradeGive.length + '</span></div>' +
      '<div class="tableWrap"><table><thead><tr><th></th><th>Asset</th><th>Pos</th><th>Sal</th><th>Val</th></tr></thead><tbody>' +
      rows(mine, "give") + '</tbody></table></div></div>' +

      '<div class="card"><div class="sectionhead"><h2>You get (' + esc(partner) + ')</h2><span class="pill">' + window.__tradeGet.length + '</span></div>' +
      '<div class="tableWrap"><table><thead><tr><th></th><th>Asset</th><th>Pos</th><th>Sal</th><th>Val</th></tr></thead><tbody>' +
      rows(theirs, "get") + '</tbody></table></div></div></div>' +

      '<div class="card" style="margin-top:12px">' +
      '<div class="sectionhead"><h2>Trade analysis</h2></div>' +
      '<div class="grid4">' +
      '<div class="metric"><b>' + Math.round(A.giveVal).toLocaleString() + '</b><span>You give</span></div>' +
      '<div class="metric"><b>' + Math.round(A.getVal).toLocaleString() + '</b><span>You get</span></div>' +
      '<div class="metric"><b class="' + (A.net >= 0 ? "good" : "bad") + '">' + (A.net >= 0 ? "+" : "") + Math.round(A.net).toLocaleString() + '</b><span>Net value</span></div>' +
      '<div class="metric"><b>$' + (A.giveSal - A.getSal).toFixed(1) + '</b><span>Net cap</span></div></div>' +
      '<div class="notice" style="margin-top:10px"><b>' + esc(A.verdict) + '</b></div>' +
      A.notes.map(function (n) { return '<div class="gate"><span>' + esc(n) + '</span></div>'; }).join("") +
      '<div class="actions" style="margin-top:10px">' +
      '<button type="button" class="secondary" onclick="window.__tradeGive=[];window.__tradeGet=[];window.renderTradePicks()">CLEAR</button>' +
      '</div></div>';
  };

  window.prideTradeToggle = function (side, id) {
    toggleSide(side, id);
  };

  var origShow = window.showView;
  window.showView = function (id) {
    ensureTradeView();
    if (id === "tradepicks") {
      document.querySelectorAll(".view").forEach(function (x) { x.classList.remove("active"); });
      var el = document.getElementById("tradepicks");
      if (el) el.classList.add("active");
      document.querySelectorAll("#nav button").forEach(function (x) {
        x.classList.toggle("active", x.dataset.view === id);
      });
      try { localStorage.setItem("ccgm_view", id); } catch (e) {}
      window.renderTradePicks();
      return;
    }
    if (typeof origShow === "function") origShow(id);
  };

  // Also patch classic Trade Lab if present: inject pick notice
  function enhanceClassicTrade() {
    var trade = document.getElementById("trade");
    if (!trade || trade.querySelector("#prideTradePicksLink")) return;
    var bar = document.createElement("div");
    bar.className = "notice";
    bar.id = "prideTradePicksLink";
    bar.style.margin = "12px 0";
    bar.innerHTML = '<b>Draft picks belong in every dynasty deal.</b> Open <a href="#" style="color:#f1cf62" onclick="showView(\'tradepicks\');return false;">Trade + Picks</a> to evaluate players and future picks together.';
    trade.insertBefore(bar, trade.firstChild);
  }

  function boot() {
    ensureTradeView();
    patchNav();
    enhanceClassicTrade();
    setInterval(function () { patchNav(); enhanceClassicTrade(); }, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
