// Pride boot — teams, salaries, draft picks, salary cap, ESPN projections
(function () {
  var GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";
  var SALARY_CAP = 1404;
  var tries = 0;

  function hideLock() {
    var el = document.getElementById("serverAuthLock");
    if (el) { el.style.display = "none"; try { el.remove(); } catch (e) {} }
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

  function normName(n) {
    var s = String(n || "").toLowerCase().replace(/[^a-z\s,]/g, " ").replace(/\s+/g, " ").trim();
    if (s.indexOf(",") >= 0) {
      var parts = s.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      if (parts.length >= 2) s = parts[1] + " " + parts[0];
    }
    return s.replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
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

  async function loadLeague() {
    hideLock();
    tries++;
    try {
      var res = await fetch(GATEWAY + "/fantrax/live", { cache: "no-store" });
      var payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "HTTP " + res.status);
      if (typeof db === "undefined") return;

      var snaps = payload.snapshots || {};
      var rosterMap = (snaps.rosters && snaps.rosters.rosters) || {};
      var players = snaps.players || {};
      var draftPicks = snaps.draftPicks || {};
      var futurePicks = draftPicks.futureDraftPicks || [];
      var standings = snaps.standings || [];
      var projections = payload.projections || {};

      var id2name = {};
      Object.keys(rosterMap).forEach(function (id) {
        id2name[id] = rosterMap[id].teamName || id;
      });

      var franchises = Object.keys(rosterMap).map(function (id) {
        return { id: id, name: rosterMap[id].teamName || id };
      });

      db.config = db.config || {};
      db.config.salaryCap = SALARY_CAP;
      db.config.leagueName = "Pride Dynasty";
      db.config.teamName = "Capitol Carnage";
      db.config.teams = franchises.length;
      db.config.superflex = true;
      db.config.tep = true;
      db.config.idp = true;

      db.mfl = db.mfl || {};
      db.mfl.franchises = franchises;
      db.assets = db.assets || [];

      var byFantraxId = {};
      db.assets.forEach(function (a) {
        if (a.fantraxId) byFantraxId[String(a.fantraxId)] = a;
      });

      db.assets = db.assets.filter(function (a) {
        if (a.type === "PICK" && String(a.source || "").indexOf("Fantrax") >= 0) return false;
        return true;
      });

      var withProj = 0;
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
          var proj = Number(item.proj || 0);
          if (!proj) {
            var key = normName(p.name || "");
            if (key && projections[key] != null) proj = Number(projections[key]);
          }
          if (proj > 0) withProj++;

          if (byFantraxId[id]) {
            var a = byFantraxId[id];
            a.roster = teamName;
            a.salary = salary;
            a.years = years || a.years;
            a.status = item.status || a.status;
            a.fantraxId = id;
            a.name = p.name || a.name;
            a.pos = pos || a.pos;
            a.nfl = p.team || a.nfl;
            a.source = "Fantrax Live";
            if (proj > 0) a.proj = proj;
            if (!Number(a.market) || Number(a.market) < 50) a.market = Math.max(200, salary * 40);
          } else {
            db.assets.push({
              id: "fantrax-" + id,
              fantraxId: id,
              name: p.name || id,
              type: "PLAYER",
              pos: pos,
              nfl: p.team || "",
              salary: salary,
              years: years,
              roster: teamName,
              status: item.status || "ACTIVE",
              market: Math.max(200, salary * 40),
              proj: proj,
              age: 0, role: 55, trend: 0, risk: 40,
              source: "Fantrax Live"
            });
          }
        });
      });

      var picksAdded = 0;
      futurePicks.forEach(function (fp) {
        var ownerId = fp.currentOwnerTeamId;
        var ownerName = id2name[ownerId] || ownerId;
        var origName = id2name[fp.originalOwnerTeamId] || "";
        var year = fp.year, round = fp.round;
        var name = pickLabel(year, round, origName && origName !== ownerName ? origName : "");
        var id = "pick-" + year + "-r" + round + "-" + (fp.originalOwnerTeamId || ownerId) + "-" + ownerId;
        db.assets.push({
          id: id, fantraxId: id, name: name, type: "PICK", pos: "PICK", nfl: "",
          salary: 0, years: 0, roster: ownerName, status: "PICK",
          market: marketForPick(round), proj: 0,
          pickYear: year, pickRound: round, originalOwner: origName, source: "Fantrax Live"
        });
        picksAdded++;
      });

      var capByTeam = {};
      franchises.forEach(function (f) {
        var sal = 0, picks = 0, proj = 0;
        db.assets.forEach(function (a) {
          if (String(a.roster || "") !== f.name) return;
          if (a.type === "PICK") picks++;
          else {
            sal += Number(a.salary || 0);
            proj += Number(a.proj || 0);
          }
        });
        capByTeam[f.name] = {
          salaryUsed: Math.round(sal * 10) / 10,
          salaryCap: SALARY_CAP,
          capSpace: Math.round((SALARY_CAP - sal) * 10) / 10,
          pickCount: picks,
          projTotal: Math.round(proj)
        };
      });

      db.fantraxMatchups = snaps.matchups || null;
      db.fantraxStandings = standings;
      db.fantraxCap = capByTeam;
      db.fantraxLiveMeta = {
        configured: true,
        syncedAt: payload.syncedAt || new Date().toISOString(),
        teamCount: franchises.length,
        pickCount: picksAdded,
        salaryCap: SALARY_CAP,
        withProj: withProj
      };
      db.lastSync = payload.syncedAt || new Date().toISOString();

      try { if (typeof persist === "function") persist(); } catch (e) {}

      console.log("[pride-boot] teams", franchises.length, "picks", picksAdded, "proj", withProj);
      var health = document.getElementById("buildHealth");
      if (health) {
        health.innerHTML = "<b>GM's Locker</b> · <span class=\"good\">" +
          franchises.length + " teams · " + picksAdded + " picks · " + withProj + " projections · cap $" + SALARY_CAP + "</span>";
      }
    } catch (e) {
      console.warn("[pride-boot] load failed", e);
      if (tries < 4) setTimeout(loadLeague, 1600);
    }
  }

  window.prideTeamCap = function (teamName) {
    var c = (db && db.fantraxCap && db.fantraxCap[teamName]) || null;
    if (c) return c;
    return { salaryUsed: 0, salaryCap: SALARY_CAP, capSpace: SALARY_CAP, pickCount: 0, projTotal: 0 };
  };

  window.prideForceRefresh = async function () {
    tries = 0;
    await loadLeague();
    if (typeof window.renderTeamsPage === "function") {
      try { window.renderTeamsPage(); } catch (e) {}
    }
  };

  async function start() {
    hideLock();
    setInterval(hideLock, 500);
    await waitDb();
    await loadLeague();
    setTimeout(loadLeague, 2500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
