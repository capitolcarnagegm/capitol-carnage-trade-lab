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
  var VERSION = "1.0.3";

  var TIER = localStorage.getItem("gms_tier") || "free";
  var COACH = localStorage.getItem("gms_coach") || "process";

  var state = {
    teams: {}, players: {}, standings: [], picks: [], matchups: null,
    asOf: null, loading: false, error: null, selectedTeam: MY_TEAM,
    cutIds: [], chat: JSON.parse(localStorage.getItem("gms_chat") || "[]")
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
    var url = "https://www.fantrax.com/fxea/general/" + endpoint +
      "?leagueId=" + encodeURIComponent(LEAGUE_ID) + (extra || "");
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
        status: item.status || "ACTIVE", team: teamName
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
      fa.push({ id: id, name: playerName(id), pos: pos, nfl: p.team || "" });
    });
    return fa;
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
    html += '<div class="card"><div class="sectionhead"><h2>Roster</h2><span class="pill">' + players.length + '</span></div>';
    html += '<div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>Status</th><th>Sal</th><th>Yrs</th><th>B/H/S</th></tr></thead><tbody>';
    players.sort(function (a, b) { return b.salary - a.salary; }).forEach(function (p) {
      var sig = bhsSignal(p);
      html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.status) + '</td><td>$' + p.salary.toFixed(1) + '</td><td>' + p.years + '</td><td><span class="bhs ' + sig.label.toLowerCase() + '">' + sig.label + '</span></td></tr>';
    });
    if (!players.length) html += '<tr><td colspan="6">No players - Refresh Fantrax</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewTeams() {
    var names = allTeamNames();
    var sel = state.selectedTeam || MY_TEAM;
    if (names.indexOf(sel) < 0 && names.length) sel = names[0];
    var players = teamPlayers(sel);
    var health = rosterHealth(sel);
    var html = '<div class="card"><div class="sectionhead"><h2>League Teams</h2><span class="pill">' + names.length + ' TEAMS</span></div>';
    html += '<div class="field"><label>Team</label><select onchange="GMS.selectTeam(this.value)">';
    names.forEach(function (n) {
      html += '<option value="' + esc(n) + '"' + (n === sel ? " selected" : "") + ">" + esc(n) + (n === MY_TEAM ? " (YOU)" : "") + "</option>';
    });
    html += '</select></div>';
    html += '<div class="grid4" style="margin-top:10px">';
    html += '<div class="metric"><b>' + players.length + '</b><span>Players</span></div>';
    html += '<div class="metric"><b>$' + health.salary.toFixed(1) + '</b><span>Salary</span></div>';
    html += '<div class="metric"><b>$' + health.space.toFixed(1) + '</b><span>Space</span></div>';
    html += '<div class="metric"><b>' + health.grade + '</b><span>Grade</span></div></div></div>';
    html += '<div class="card"><div class="sectionhead"><h2>' + esc(sel) + ' Roster</h2></div>';
    html += '<div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>Status</th><th>Sal</th><th>Yrs</th></tr></thead><tbody>';
    players.sort(function (a, b) { return b.salary - a.salary; }).forEach(function (p) {
      html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.status) + '</td><td>$' + p.salary.toFixed(1) + '</td><td>' + p.years + '</td></tr>';
    });
    if (!players.length) html += '<tr><td colspan="5">Empty - Refresh Fantrax</td></tr>';
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
    var players = teamPlayers(MY_TEAM);
    var html = '<div class="card"><div class="sectionhead"><h2>Buy / Hold / Sell</h2><span class="pill">YOUR ROSTER</span></div>';
    html += '<div class="notice">Signals use contract length, salary, and status.</div></div>';
    html += '<div class="card"><div class="tableWrap"><table><thead><tr><th>Signal</th><th>Player</th><th>Pos</th><th>Sal</th><th>Yrs</th><th>Why</th></tr></thead><tbody>';
    players.map(function (p) { return { p: p, s: bhsSignal(p) }; })
      .sort(function (a, b) { return a.s.score - b.s.score; })
      .forEach(function (row) {
        html += '<tr><td><span class="bhs ' + row.s.label.toLowerCase() + '">' + row.s.label + '</span></td><td><b>' + esc(row.p.name) + '</b></td><td>' + esc(row.p.pos) + '</td><td>$' + row.p.salary.toFixed(1) + '</td><td>' + row.p.years + '</td><td class="muted">' + esc(row.s.reasons.join("; ") || "Neutral") + '</td></tr>';
      });
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewWaivers() {
    var fa = freeAgentsApprox().filter(function (p) {
      return /QB|RB|WR|TE|LB|DL|DB|DE|DT|CB|S|EDGE/.test(p.pos);
    }).slice(0, 40);
    var html = '<div class="card"><div class="sectionhead"><h2>Waivers</h2><span class="pill">AVAILABLE</span></div>';
    html += '<div class="notice">Open pool sample. Paid unlocks FAAB ranking.</div></div>';
    html += '<div class="card"><div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>NFL</th></tr></thead><tbody>';
    fa.forEach(function (p) {
      html += '<tr><td><b>' + esc(p.name) + '</b></td><td>' + esc(p.pos) + '</td><td>' + esc(p.nfl) + '</td></tr>';
    });
    if (!fa.length) html += '<tr><td colspan="3">Sync Fantrax to load player pool</td></tr>';
    html += '</tbody></table></div></div>';
    return html;
  }

  function viewTrade() {
    var html = '<div class="card"><div class="sectionhead"><h2>Trade Lab</h2><span class="pill">ADVISE ONLY</span></div>';
    html += '<div class="notice"><b>Simulate here. Execute in Fantrax.</b></div>';
    html += '<div class="field"><label>Your side</label><input type="text" id="tradeGive" placeholder="Player A, Player B"></div>';
    html += '<div class="field"><label>Their side</label><input type="text" id="tradeGet" placeholder="Player C"></div>';
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
    html += '<div class="notice">Browser memory. Advise only.</div>';
    html += '<div class="chat-box"><div class="chat-log" id="chatLog">';
    if (!state.chat.length) html += '<div class="chat-msg ai"><b>GM:</b> Sync Fantrax, then ask about cuts, trades, or cap.</div>';
    else state.chat.forEach(function (m) {
      html += '<div class="chat-msg ' + (m.role === "user" ? "user" : "ai") + '"><b>' + (m.role === "user" ? "You" : "GM") + ':</b> ' + esc(m.text) + '</div>';
    });
    html += '</div><div class="chat-input-row"><input type="text" id="chatInput" placeholder="Ask about your team..." onkeydown="if(event.key===\'Enter\')GMS.sendChat()"><button class="primary" onclick="GMS.sendChat()">Send</button></div></div></div>';
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
      var give = (document.getElementById("tradeGive") || {}).value || "";
      var get = (document.getElementById("tradeGet") || {}).value || "";
      el.innerHTML = '<div class="notice"><b>Prototype evaluation</b><br>Give: ' + esc(give || "-") +
        '<br>Get: ' + esc(get || "-") + '<br><br>Info only - complete in Fantrax.</div>';
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
    sendChat: function () {
      var input = document.getElementById("chatInput");
      if (!input || !input.value.trim()) return;
      var text = input.value.trim();
      input.value = "";
      state.chat.push({ role: "user", text: text });
      var health = rosterHealth(MY_TEAM);
      var reply = "Cap space ~$" + health.space.toFixed(0) + " (grade " + health.grade + "). " + health.why;
      if (/cut|dead|cap/i.test(text)) reply = "Under Article IX, a cut hits 100% of salary this year and 40/60/80/85% next year only. Use Cap/Dead to simulate.";
      else if (/trade/i.test(text)) reply = "Trade Lab evaluates both sides. We never submit the trade - you do that in Fantrax.";
      state.chat.push({ role: "ai", text: reply });
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
