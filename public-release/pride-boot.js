// Pride boot v8.1 — Fantrax direct (no worker auth required)
(function () {
  var LEAGUE = "astbqxhwmk4b6bg9";
  var SALARY_CAP = 1404;
  var GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";
  var tries = 0;

  function hideLock() {
    var el = document.getElementById("serverAuthLock");
    if (el) { el.style.display = "none"; try { el.remove(); } catch (e) {} }
    var health = document.getElementById("buildHealth");
    if (health && /vault locked/i.test(health.textContent || "")) {
      health.innerHTML = "<b>GM's Locker v8.1</b> · loading Fantrax…";
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

  function pickLabel(year, round, originalName) {
    var base = String(year) + " R" + String(round);
    if (originalName) return base + " (" + originalName + ")";
    return base;
  }

  function marketForPick(round) {
    var r = Number(round) || 3;
    if (r === 1) return 4500;
    if (r === 2) return 2200;
    if (r === 3) return 900;
    return 400;
  }

  async function fx(endpoint, extra) {
    var url = "https://www.fantrax.com/fxea/general/" + endpoint + "?leagueId=" + encodeURIComponent(LEAGUE);
    if (extra) {
      Object.keys(extra).forEach(function (k) {
        url += "&" + encodeURIComponent(k) + "=" + encodeURIComponent(extra[k]);
      });
    }
    var res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(endpoint + " HTTP " + res.status);
    return res.json();
  }

  async function loadLeague() {
    hideLock();
    tries++;
    try {
      if (typeof db === "undefined") return;

      var results = await Promise.all([
        fx("getTeamRosters"),
        fx("getPlayerIds").catch(function () { return {}; }),
        fx("getStandings").catch(function () { return []; }),
        fx("getMatchupScores").catch(function () { return {}; }),
        fx("getDraftPicks").catch(function () { return {}; })
      ]);

      var rostersPayload = results[0] || {};
      var players = results[1] || {};
      var standings = results[2] || [];
      var matchups = results[3] || {};
      var draftPicks = results[4] || {};

      var rosterMap = rostersPayload.rosters || rostersPayload || {};
      // Some responses nest under .rosters
      if (rosterMap.rosters) rosterMap = rosterMap.rosters;

      var id2name = {};
      Object.keys(rosterMap).forEach(function (id) {
        id2name[id] = (rosterMap[id] && rosterMap[id].teamName) || id;
      });

      var franchises = Object.keys(rosterMap).map(function (id) {
        return { id: id, name: rosterMap[id].teamName || id };
      });

      db.config = db.config || {};
      db.config.salaryCap = SALARY_CAP;
      db.config.leagueName = "Pride Dynasty";
      db.config.teamName = "Capitol Carnage";
      db.config.teams = franchises.length || 14;

      db.mfl = db.mfl || {};
      db.mfl.franchises = franchises;
      db.assets = db.assets || [];

      // Drop old Fantrax picks to avoid stacking
      db.assets = db.assets.filter(function (a) {
        if (a.type === "PICK" && String(a.source || "").indexOf("Fantrax") >= 0) return false;
        return true;
      });

      var byId = {};
      db.assets.forEach(function (a) {
        if (a.fantraxId) byId[String(a.fantraxId)] = a;
      });

      var created = 0;
      Object.keys(rosterMap).forEach(function (teamId) {
        var team = rosterMap[teamId];
        var teamName = team.teamName || teamId;
        (team.rosterItems || []).forEach(function (item) {
          var id = String(item.id || "");
          if (!id) return;
          var p = players[id] || {};
          var salary = Number(item.salary || 0);
          var years = Number((item.contract && (item.contract.smallId || item.contract.name)) || 0) || 0;
          var pos = String(item.position || p.position || "").toUpperCase();
          var name = p.name || item.name || id;
          if (byId[id]) {
            var a = byId[id];
            a.roster = teamName;
            a.salary = salary;
            a.years = years || a.years;
            a.status = item.status || a.status;
            a.fantraxId = id;
            a.name = name || a.name;
            a.pos = pos || a.pos;
            a.nfl = p.team || a.nfl;
            a.source = "Fantrax Live";
            if (!Number(a.market) || Number(a.market) < 50) a.market = Math.max(200, salary * 40);
          } else {
            var row = {
              id: "fantrax-" + id,
              fantraxId: id,
              name: name,
              type: "PLAYER",
              pos: pos,
              nfl: p.team || "",
              salary: salary,
              years: years,
              roster: teamName,
              status: item.status || "ACTIVE",
              market: Math.max(200, salary * 40),
              proj: 0,
              weeklyProj: 0,
              source: "Fantrax Live"
            };
            db.assets.push(row);
            byId[id] = row;
            created++;
          }
        });
      });

      var futurePicks = draftPicks.futureDraftPicks || [];
      var picksAdded = 0;
      futurePicks.forEach(function (fp) {
        var ownerId = fp.currentOwnerTeamId;
        var ownerName = id2name[ownerId] || ownerId;
        var origName = id2name[fp.originalOwnerTeamId] || "";
        var year = fp.year, round = fp.round;
        var name = pickLabel(year, round, origName && origName !== ownerName ? origName : "");
        var id = "pick-" + year + "-r" + round + "-" + (fp.originalOwnerTeamId || ownerId) + "-" + ownerId;
        db.assets.push({
          id: id, fantraxId: id, name: name, type: "PICK", pos: "PICK",
          salary: 0, years: 0, roster: ownerName, status: "PICK",
          market: marketForPick(round), proj: 0,
          pickYear: year, pickRound: round, originalOwner: origName, source: "Fantrax Live"
        });
        picksAdded++;
      });

      db.fantraxMatchups = matchups;
      db.fantraxStandings = Array.isArray(standings) ? standings : [];
      db.fantraxLiveMeta = {
        configured: true,
        syncedAt: new Date().toISOString(),
        teamCount: franchises.length,
        pickCount: picksAdded,
        source: "Fantrax direct"
      };
      db.lastSync = new Date().toISOString();

      try { if (typeof persist === "function") persist(); } catch (e) {}

      var health = document.getElementById("buildHealth");
      if (health) {
        health.innerHTML = "<b>GM's Locker v8.1</b> · <span class=\"good\">" +
          franchises.length + " teams · " + picksAdded + " picks · direct Fantrax</span>";
      }
      console.log("[pride-boot] direct load", franchises.length, "teams", created, "new", picksAdded, "picks");

      if (typeof window.renderTeamsPage === "function") {
        try { window.renderTeamsPage(); } catch (e) {}
      }
    } catch (e) {
      console.warn("[pride-boot] direct load failed", e);
      var health = document.getElementById("buildHealth");
      if (health) health.innerHTML = "<b>GM's Locker v8.1</b> · <span class=\"bad\">Fantrax load failed: " + String(e.message || e) + "</span>";
      if (tries < 4) setTimeout(loadLeague, 2000);
    }
  }

  window.prideForceRefresh = async function () {
    tries = 0;
    await loadLeague();
  };

  async function start() {
    hideLock();
    setInterval(hideLock, 500);
    await waitDb();
    await loadLeague();
    setTimeout(loadLeague, 3000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
