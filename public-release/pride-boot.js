// Pride boot helper — ensures Fantrax teams load after app db is ready
(function () {
  var GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";
  var tries = 0;

  function hideLock() {
    var el = document.getElementById("serverAuthLock");
    if (el) {
      el.style.display = "none";
      try { el.remove(); } catch (e) {}
    }
  }

  function waitDb() {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() {
        if (typeof db !== "undefined" && db && Array.isArray(db.assets)) return resolve(true);
        if (Date.now() - t0 > 15000) return resolve(false);
        setTimeout(tick, 150);
      })();
    });
  }

  async function loadTeams() {
    hideLock();
    tries++;
    try {
      if (typeof window.prideForceRefresh === "function") {
        await window.prideForceRefresh();
        return;
      }
      if (typeof forceLoadFantraxLeague === "function") {
        await forceLoadFantraxLeague();
        return;
      }
      // Direct load if override helpers missing
      var res = await fetch(GATEWAY + "/fantrax/live", { cache: "no-store" });
      var payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "HTTP " + res.status);
      if (typeof db === "undefined") return;
      var rosterMap = (payload.snapshots && payload.snapshots.rosters && payload.snapshots.rosters.rosters) || {};
      var players = (payload.snapshots && payload.snapshots.players) || {};
      var franchises = Object.keys(rosterMap).map(function (id) {
        return { id: id, name: rosterMap[id].teamName || id };
      });
      db.mfl = db.mfl || {};
      db.mfl.franchises = franchises;
      db.assets = db.assets || [];
      var byId = {};
      db.assets.forEach(function (a) { if (a.fantraxId) byId[a.fantraxId] = a; });
      Object.keys(rosterMap).forEach(function (teamId) {
        var team = rosterMap[teamId];
        var teamName = team.teamName || teamId;
        (team.rosterItems || []).forEach(function (item) {
          var id = String(item.id || "");
          if (!id) return;
          var p = players[id] || {};
          var salary = Number(item.salary || 0);
          if (byId[id]) {
            byId[id].roster = teamName;
            byId[id].salary = salary;
            byId[id].status = item.status || byId[id].status;
            byId[id].fantraxId = id;
            byId[id].name = p.name || byId[id].name;
            byId[id].pos = item.position || byId[id].pos;
          } else {
            var row = {
              id: "fantrax-" + id,
              fantraxId: id,
              name: p.name || id,
              type: "PLAYER",
              pos: String(item.position || p.position || "").toUpperCase(),
              nfl: p.team || "",
              salary: salary,
              years: Number((item.contract && (item.contract.smallId || item.contract.name)) || 0) || 0,
              roster: teamName,
              status: item.status || "ACTIVE",
              market: Math.max(200, salary * 40),
              source: "Fantrax Live"
            };
            db.assets.push(row);
            byId[id] = row;
          }
        });
      });
      db.fantraxMatchups = (payload.snapshots && payload.snapshots.matchups) || null;
      db.fantraxStandings = (payload.snapshots && payload.snapshots.standings) || [];
      try { if (typeof persist === "function") persist(); } catch (e) {}
      console.log("[pride-boot] loaded", franchises.length, "teams");
      var health = document.getElementById("buildHealth");
      if (health) health.innerHTML = "<b>GM's Locker</b> · <span class=\"good\">" + franchises.length + " teams from Fantrax</span>";
    } catch (e) {
      console.warn("[pride-boot] load failed", e);
      if (tries < 3) setTimeout(loadTeams, 1500);
    }
  }

  async function start() {
    hideLock();
    setInterval(hideLock, 500);
    await waitDb();
    await loadTeams();
    // one more pass after 2s for race with other loaders
    setTimeout(loadTeams, 2000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
