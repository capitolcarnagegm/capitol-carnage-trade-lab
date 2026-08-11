/**
 * GM's Locker Phase 1 - Fantrax War Room
 * League: Pride Dynasty - Team: Capitol Carnage
 */
(function () {
  "use strict";

  var LEAGUE_ID = "astbqxhwmk4b6bg9";
  var MY_TEAM = "Capitol Carnage";
  var MY_TEAM_ID = "nsf1b7esmk4b6bgd";
  var CAP_NOW = 1403.9;
  var VERSION = "1.5.0";
  var API_BASE = "https://api.gmslocker.com";

  var TIER = localStorage.getItem("gms_tier") || "free";
  var COACH = localStorage.getItem("gms_coach") || "process";

  var state = {
    teams: {}, players: {}, standings: [], picks: [], matchups: null,
    asOf: null, loading: false, error: null, selectedTeam: MY_TEAM,
    cutIds: [], chat: JSON.parse(localStorage.getItem("gms_chat") || "[]"),
    tradeTeamA: MY_TEAM, tradeTeamB: "", tradeA: [], tradeB: []
  };

  var BYLAWS = {
    name: "Pride Dynasty", motto: "Pride ain't cheap.",
    dead: { 1: 0, 2: 0.4, 3: 0.6, 4: 0.8, 5: 0.85 },
    capInflation: 0.05, salaryRaise: 0.20,
    rosterMin: 30, rosterMax: 37, taxi: 6, ir: 5
  };

  var COACHES = {
    process: { name: "Process", lens: "Value, age curves, replaceability, no sentiment." },
    playmaker: { name: "Playmaker", lens: "Upside, boom projection, get talent the ball." },
    culture: { name: "Culture", lens: "Depth, injuries, next-man-up, stability." },
    matchup: { name: "Matchup", lens: "Weekly edges, scheme, exploit the opponent." },
    physical: { name: "Physical", lens: "IDP weight, toughness, trench bias." },
    aggressive: { name: "Aggressive", lens: "Win-now, thin bench, swing for spikes." },
    builder: { name: "Builder", lens: "Dynasty, picks, young cost-controlled talent." }
  };

  async function fx(endpoint, extra) {
    var url = API_BASE + "/?endpoint=" + encodeURIComponent(endpoint) +
      "&leagueId=" + encodeURIComponent(LEAGUE_ID) + (extra || "");
    var res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(endpoint + " HTTP " + res.status);
    return res.json();
  }

  async function syncFantrax() {
    state.loading = true;
    state.error = null;
    render();
    try {
      var parts = await Promise.all([
        fx("getTeamRosters"),
        fx("getPlayerIds", "&sport=NFL").catch(function () { return {}; }),
        fx("getStandings").catch(function () { return []; }),
        fx("getDraftPicks").catch(function () { return {}; }),
        fx("getMatchupScores").catch(function () { return {}; }),
        fx("getLeagueInfo").catch(function () { return {}; })
      ]);
      var rosterMap = (parts[0] || {}).rosters || {};
      state.players = parts[1] || {};
      state.standings = Array.isArray(parts[2]) ? parts[2] : [];
      state.picks = (parts[3] || {}).futureDraftPicks || [];
      state.matchups = parts[4] || null;
      state.leagueInfo = parts[5] || {};
      state.teams = {};
      Object.keys(rosterMap).forEach(function (tid) {
        var t = rosterMap[tid];
        state.teams[tid] = {
          id: tid, name: t.teamName || tid,
          items: t.rosterItems || [], salaryCap: t.salaryCap || CAP_NOW
        };
      });
      state.asOf = new Date().toISOString();
      state.loading = false;
      try { localStorage.setItem("gms_last_sync", state.asOf); } catch (e) {}
    } catch (e) {
      state.loading = false;
      var msg = String(e.message || e);
      if (/Failed to fetch|NetworkError|CORS|blocked/i.test(msg)) {
        msg = "Fantrax blocked browser request (CORS). Need a proxy worker for live rosters. UI still works offline.";
      }
      state.error = msg;
    }
    render();
  }

  function playerName(id) {
    var p = state.players[id];
    if (!p) return id;
    var n = p.name || id;
    if (n.indexOf(",") >= 0) {
      var parts = n.split(",").map(function (x) { return x.trim(); });
      if (parts.length >= 2) n = parts[1] + " " + parts[0];
    }
    return n;
  }

  function playerMeta(id) {
    var p = state.players[id] || {};
    return { id: id, name: playerName(id), pos: String(p.position || "").toUpperCase(), nfl: p.team || "" };
  }

  function teamByName(name) {
    var keys = Object.keys(state.teams);
    for (var i = 0; i < keys.length; i++) {
      if (state.teams[keys[i]].name === name) return state.teams[keys[i]];
    }
    return null;
  }

  function teamPlayers(teamName) {
    var t = teamByName(teamName);
    if (!t) return [];
    return (t.items || []).map(function (item) {
      var meta = playerMeta(item.id);
      var years = 0;
      if (item.contract) years = Number(item.contract.smallId || item.contract.name || 0) || 0;
      return {
        id: item.id, name: meta.name,
        pos: String(item.position || meta.pos || "").toUpperCase(),
        nfl: meta.nfl, salary: Number(item.salary || 0), years: years,
        status: item.status || "ACTIVE", team: teamName,
        projectedPoints: item.projectedPoints || item.projection || item.projectedScore,
        score: item.score || item.points || item.fantasyPoints
      };
    });
  }

  function allTeamNames() {
    return Object.keys(state.teams).map(function (id) { return state.teams[id].name; }).sort();
  }

  function freeAgentsApprox() {
    var rostered = {};
    Object.keys(state.teams).forEach(function (tid) {
      (state.teams[tid].items || []).forEach(function (it) { rostered[it.id] = true; });
    });
    var fa = [];
    Object.keys(state.players).forEach(function (id) {
      if (rostered[id]) return;
      var p = state.players[id];
      var pos = String(p.position || "").toUpperCase();
      if (!pos || /^(OL|OT|OG|C|LS|K)$/.test(pos)) return;
      fa.push({ id: id, name: playerName(id), pos: pos, nfl: p.team || "", salary: 0, years: 0, status: "AVAILABLE", team: "Free Agent" });
    });
    return fa;
  }

  function allLeaguePlayers() {
    var out = [];
    allTeamNames().forEach(function (name) { out = out.concat(teamPlayers(name)); });
    return out.concat(freeAgentsApprox());
  }

  function projectedPoints(p) {
    var raw = Number(p.projectedPoints || p.projection || p.projectedScore || 0);
    if (raw > 0) return Math.round(raw * 10) / 10;
    var base = { QB: 18, RB: 10, WR: 10, TE: 8, LB: 8, DL: 6, DE: 6, DT: 5, DB: 6, CB: 5, S: 6, EDGE: 7 }[p.pos] || 5;
    var market = Math.min(8, Math.log(Math.max(1, Number(p.salary || 1))) * 1.25);
    var penalty = /INJURED|IR|OUT|SUSPEND/i.test(p.status) ? base * 0.8 : /MINORS|TAXI/i.test(p.status) ? 3 : 0;
    return Math.max(0, Math.round((base + market - penalty) * 10) / 10);
  }

  function currentProduction(p) {
    var raw = Number(p.score || p.points || p.fantasyPoints || 0);
    return raw > 0 ? Math.round(raw * 10) / 10 : Math.max(0, Math.round(projectedPoints(p) * (/ACTIVE/i.test(p.status) ? 0.92 : 0.65) * 10) / 10);
  }

  function opponentName() {
    var matchups = (state.matchups && state.matchups.matchups) || [];
    for (var i = 0; i < matchups.length; i++) {
      if (matchups[i].home && matchups[i].home.teamName === MY_TEAM) return matchups[i].away.teamName;
      if (matchups[i].away && matchups[i].away.teamName === MY_TEAM) return matchups[i].home.teamName;
    }
    return "Opponent not loaded";
  }

  function topPlayers(teamName, count) {
    return teamPlayers(teamName).slice().sort(function (a, b) { return projectedPoints(b) - projectedPoints(a); }).slice(0, count || 5);
  }

  function optimizedLineup() {
    var slots = { QB: 1, RB: 2, WR: 3, TE: 1, DL: 2, LB: 2, DB: 2 };
    var mine = teamPlayers(MY_TEAM).filter(function (p) { return !/OUT|INJURED_RESERVE|SUSPEND/i.test(p.status); });
    var lineup = [];
    Object.keys(slots).forEach(function (pos) {
      lineup = lineup.concat(mine.filter(function (p) { return p.pos === pos || (pos === "DL" && /DE|DT|EDGE/.test(p.pos)) || (pos === "DB" && /CB|S/.test(p.pos)); })
        .sort(function (a, b) { return (projectedPoints(b) * .65 + currentProduction(b) * .35) - (projectedPoints(a) * .65 + currentProduction(a) * .35); }).slice(0, slots[pos]));
    });
    return lineup;
  }

  function deadSchedule(salary, yearsRemaining) {
    var y = Math.max(1, Number(yearsRemaining) || 1);
    var sal = Number(salary) || 0;
    var nextPct = BYLAWS.dead[y] != null ? BYLAWS.dead[y] : (y >= 5 ? 0.85 : 0);
    return { year0: Math.round(sal * 100) / 100, year1: Math.round(sal * nextPct * 100) / 100 };
  }

  function capForYear(offset) {
    return Math.round(CAP_NOW * Math.pow(1 + BYLAWS.capInflation, offset) * 10) / 10;
  }

  function salaryInYear(base, yearsLeft, offset) {
    if (offset >= yearsLeft) return 0;
    var s = base;
    for (var i = 0; i < offset; i++) s *= (1 + BYLAWS.salaryRaise);
    return Math.round(s * 100) / 100;
  }

  function projectCuts(players, cutIds) {
    var set = {};
    (cutIds || []).forEach(function (id) { set[String(id)] = true; });
    var years = [];
    for (var y = 0; y < 5; y++) {
      var active = 0, dead = 0, count = 0;
      players.forEach(function (p) {
        if (set[String(p.id)]) {
          var sch = deadSchedule(p.salary, p.years);
          if (y === 0) dead += sch.year0;
          else if (y === 1) dead += sch.year1;
          return;
        }
        if (p.years > y) {
          active += salaryInYear(p.salary, p.years, y);
          count++;
        }
      });
      var cap = capForYear(y);
      years.push({
        label: y === 0 ? "2026 (now)" : String(2026 + y),
        active: Math.round(active * 10) / 10,
        dead: Math.round(dead * 10) / 10,
        total: Math.round((active + dead) * 10) / 10,
        cap: cap,
        space: Math.round((cap - active - dead) * 10) / 10,
        players: count
      });
    }
    return years;
  }

  function bhsSignal(p) {
    var score = 50, reasons = [];
    if (p.years >= 3 && p.salary < 30) { score += 15; reasons.push("cheap long control"); }
    if (p.years <= 1 && p.salary > 80) { score -= 20; reasons.push("expensive expiring deal"); }
    if (p.years >= 2 && p.salary > 120) { score -= 10; reasons.push("heavy cap commitment"); }
    if (/IR|OUT|SUSPEND/i.test(p.status)) { score -= 15; reasons.push("injury/status risk"); }
    if (/MINORS|TAXI/i.test(p.status)) { score += 5; reasons.push("taxi/minors upside"); }
    var label = score >= 62 ? "BUY" : score <= 40 ? "SELL" : "HOLD";
    return { label: label, score: score, reasons: reasons };
  }

  function letterGrade(n) {
    if (n >= 90) return "A";
    if (n >= 80) return "B";
    if (n >= 70) return "C";
    if (n >= 60) return "D";
    return "F";
  }

  function rosterHealth(teamName) {
    var players = teamPlayers(teamName);
    if (!players.length) return { score: 0, grade: "F", why: "No roster data.", salary: 0, space: CAP_NOW, count: 0 };
    var salary = players.reduce(function (s, p) { return s + p.salary; }, 0);
    var space = CAP_NOW - salary;
    var active = players.filter(function (p) { return /ACTIVE/i.test(p.status); }).length;
    var score = 55, bits = [];
    if (players.length >= 30) { score += 10; bits.push("roster size healthy (" + players.length + ")"); }
    else { score -= 10; bits.push("thin roster (" + players.length + ")"); }
    if (space > 50) { score += 8; bits.push("cap space $" + space.toFixed(0)); }
    else if (space < 0) { score -= 15; bits.push("over cap"); }
    else bits.push("tight cap");
    if (active >= 25) { score += 5; bits.push("active depth"); }
    if (COACH === "builder") score += 3;
    if (COACH === "aggressive" && space < 30) score -= 5;
    score = Math.max(0, Math.min(100, score));
    return { score: score, grade: letterGrade(score), why: bits.join("; ") || "Baseline.", salary: salary, space: space, count: players.length };
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function formatAsOf() {
    if (!state.asOf) return "Not synced";
    try { return new Date(state.asOf).toLocaleString(); } catch (e) { return state.asOf; }
  }

  function buildWarRoom() {
    var actions = [];
    var mine = teamPlayers(MY_TEAM);
    if (!mine.length) {
      return [{ type: "system", cls: "", title: "Sync Fantrax to load your roster", why: "No Capitol Carnage players yet. Tap Refresh. If CORS blocks, proxy needed.", grade: "-" }];
    }
    var health = rosterHealth(MY_TEAM);
    if (health.space < 40) {
      actions.push({ type: "URGENT", cls: "urgent", title: "Cap space is tight ($" + health.space.toFixed(1) + ")", why: "Under Pride rules you must be under cap by March 1. Dead money = 100% this year + 40-85% next year only.", grade: health.grade });
    }
    mine.filter(function (p) { return p.years <= 1 && p.salary >= 60; })
      .sort(function (a, b) { return b.salary - a.salary; }).slice(0, 2)
      .forEach(function (p) {
        actions.push({ type: "SELL / DECIDE", cls: "trade", title: p.name + " ($" + p.salary.toFixed(1) + ", " + p.years + " yr left)", why: "Expiring or short deal at real money. Extend, tag, or move.", grade: "C" });
      });
    mine.filter(function (p) { return p.years >= 3 && p.salary <= 25; }).slice(0, 2)
      .forEach(function (p) {
        actions.push({ type: "HOLD", cls: "upgrade", title: "Protect " + p.name + " ($" + p.salary.toFixed(1) + " x " + p.years + " yrs)", why: "Cost-controlled depth. Keep unless a win-now trade is overwhelming.", grade: "B" });
      });
    freeAgentsApprox().sort(function (a, b) { return projectedPoints(b) - projectedPoints(a); }).slice(0, Math.max(0, 5 - actions.length)).forEach(function (p) {
      actions.push({ type: "SCOUT", cls: "upgrade", title: "Check availability: " + p.name, why: p.pos + " depth with an estimated " + projectedPoints(p).toFixed(1) + " points; compare him to your lowest producer before bidding.", grade: "B" });
    });
    var coach = COACHES[COACH] || COACHES.process;
    actions.push({ type: "COUNCIL", cls: "", title: coach.name + " lens active", why: coach.lens, grade: health.grade });
    return actions.slice(0, TIER === "paid" ? 10 : 5);
  }

  function viewWarRoom() {
    var actions = buildWarRoom();
    var health = rosterHealth(MY_TEAM);
    var html = "";
    html += '<div class="card"><div class="sectionhead"><h2>War Room</h2><span class="pill">' + (TIER === "paid" ? "PAID · 10" : "FREE · 5") + '</span></div>';
    html += '<div class="notice"><b>What should you do today?</b> Simulate here - execute in Fantrax. Coach: <b>' + esc((COACHES[COACH] || COACHES.process).name) + '</b>.</div>';
    html += '<div class="grid4">';
    html += '<div class="metric"><b>' + health.grade + '</b><span>Roster grade</span></div>';
    html += '<div class="metric"><b>' + health.score + '</b><span>Health 0-100</span></div>';
    html += '<div class="metric"><b>$' + (health.space != null ? health.space.toFixed(0) : "-") + '</b><span>Cap space</span></div>';
    html += '<div class="metric"><b>' + (health.count || 0) + '</b><span>Players</span></div></div>';
    html += '<p class="muted" style="font-size:13px;margin-top:10px">' + esc(health.why) + '</p>';
    html += '<div class="actions"><button class="primary" onclick="GMS.sync()">Refresh Fantrax</button>';
    if (TIER !== "paid") html += '<button class="secondary" onclick="GMS.setTier(\'paid\')">Unlock 10 actions (Paid)</button>';
    html += '</div></div>';
    actions.forEach(function (a) {
      html += '<div class="action ' + esc(a.cls || "") + '">';
      html += '<div class="action-type">' + esc(a.type) + ' · <span class="grade">' + esc(a.grade) + '</span></div>';
      html += '<h3>' + esc(a.title) + '</h3>';
      html += '<div class="why">' + esc(a.why) + '</div></div>';
    });
    var watch = freeAgentsApprox().sort(function (a, b) { return projectedPoints(b) - projectedPoints(a); }).slice(0, 5);
    var opp = opponentName();
    var threats = topPlayers(opp, 5);
    html += '<div class="card"><div class="sectionhead"><h2>5 Players to Watch</h2><span class="pill">LEAGUE RADAR</span></div>';
    watch.forEach(function (p) { html += '<div class="gate"><span><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos + ' · ' + p.nfl) + '</span></span><b>' + projectedPoints(p).toFixed(1) + ' proj</b></div>'; });
    if (!watch.length) html += '<div class="muted">Refresh to load the player pool.</div>';
    html += '</div><div class="card"><div class="sectionhead"><h2>Next Opponent: ' + esc(opp) + '</h2><span class="pill">TOP THREATS</span></div>';
    threats.forEach(function (p) { html += '<div class="gate"><span><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos + ' · ' + p.status) + '</span></span><b>' + projectedPoints(p).toFixed(1) + ' proj</b></div>'; });
    if (!threats.length) html += '<div class="muted">Matchup or opponent roster is not available yet.</div>';
    html += '</div>';
    return html;
  }

  function viewTeam() {
    var players = teamPlayers(MY_TEAM);
    var health = rosterHealth(MY_TEAM);
    var html = '<div class="card"><div class="sectionhead"><h2>Capitol Carnage</h2><span class="pill">YOUR TEAM</span></div>';
    html += '<div class="grid4">';
    html += '<div class="metric"><b>' + players.length + '</b><span>Players</span></div>';
    html += '<div class="metric"><b>$' + health.salary.toFixed(1) + '</b><span>Salary</span></div>';
    html += '<div class="metric"><b>$' + health.space.toFixed(1) + '</b><span>Space</span></div>';
    html += '<div class="metric"><b>' + health.grade + '</b><span>Grade</span></div></div></div>';
    var lineup = optimizedLineup();
    html += '<div class="card"><div class="sectionhead"><h2>Weekly Roster Optimizer</h2><span class="pill">VS ' + esc(opponentName()) + '</span></div><div class="notice">Recommended starters balance 65% projected points and 35% current production, while excluding players listed out, suspended, or on injured reserve.</div>';
    html += '<div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>Status</th><th>Projected</th><th>Production</th></tr></thead><tbody>';
    lineup.forEach(function (p) { html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.status) + '</td><td>' + projectedPoints(p).toFixed(1) + '</td><td>' + currentProduction(p).toFixed(1) + '</td></tr>'; });
    if (!lineup.length) html += '<tr><td colspan="5">Refresh to build the lineup.</td></tr>';
    html += '</tbody></table></div></div>';
    html += '<div class="card"><div class="sectionhead"><h2>Roster</h2><span class="pill">' + players.length + '</span></div>';
    html += '<div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>Status</th><th>Sal</th><th>Yrs</th><th>Proj</th><th>B/H/S</th></tr></thead><tbody>';
    players.sort(function (a, b) { return b.salary - a.salary; }).forEach(function (p) {
      var sig = bhsSignal(p);
      html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.status) + '</td><td>$' + p.salary.toFixed(1) + '</td><td>' + p.years + '</td><td>' + projectedPoints(p).toFixed(1) + '</td><td><span class="bhs ' + sig.label.toLowerCase() + '">' + sig.label + '</span></td></tr>';
    });
    if (!players.length) html += '<tr><td colspan="7">No players - Refresh Fantrax</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewTeams() {
    var names = allTeamNames();
    var sel = state.selectedTeam || MY_TEAM;
    if (names.indexOf(sel) < 0 && names.length) sel = names[0];
    var players = teamPlayers(sel);
    var health = rosterHealth(sel);
    var html = '<div class="card"><div class="sectionhead"><h2>League Teams</h2><span class="pill">' + names.length + ' TEAMS</span></div><div class="notice">Select a team to open its full roster.</div>';
    html += '<div class="field"><label>Team</label><select onchange="GMS.selectTeam(this.value)">';
    names.forEach(function (n) {
      html += '<option value="' + esc(n) + '"' + (n === sel ? " selected" : "") + '>' + esc(n) + (n === MY_TEAM ? " (YOU)" : "") + '</option>';
    });
    html += '</select></div>';
    html += '<div class="grid4" style="margin-top:10px">';
    html += '<div class="metric"><b>' + players.length + '</b><span>Players</span></div>';
    html += '<div class="metric"><b>$' + health.salary.toFixed(1) + '</b><span>Salary</span></div>';
    html += '<div class="metric"><b>$' + health.space.toFixed(1) + '</b><span>Space</span></div>';
    html += '<div class="metric"><b>' + health.grade + '</b><span>Grade</span></div></div></div>';
    html += '<div class="card"><div class="sectionhead"><h2>' + esc(sel) + ' Roster</h2></div>';
    html += '<div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>Status</th><th>Salary</th><th>Years left</th><th>Projected pts</th></tr></thead><tbody>';
    players.sort(function (a, b) { return b.salary - a.salary; }).forEach(function (p) {
      html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.status) + '</td><td>$' + p.salary.toFixed(1) + '</td><td>' + p.years + '</td><td>' + projectedPoints(p).toFixed(1) + '</td></tr>';
    });
    if (!players.length) html += '<tr><td colspan="6">Empty - Refresh Fantrax</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewCap() {
    var players = teamPlayers(MY_TEAM);
    var base = projectCuts(players, []);
    var after = projectCuts(players, state.cutIds);
    var html = '<div class="card"><div class="sectionhead"><h2>Cap / Dead Money</h2><span class="pill">ARTICLE IX</span></div>';
    html += '<div class="notice"><b>Pride Bylaws:</b> Cut = <b>100%</b> salary this year. If 2+ years left, next year only: 2yr=40%, 3yr=60%, 4yr=80%, 5yr=85%. Cap +5%/yr. Simulate only.</div>';
    html += '<div class="grid4">';
    html += '<div class="metric"><b>$' + base[0].active.toFixed(1) + '</b><span>Active now</span></div>';
    html += '<div class="metric"><b>$' + base[0].space.toFixed(1) + '</b><span>Space now</span></div>';
    html += '<div class="metric"><b>$' + after[0].dead.toFixed(1) + '</b><span>Dead if cuts</span></div>';
    html += '<div class="metric"><b>$' + after[0].space.toFixed(1) + '</b><span>Space after cuts</span></div></div></div>';
    function table(rows, title) {
      var h = '<div class="card"><div class="sectionhead"><h2>' + esc(title) + '</h2></div>';
      h += '<div class="tableWrap"><table><thead><tr><th>Year</th><th>Active</th><th>Dead</th><th>Total</th><th>Cap</th><th>Space</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        h += '<tr><td><b>' + esc(r.label) + '</b></td><td>$' + r.active.toFixed(1) + '</td><td>$' + r.dead.toFixed(1) + '</td><td><b>$' + r.total.toFixed(1) + '</b></td><td>$' + r.cap.toFixed(1) + '</td><td class="' + (r.space >= 0 ? "good" : "bad") + '">$' + r.space.toFixed(1) + '</td></tr>';
      });
      return h + '</tbody></table></div></div>';
    }
    html += table(base, "Baseline - keep everyone");
    html += table(after, "After selected cuts");
    html += '<div class="card"><div class="sectionhead"><h2>Simulate cuts</h2><span class="pill">' + state.cutIds.length + ' selected</span></div>';
    html += '<div class="actions"><button class="secondary" onclick="GMS.clearCuts()">Clear cuts</button></div>';
    html += '<div class="tableWrap" style="margin-top:8px"><table><thead><tr><th></th><th>Player</th><th>Sal</th><th>Yrs</th><th>Dead Y1</th><th>Dead Y2</th></tr></thead><tbody>';
    players.slice().sort(function (a, b) {
      return deadSchedule(b.salary, b.years).year0 - deadSchedule(a.salary, a.years).year0;
    }).forEach(function (p) {
      var on = state.cutIds.indexOf(p.id) >= 0;
      var sch = deadSchedule(p.salary, p.years);
      html += '<tr style="' + (on ? "background:rgba(180,40,40,0.15)" : "") + '">';
      html += '<td><input type="checkbox" ' + (on ? "checked" : "") + ' onchange="GMS.toggleCut(\'' + esc(p.id) + '\')"></td>';
      html += '<td><b>' + esc(p.name) + '</b></td><td>$' + p.salary.toFixed(1) + '</td><td>' + p.years + '</td><td>$' + sch.year0.toFixed(1) + '</td><td>$' + sch.year1.toFixed(1) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewBHS() {
    var players = allLeaguePlayers();
    var html = '<div class="card"><div class="sectionhead"><h2>Buy / Hold / Sell</h2><span class="pill">ALL PLAYERS</span></div>';
    html += '<div class="notice">Signals use contract length, salary, and status.</div></div>';
    html += '<div class="card"><div class="tableWrap"><table><thead><tr><th>Signal</th><th>Player</th><th>Owner</th><th>Pos</th><th>Proj</th><th>Sal</th><th>Yrs</th><th>Why</th></tr></thead><tbody>';
    players.map(function (p) { return { p: p, s: bhsSignal(p) }; })
      .sort(function (a, b) { return a.s.score - b.s.score; })
      .forEach(function (row) {
        html += '<tr><td><span class="bhs ' + row.s.label.toLowerCase() + '">' + row.s.label + '</span></td><td><b>' + esc(row.p.name) + '</b></td><td>' + esc(row.p.team) + '</td><td>' + esc(row.p.pos) + '</td><td>' + projectedPoints(row.p).toFixed(1) + '</td><td>$' + row.p.salary.toFixed(1) + '</td><td>' + row.p.years + '</td><td class="muted">' + esc(row.s.reasons.join("; ") || "Neutral") + '</td></tr>';
      });
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewWaivers() {
    var fa = freeAgentsApprox().filter(function (p) {
      return /QB|RB|WR|TE|LB|DL|DB|DE|DT|CB|S|EDGE/.test(p.pos);
    }).sort(function (a, b) { return projectedPoints(b) - projectedPoints(a); });
    var html = '<div class="card"><div class="sectionhead"><h2>Waivers</h2><span class="pill">AVAILABLE</span></div>';
    html += '<div class="notice">Full available player pool, ranked by estimated weekly fit. Projections are estimates until Fantrax supplies live scoring projections.</div></div>';
    html += '<div class="card"><div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>NFL</th><th>Projected pts</th><th>Why he fits</th><th>Breakout?</th></tr></thead><tbody>';
    fa.forEach(function (p) {
      var need = teamPlayers(MY_TEAM).filter(function (m) { return m.pos === p.pos; }).length;
      var reason = need < 3 ? "Fills a thin " + p.pos + " room and costs no trade asset." : "Adds competition and injury insurance at " + p.pos + ".";
      var breakout = projectedPoints(p) >= 14 ? "Yes — starter-level ceiling" : projectedPoints(p) >= 10 ? "Possible — monitor role" : "Unlikely now — depth stash";
      html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.nfl) + '</td><td>' + projectedPoints(p).toFixed(1) + '</td><td>' + esc(reason) + '</td><td>' + esc(breakout) + '</td></tr>';
    });
    if (!fa.length) html += '<tr><td colspan="6">Sync Fantrax to load player pool</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewTrade() {
    var names = allTeamNames();
    if (!state.tradeTeamB || state.tradeTeamB === state.tradeTeamA) state.tradeTeamB = names.filter(function (n) { return n !== state.tradeTeamA; })[0] || "";
    function side(team, side) {
      var h = '<div class="card"><div class="field"><label>' + (side === "A" ? "Team giving" : "Other team") + '</label><select onchange="GMS.tradeTeam(\'' + side + '\',this.value)">';
      names.forEach(function (n) { h += '<option value="' + esc(n) + '"' + (n === team ? " selected" : "") + '>' + esc(n) + '</option>'; });
      h += '</select></div><h3>Players and picks</h3>';
      teamPlayers(team).sort(function (a, b) { return projectedPoints(b) - projectedPoints(a); }).forEach(function (p) { var key = "P:" + p.id; var on = state["trade" + side].indexOf(key) >= 0; h += '<label class="gate"><span><input type="checkbox" ' + (on ? "checked" : "") + ' onchange="GMS.tradeAsset(\'' + side + '\',\'' + esc(key) + '\')"> <b>' + esc(p.name) + '</b> <span class="small">' + esc(p.pos) + ' · $' + p.salary.toFixed(1) + ' · ' + projectedPoints(p).toFixed(1) + ' proj</span></span></label>'; });
      var teamObj = teamByName(team);
      (state.picks || []).filter(function (p) { return teamObj && p.currentOwnerTeamId === teamObj.id; }).forEach(function (p, i) { var key = "D:" + p.year + ":" + p.round + ":" + i; var on = state["trade" + side].indexOf(key) >= 0; h += '<label class="gate"><span><input type="checkbox" ' + (on ? "checked" : "") + ' onchange="GMS.tradeAsset(\'' + side + '\',\'' + esc(key) + '\')"> <b>' + esc(p.year + ' Round ' + p.round + ' pick') + '</b></span></label>'; });
      return h + '</div>';
    }
    var html = '<div class="card"><div class="sectionhead"><h2>Trade Lab</h2><span class="pill">PLAYERS + PICKS</span></div><div class="notice"><b>Choose both teams, then select any combination of players and draft picks.</b> Simulate here; execute in Fantrax.</div></div>';
    html += '<div class="grid2">' + side(state.tradeTeamA, "A") + side(state.tradeTeamB, "B") + '</div><div class="card">';
    html += '<div class="actions"><button class="primary" onclick="GMS.evalTrade()">Evaluate trade</button></div>';
    html += '<div id="tradeResult" style="margin-top:12px"></div></div>';
    return html;
  }

  function viewAnalysts() {
    var names = allTeamNames();
    var me = rosterHealth(MY_TEAM);
    var html = '<div class="card"><div class="sectionhead"><h2>League Analysts</h2><span class="pill">YOU VS FIELD</span></div>';
    html += '<div class="grid3">';
    html += '<div class="metric"><b>' + me.grade + '</b><span>Your grade</span></div>';
    html += '<div class="metric"><b>' + me.score + '</b><span>Health</span></div>';
    html += '<div class="metric"><b>$' + me.space.toFixed(0) + '</b><span>Cap space</span></div></div>';
    html += '<p class="muted" style="margin-top:8px">' + esc(me.why) + '</p></div>';
    html += '<div class="card"><div class="sectionhead"><h2>How you match the league</h2></div>';
    names.forEach(function (n) {
      if (n === MY_TEAM) return;
      var h = rosterHealth(n);
      var edge = me.score - h.score;
      html += '<div class="gate"><span><b>' + esc(n) + '</b><br><span class="small">Grade ' + h.grade + '</span></span><b class="' + (edge >= 0 ? "good" : "bad") + '">' + (edge >= 0 ? "+" : "") + edge + '</b></div>';
    });
    html += '</div>';
    return html;
  }

  function viewNews() {
    return '<div class="card"><div class="sectionhead"><h2>News</h2><span class="pill">INJURIES + BREAKING</span></div><div class="notice">ESPN feed.</div><div class="actions"><button class="primary" onclick="GMS.loadNews()">Load NFL news</button></div><div id="newsList" style="margin-top:12px" class="muted">Tap load to fetch.</div></div>';
  }

  function viewChat() {
    var html = '<div class="card"><div class="sectionhead"><h2>GM Chat</h2><span class="pill">SESSION</span></div>';
    html += '<div class="notice">Your Llama-powered personal assistant and fantasy GM. Ask about your league, restaurants, travel, or everyday questions. It remembers this conversation and your preferences on this device.</div>';
    html += '<div class="chat-box"><div class="chat-log" id="chatLog">';
    if (!state.chat.length) html += '<div class="chat-msg ai"><b>GM:</b> Sync Fantrax, then ask about cuts, trades, or cap.</div>';
    else state.chat.forEach(function (m) {
      html += '<div class="chat-msg ' + (m.role === "user" ? "user" : "ai") + '"><b>' + (m.role === "user" ? "You" : "GM") + ':</b> ' + esc(m.text) + '</div>';
    });
    html += '</div><div class="chat-input-row"><input type="text" id="chatInput" placeholder="Ask about your team, restaurants, or anything..." onkeydown="if(event.key===\'Enter\')GMS.sendChat()"><button class="primary" onclick="GMS.sendChat()">Send</button></div></div></div>';
    return html;
  }

  function viewContact() {
    var html = '<div class="card"><div class="sectionhead"><h2>Contact Us</h2><span class="pill">GM LOCKER</span></div>';
    html += '<div class="notice"><b>Questions, feedback, or business?</b></div>';
    html += '<div class="contact-emails">';
    html += '<a class="email-card" href="mailto:gmslocker@gmail.com"><b>gmslocker@gmail.com</b><span>Primary - GM Locker / Pride Dynasty support</span></a>';
    html += '<a class="email-card" href="mailto:pinvaultcollectibles@gmail.com"><b>pinvaultcollectibles@gmail.com</b><span>Pin Vault Collectibles - eBay store</span></a>';
    html += '</div>';
    html += '<div class="notice" style="margin-top:14px">eBay: <a href="https://www.ebay.com/str/pinvaultcollectibles" target="_blank" rel="noopener">pinvaultcollectibles</a></div></div>';
    return html;
  }

  function viewSettings() {
    var html = '<div class="card"><div class="sectionhead"><h2>Settings</h2></div>';
    html += '<div class="field"><label>Coach style</label><select onchange="GMS.setCoach(this.value)">';
    Object.keys(COACHES).forEach(function (k) {
      html += '<option value="' + k + '"' + (COACH === k ? " selected" : "") + '>' + esc(COACHES[k].name) + ' - ' + esc(COACHES[k].lens) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="field"><label>Tier</label><select onchange="GMS.setTier(this.value)">';
    html += '<option value="free"' + (TIER === "free" ? " selected" : "") + '>Free (5 War Room actions)</option>';
    html += '<option value="paid"' + (TIER === "paid" ? " selected" : "") + '>Paid (10 actions + full tools)</option></select></div>';
    html += '<div class="notice">League: <b>Pride Dynasty</b> · Fantrax <code>' + LEAGUE_ID + '</code><br>Team: <b>' + MY_TEAM + '</b><br>Version ' + VERSION + '</div>';
    html += '<div class="actions"><button class="primary" onclick="GMS.sync()">Force Fantrax refresh</button></div></div>';
    return html;
  }

  function viewPicks() {
    var id2name = {};
    Object.keys(state.teams).forEach(function (id) { id2name[id] = state.teams[id].name; });
    var html = '<div class="card"><div class="sectionhead"><h2>Draft Picks</h2><span class="pill">FUTURE</span></div>';
    html += '<div class="tableWrap"><table><thead><tr><th>Year</th><th>Rd</th><th>Owner</th><th>Original</th></tr></thead><tbody>';
    (state.picks || []).slice(0, 80).forEach(function (fp) {
      html += '<tr><td>' + esc(fp.year) + '</td><td>' + esc(fp.round) + '</td><td>' + esc(id2name[fp.currentOwnerTeamId] || fp.currentOwnerTeamId) + '</td><td>' + esc(id2name[fp.originalOwnerTeamId] || fp.originalOwnerTeamId) + '</td></tr>';
    });
    if (!(state.picks || []).length) html += '<tr><td colspan="4">No picks loaded</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  var currentView = localStorage.getItem("gms_view") || "war";

  function render() {
    var asofEl = document.getElementById("asof");
    if (asofEl) {
      asofEl.innerHTML = state.loading
        ? "<b>Syncing Fantrax...</b>"
        : "As of <b>" + esc(formatAsOf()) + "</b> · " + Object.keys(state.teams).length + " teams";
    }
    var main = document.getElementById("main");
    if (!main) return;
    var body = "";
    if (state.error) {
      body += '<div class="error-banner"><b>Sync error:</b> ' + esc(state.error) +
        ' <button class="secondary" onclick="GMS.sync()">Retry</button></div>';
    }
    var map = {
      war: viewWarRoom, team: viewTeam, teams: viewTeams, cap: viewCap,
      bhs: viewBHS, waivers: viewWaivers, trade: viewTrade, analysts: viewAnalysts,
      picks: viewPicks, news: viewNews, chat: viewChat, contact: viewContact, settings: viewSettings
    };
    if (state.loading && !Object.keys(state.teams).length) {
      body += '<div class="loading">Loading Pride Dynasty from Fantrax...</div>';
    }
    body += (map[currentView] || viewWarRoom)();
    main.innerHTML = body;
    document.querySelectorAll(".nav button").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === currentView);
    });
  }

  function show(view) {
    currentView = view;
    try { localStorage.setItem("gms_view", view); } catch (e) {}
    render();
  }

  window.GMS = {
    sync: syncFantrax,
    show: show,
    selectTeam: function (n) { state.selectedTeam = n; render(); },
    tradeTeam: function (side, name) {
      state[side === "A" ? "tradeTeamA" : "tradeTeamB"] = name;
      state[side === "A" ? "tradeA" : "tradeB"] = [];
      render();
    },
    tradeAsset: function (side, key) {
      var list = state[side === "A" ? "tradeA" : "tradeB"];
      var i = list.indexOf(key); if (i >= 0) list.splice(i, 1); else list.push(key);
    },
    toggleCut: function (id) {
      var i = state.cutIds.indexOf(id);
      if (i >= 0) state.cutIds.splice(i, 1); else state.cutIds.push(id);
      render();
    },
    clearCuts: function () { state.cutIds = []; render(); },
    setTier: function (t) {
      TIER = t === "paid" ? "paid" : "free";
      try { localStorage.setItem("gms_tier", TIER); } catch (e) {}
      render();
    },
    setCoach: function (c) {
      COACH = COACHES[c] ? c : "process";
      try { localStorage.setItem("gms_coach", COACH); } catch (e) {}
      render();
    },
    evalTrade: function () {
      var el = document.getElementById("tradeResult");
      if (!el) return;
      function value(side, team) {
        return state["trade" + side].reduce(function (sum, key) {
          if (key.indexOf("P:") === 0) { var p = teamPlayers(team).filter(function (x) { return x.id === key.slice(2); })[0]; return sum + (p ? projectedPoints(p) * 5 + p.years * 4 - p.salary * .05 : 0); }
          var bits = key.split(":"); return sum + Math.max(10, 70 - (Number(bits[1]) - 2026) * 8 - Number(bits[2]) * 10);
        }, 0);
      }
      var a = value("A", state.tradeTeamA), b = value("B", state.tradeTeamB), diff = b - a;
      var verdict = Math.abs(diff) < 12 ? "Balanced framework" : diff > 0 ? state.tradeTeamA + " receives more estimated value" : state.tradeTeamB + " receives more estimated value";
      el.innerHTML = '<div class="notice"><b>' + esc(verdict) + '</b><br>' + esc(state.tradeTeamA) + ': ' + state.tradeA.length + ' assets · value ' + a.toFixed(0) + '<br>' + esc(state.tradeTeamB) + ': ' + state.tradeB.length + ' assets · value ' + b.toFixed(0) + '<br><br>Ask GM Chat for a deeper cap, roster, and dynasty analysis before accepting.</div>';
    },
    loadNews: async function () {
      var el = document.getElementById("newsList");
      if (!el) return;
      el.textContent = "Loading...";
      try {
        var res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=25", { cache: "no-store" });
        var data = await res.json();
        var arts = data.articles || [];
        el.innerHTML = arts.map(function (a) {
          var link = (a.links && a.links.web && a.links.web.href) || "";
          return '<div class="gate"><span><b>' + esc(a.headline) + '</b><br><span class="small">' +
            esc(a.description || "") + '</span></span>' +
            (link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">Open</a>' : "") + '</div>';
        }).join("") || "No articles";
      } catch (e) {
        el.innerHTML = '<span class="bad">News failed: ' + esc(e.message || e) + '</span>';
      }
    },
    sendChat: async function () {
      var input = document.getElementById("chatInput");
      if (!input || !input.value.trim()) return;
      var text = input.value.trim();
      input.value = "";
      state.chat.push({ role: "user", text: text });
      try { localStorage.setItem("gms_chat", JSON.stringify(state.chat.slice(-40))); } catch (e) {}
      render();
      try {
        function aiPlayer(p) {
          return { name: p.name, position: p.pos, salary: p.salary, years: p.years, status: p.status, projectedPoints: projectedPoints(p), currentProduction: currentProduction(p) };
        }
        var leagueRosters = allTeamNames().map(function (teamName) {
          return {
            team: teamName,
            health: rosterHealth(teamName),
            players: teamPlayers(teamName).map(aiPlayer)
          };
        });
        var freeAgents = freeAgentsApprox().map(aiPlayer);
        var response = await fetch(API_BASE + "/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            history: state.chat.slice(0, -1).slice(-60),
            coach: COACHES[COACH] || COACHES.process,
            league: BYLAWS,
            team: { name: MY_TEAM, health: rosterHealth(MY_TEAM), opponent: opponentName(), optimizedLineup: optimizedLineup().map(aiPlayer) },
            leagueRosters: leagueRosters,
            freeAgents: freeAgents,
            draftPicks: state.picks,
            standings: state.standings,
            matchups: state.matchups,
            leagueInfo: state.leagueInfo,
            preferences: localStorage.getItem("gms_preferences") || ""
          })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || "Chat request failed");
        state.chat.push({ role: "ai", text: data.reply || "I couldn't form a response." });
        if (data.preferences) {
          try { localStorage.setItem("gms_preferences", String(data.preferences).slice(0, 12000)); } catch (e) {}
        }
      } catch (e) {
        state.chat.push({ role: "ai", text: "Chat is not connected yet: " + String(e.message || e) });
      }
      try { localStorage.setItem("gms_chat", JSON.stringify(state.chat.slice(-40))); } catch (e) {}
      render();
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".nav button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        show(btn.getAttribute("data-view"));
      });
    });
    render();
    syncFantrax();
  });
})();
