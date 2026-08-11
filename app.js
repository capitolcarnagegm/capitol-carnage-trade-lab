/** GM's Locker 1.6 — Fantrax-authoritative league analysis. */
(function () {
  "use strict";

  var LEAGUE_ID = "astbqxhwmk4b6bg9";
  var MY_TEAM = "Capitol Carnage";
  var MY_TEAM_ID = "nsf1b7esmk4b6bgd";
  var CAP_NOW = 1403.9;
  var VERSION = "1.6.12";
  var PAYPAL_MVP_BUTTON_ID = "A4FLSNMZHHLM8";

  function mvpCheckout(location) {
    return '<div class="mvp-checkout"><div><h3>GMS Locker MVP — 12-Month Access</h3><p><b>$49.99 one-time payment.</b> No subscription and no automatic renewal.</p></div><div class="paypal-hosted-button" data-paypal-location="' + esc(location) + '"></div></div>';
  }

  function renderPayPalButtons() {
    if (!window.paypal || !window.paypal.HostedButtons) return;
    document.querySelectorAll('.paypal-hosted-button').forEach(function (container) {
      if (container.getAttribute('data-paypal-rendered') === 'true') return;
      container.setAttribute('data-paypal-rendered', 'true');
      window.paypal.HostedButtons({ hostedButtonId: PAYPAL_MVP_BUTTON_ID }).render(container).catch(function () {
        container.removeAttribute('data-paypal-rendered');
        container.innerHTML = '<span class="small bad">PayPal checkout is temporarily unavailable.</span>';
      });
    });
  }
  if (window.addEventListener) window.addEventListener('load', renderPayPalButtons);
  var API_BASE = "https://api.gmslocker.com";
  var COACH = localStorage.getItem("gms_coach") || "process";

  var COACHES = {
    process: { name: "Process", lens: "Evidence-first, value, age curves, replaceability, and no sentiment." },
    playmaker: { name: "Playmaker", lens: "Ceiling, explosive players, projected scoring, and high-upside moves." },
    culture: { name: "Culture", lens: "Depth, availability, injuries, stability, and dependable weekly roles." },
    matchup: { name: "Matchup", lens: "Current-week projections, opponent weaknesses, and lineup edges." },
    physical: { name: "Physical", lens: "IDP production, front-seven strength, durability, and trench value." },
    aggressive: { name: "Aggressive", lens: "Win-now production, concentrated starters, and calculated risk." },
    builder: { name: "Builder", lens: "Dynasty horizon, picks, age, contracts, and cost-controlled talent." }
  };

  var BYLAWS = {
    name: "Pride Dynasty", cap: CAP_NOW, capInflation: 0.05, salaryRaise: 0.20,
    dead: { 1: 0, 2: 0.4, 3: 0.6, 4: 0.8, 5: 0.85 },
    starters: [
      { slot: "QB", count: 1, accept: ["QB"] }, { slot: "SFX", count: 1, accept: ["QB", "RB", "WR", "TE"] },
      { slot: "RB", count: 2, accept: ["RB"] }, { slot: "WR", count: 3, accept: ["WR"] },
      { slot: "TE", count: 1, accept: ["TE"] }, { slot: "RWT", count: 1, accept: ["RB", "WR", "TE"] },
      { slot: "DL", count: 3, accept: ["DL"] }, { slot: "LB", count: 2, accept: ["LB"] },
      { slot: "DB", count: 3, accept: ["DB"] }, { slot: "ID", count: 2, accept: ["DL", "LB", "DB"] }
    ]
  };

  var EVALUATION_POLICY = {
    teamScope: "Every team evaluation uses the entire Fantrax roster: starters, active depth, Taxi, IR/unavailable, injuries, age, salary value, projections, and prior performance.",
    gameDayException: "Only current-week Game Day analysis compares each team's best legal projected starters.",
    evidence: "Every conclusion must cite the live Fantrax facts that caused it. Missing facts are labeled unavailable; no values are invented.",
    originality: "Reasoning must be specific to the subject and current evidence. Do not reuse canned strengths, weaknesses, summaries, or recommendation wording."
  };

  var state = {
    teams: {}, players: {}, standings: [], picks: [], matchups: {}, leagueInfo: {}, teamData: {}, freeAgentData: {}, news: [], games: [], gamesAsOf: null, gamesError: null, gamesLoading: false, gameSeasonType: 2,
    asOf: null, loading: false, error: null, selectedTeam: MY_TEAM, cutIds: [], simulatedCutIds: [], lineupDraft: null, selectedLineupIndex: null,
    chat: safeJson(localStorage.getItem("gms_chat"), []), tradeTeamA: MY_TEAM, tradeTeamB: "", tradeA: [], tradeB: []
  };

  function safeJson(value, fallback) { try { return JSON.parse(value || "") || fallback; } catch (_) { return fallback; } }
  function esc(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function num(value) { var n = Number(value); return Number.isFinite(n) ? n : null; }
  function money(value) { return value == null ? "—" : "$" + Number(value).toFixed(1); }
  function pts(value) { return value == null ? "—" : Number(value).toFixed(1); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function mean(values) { var good = values.filter(function (v) { return Number.isFinite(v); }); return good.length ? good.reduce(function (a, b) { return a + b; }, 0) / good.length : null; }
  function percentile(value, values) { var good = values.filter(function (v) { return Number.isFinite(v); }).sort(function (a, b) { return a - b; }); if (!good.length || !Number.isFinite(value)) return null; return 100 * good.filter(function (v) { return v <= value; }).length / good.length; }
  function grade(score) { if (!Number.isFinite(score)) return "N/A"; return score >= 93 ? "A" : score >= 88 ? "A-" : score >= 83 ? "B+" : score >= 78 ? "B" : score >= 73 ? "B-" : score >= 68 ? "C+" : score >= 63 ? "C" : score >= 58 ? "C-" : score >= 50 ? "D" : "F"; }
  function primaryPos(value) { var p = String(value || "").toUpperCase(); if (p.indexOf("QB") >= 0) return "QB"; if (p.indexOf("RB") >= 0) return "RB"; if (p.indexOf("WR") >= 0) return "WR"; if (p.indexOf("TE") >= 0) return "TE"; if (/DL|DE|DT|EDGE/.test(p)) return "DL"; if (p.indexOf("LB") >= 0) return "LB"; if (/DB|CB|\bS\b/.test(p)) return "DB"; return p.split(",")[0] || "?"; }
  function unavailable(p) { return /OUT|INJURED_RESERVE|\bIR\b|SUSPEND/i.test(String(p.status) + " " + String(p.rosterSlot) + " " + String(p.injury)); }
  function taxi(p) { return /TAXI|MINOR/i.test(String(p.status) + " " + String(p.rosterSlot)); }

  async function syncFantrax() {
    state.loading = true; state.error = null; render();
    try {
      var response = await fetch(API_BASE + "/league-data?leagueId=" + encodeURIComponent(LEAGUE_ID), { cache: "no-store", headers: { Accept: "application/json" } });
      var data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "Fantrax sync failed");
      state.players = data.players || {};
      state.standings = data.standings || [];
      state.picks = data.picks && data.picks.futureDraftPicks || [];
      state.matchups = data.matchups || {};
      state.leagueInfo = data.leagueInfo || {};
      state.teamData = data.teamData || {};
      state.freeAgentData = data.freeAgents || {};
      state.teams = {};
      Object.keys(data.rosters && data.rosters.rosters || {}).forEach(function (id) {
        var team = data.rosters.rosters[id];
        state.teams[id] = { id: id, name: team.teamName || id, items: team.rosterItems || [], salaryCap: num(team.salaryCap) || CAP_NOW };
      });
      state.asOf = data.syncedAt || new Date().toISOString();
      state.loading = false;
      await refreshNews(false);
    } catch (error) {
      state.loading = false; state.error = String(error.message || error);
    }
    render();
  }

  async function refreshNews(repaint) {
    try {
      var response = await fetch(API_BASE + "/news", { cache: "no-store" });
      var data = await response.json();
      if (response.ok) state.news = data.articles || [];
    } catch (_) {}
    if (repaint !== false) render();
  }

  async function refreshGames(seasonType, repaint) {
    state.gamesLoading = true; state.gamesError = null;
    if (seasonType === 1 || seasonType === 2) state.gameSeasonType = seasonType;
    if (repaint !== false) render();
    try {
      var response = await fetch(API_BASE + "/current-games?seasonType=" + state.gameSeasonType, { cache: "no-store", headers: { Accept: "application/json" } });
      var data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "Current games unavailable");
      state.games = data.games || []; state.gamesAsOf = data.syncedAt || new Date().toISOString();
    } catch (error) { state.gamesError = String(error.message || error); }
    state.gamesLoading = false; if (repaint !== false) render();
  }

  function normalizedName(value) { return String(value || "").toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9]/g, ""); }
  function scoringRules() {
    var rules = [], seen = {};
    function walk(value, path) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(function (item, index) { walk(item, path + "." + index); }); return; }
      var label = value.name || value.label || value.displayName || value.statName || value.category;
      var points = num(value.points != null ? value.points : value.pointValue != null ? value.pointValue : value.value != null ? value.value : value.multiplier);
      if (label && points != null && /pass|rush|receiv|recept|touchdown|interception|fumble|tackle|sack|assist|defen|return|kick|field goal|extra point|safety|two.point/i.test(String(label))) {
        var key = normalizedName(label) + ":" + points;
        if (!seen[key]) { seen[key] = true; rules.push({ label: String(label), points: points, path: path }); }
      }
      Object.keys(value).forEach(function (key) { walk(value[key], path ? path + "." + key : key); });
    }
    walk(state.leagueInfo, "leagueInfo"); return rules;
  }

  var STAT_ALIASES = {
    passingyards: ["passing", "YDS"], passingtouchdowns: ["passing", "TD"], interceptions: ["passing", "INT"],
    rushingyards: ["rushing", "YDS"], rushingtouchdowns: ["rushing", "TD"], receptions: ["receiving", "REC"], receivingyards: ["receiving", "YDS"], receivingtouchdowns: ["receiving", "TD"],
    tacklesolo: ["defensive", "SOLO"], solotackles: ["defensive", "SOLO"], tackleassists: ["defensive", "AST"], sacks: ["defensive", "SACKS"], defensiveinterceptions: ["defensive", "INT"], forcedfumbles: ["defensive", "FF"], fumblerecoveries: ["defensive", "FR"], passesdefended: ["defensive", "PD"]
  };

  function scoringAlias(label) {
    var key = normalizedName(label), exact = STAT_ALIASES[key];
    if (exact) return exact;
    return Object.keys(STAT_ALIASES).filter(function (candidate) { return key.indexOf(candidate) >= 0; }).map(function (candidate) { return STAT_ALIASES[candidate]; })[0] || null;
  }

  function gamePlayerStats(game, player) {
    var rows = (game.players || []).filter(function (row) { return normalizedName(row.name) === normalizedName(player.name) && (!player.nfl || !row.team || row.team === player.nfl); });
    var combined = {};
    rows.forEach(function (row) { Object.keys(row.stats || {}).forEach(function (key) { combined[normalizedName(row.category) + ":" + normalizedName(key)] = num(row.stats[key]); }); });
    return { rows: rows, combined: combined };
  }

  function liveLeaguePoints(game, player) {
    var found = gamePlayerStats(game, player), rules = scoringRules(), contributions = [], unmatched = [];
    if (!found.rows.length) return { matched: false, points: null, contributions: [], unmatched: [], rulesAvailable: rules.length > 0 };
    rules.forEach(function (rule) {
      var alias = scoringAlias(rule.label), value = null;
      if (alias) value = found.combined[normalizedName(alias[0]) + ":" + normalizedName(alias[1])];
      if (value == null) unmatched.push(rule.label); else if (value) contributions.push({ label: rule.label, stat: value, rate: rule.points, points: value * rule.points });
    });
    return { matched: true, points: rules.length && !unmatched.length ? contributions.reduce(function (sum, item) { return sum + item.points; }, 0) : null, contributions: contributions, unmatched: unmatched, rulesAvailable: rules.length > 0 };
  }

  function teamByName(name) { return Object.keys(state.teams).map(function (id) { return state.teams[id]; }).filter(function (team) { return team.name === name; })[0] || null; }
  function teamDetail(teamId, kind, playerId) { return state.teamData[teamId] && state.teamData[teamId][kind] && state.teamData[teamId][kind].players[playerId] || {}; }
  function playerName(id) { var p = state.players[id] || {}; var name = p.name || id; if (name.indexOf(",") >= 0) { var bits = name.split(","); name = bits.slice(1).join(" ").trim() + " " + bits[0].trim(); } return name; }

  function teamPlayers(teamName) {
    var team = teamByName(teamName); if (!team) return [];
    return team.items.map(function (item) {
      var meta = state.players[item.id] || {};
      var season = teamDetail(team.id, "season", item.id);
      var weekly = teamDetail(team.id, "weekly", item.id);
      var performance = teamDetail(team.id, "performance", item.id);
      return {
        id: item.id, name: season.name || weekly.name || playerName(item.id), pos: primaryPos(item.position || meta.position || season.position),
        eligible: state.leagueInfo.playerInfo && state.leagueInfo.playerInfo[item.id] && state.leagueInfo.playerInfo[item.id].eligiblePos || "",
        nfl: meta.team || season.nflTeam || "", salary: num(item.salary) || 0,
        years: num(item.contract && (item.contract.smallId || item.contract.name)) || 0,
        status: item.status || "ACTIVE", rosterSlot: item.rosterSlot || item.positionStatus || item.position || "", team: teamName, age: season.age != null ? season.age : performance.age,
        seasonProjection: season.fpts, weeklyProjection: weekly.fpts != null ? weekly.fpts : weekly.ppg,
        performance: performance.fpts, performancePpg: performance.ppg, opponent: weekly.opponent || season.opponent || "",
        injury: weekly.injury || season.injury || performance.injury || "", rosteredPct: season.rosteredPct, rosterTrend: season.rosterTrend
      };
    });
  }

  function allTeamNames() { return Object.keys(state.teams).map(function (id) { return state.teams[id].name; }).sort(); }
  function allRosteredPlayers() { var out = []; allTeamNames().forEach(function (name) { out = out.concat(teamPlayers(name)); }); return out; }
  function freeAgents() {
    var season = state.freeAgentData.season || {}, weekly = state.freeAgentData.weekly || {}, performance = state.freeAgentData.performance || {};
    var ids = Object.keys(season);
    return ids.map(function (id) {
      var s = season[id] || {}, w = weekly[id] || {}, p = performance[id] || {}, meta = state.players[id] || {};
      return { id: id, name: s.name || w.name || playerName(id), pos: primaryPos(s.position || meta.position), nfl: s.nflTeam || meta.team || "", salary: 0, years: 0, status: "FA", team: "Free Agent", age: s.age, seasonProjection: s.fpts, weeklyProjection: w.ppg, performance: p.fpts, performancePpg: p.ppg, opponent: w.opponent || "", injury: w.injury || s.injury || "", rosteredPct: s.rosteredPct, rosterTrend: s.rosterTrend };
    }).filter(function (p) { return p.name && p.pos !== "?" && !/^(OL|K|LS)$/.test(p.pos); });
  }

  function projection(p) { return num(p.weeklyProjection); }
  function seasonProjection(p) { return num(p.seasonProjection); }
  function production(p) { return num(p.performancePpg) != null ? num(p.performancePpg) : (num(p.performance) != null ? num(p.performance) / 17 : null); }
  function expectedScore(p) { var weekly = projection(p), season = seasonProjection(p), perf = production(p); if (weekly != null) return weekly; if (season != null) return season / 17; return perf; }

  function weeklyRisk(p) {
    var weekly = projection(p), prior = production(p);
    if (weekly == null) return null;
    var peers = allRosteredPlayers().concat(freeAgents()).filter(function (x) { return x.pos === p.pos && projection(x) != null; });
    var positionScore = percentile(weekly, peers.map(projection));
    if (positionScore == null) return null;
    var change = prior == null || prior === 0 ? null : clamp((weekly / prior - 1) * 100, -50, 50);
    var availability = unavailable(p) ? 0 : (p.injury ? 45 : 100);
    var boomParts = [{ value: positionScore, weight: 0.55 }, { value: availability, weight: 0.20 }];
    var bustParts = [{ value: 100 - positionScore, weight: 0.45 }, { value: 100 - availability, weight: 0.20 }];
    if (change != null) {
      boomParts.push({ value: clamp(50 + change, 0, 100), weight: 0.25 });
      bustParts.push({ value: clamp(50 - change, 0, 100), weight: 0.35 });
    }
    function weighted(parts) { var weight = parts.reduce(function (sum, part) { return sum + part.weight; }, 0); return parts.reduce(function (sum, part) { return sum + part.value * part.weight; }, 0) / weight; }
    var boom = weighted(boomParts), bust = weighted(bustParts);
    var verdict = unavailable(p) ? "SIT" : boom >= bust + 15 ? "START" : bust >= boom + 15 ? "SIT" : "FLEX CALL";
    var facts = [pts(weekly) + " Fantrax weekly projection", Math.round(positionScore) + "th percentile among live " + p.pos + " options"];
    if (prior != null) facts.push(pts(prior) + " prior FP/G");
    if (p.opponent) facts.push("vs " + p.opponent);
    if (p.injury) facts.push(p.injury);
    return { boom: boom, bust: bust, ratio: bust > 0 ? boom / bust : null, verdict: verdict, facts: facts };
  }

  function optimize(teamName) {
    var pool = teamPlayers(teamName).filter(function (p) { return !unavailable(p) && expectedScore(p) != null; });
    var used = {}, lineup = [];
    BYLAWS.starters.forEach(function (spec) {
      for (var n = 0; n < spec.count; n++) {
        var pick = pool.filter(function (p) { return !used[p.id] && spec.accept.indexOf(p.pos) >= 0; }).sort(function (a, b) { return expectedScore(b) - expectedScore(a); })[0];
        if (pick) { used[pick.id] = true; lineup.push({ slot: spec.slot, player: pick }); }
        else lineup.push({ slot: spec.slot, player: null });
      }
    });
    return { lineup: lineup, total: lineup.reduce(function (sum, row) { return sum + (row.player ? expectedScore(row.player) : 0); }, 0), missing: lineup.filter(function (row) { return !row.player; }).length };
  }

  function starterSlots() {
    var slots = [];
    BYLAWS.starters.forEach(function (spec) {
      for (var n = 0; n < spec.count; n++) slots.push({ slot: spec.slot, accept: spec.accept.slice() });
    });
    return slots;
  }

  function optimizedLineupIds() {
    return optimize(MY_TEAM).lineup.map(function (row) { return row.player ? row.player.id : null; });
  }

  function validLineupDraft(ids) {
    if (!Array.isArray(ids) || ids.length !== starterSlots().length) return null;
    var players = {}, used = {}, slots = starterSlots(), valid = true;
    teamPlayers(MY_TEAM).forEach(function (p) { players[p.id] = p; });
    ids.forEach(function (id, index) {
      if (!id) return;
      var p = players[id];
      if (!p || used[id] || unavailable(p) || slots[index].accept.indexOf(p.pos) < 0) valid = false;
      used[id] = true;
    });
    return valid ? ids.slice() : null;
  }

  function lineupDraftIds() {
    var stored = validLineupDraft(state.lineupDraft) || validLineupDraft(safeJson(localStorage.getItem("gms_lineup_preview"), null));
    state.lineupDraft = stored || optimizedLineupIds();
    return state.lineupDraft.slice();
  }

  function saveLineupDraft(ids) {
    state.lineupDraft = ids.slice();
    localStorage.setItem("gms_lineup_preview", JSON.stringify(state.lineupDraft));
  }

  function lineupPreview() {
    var ids = lineupDraftIds(), players = {}, slots = starterSlots();
    teamPlayers(MY_TEAM).forEach(function (p) { players[p.id] = p; });
    var lineup = slots.map(function (spec, index) { return { slot: spec.slot, accept: spec.accept, player: players[ids[index]] || null }; });
    return { lineup: lineup, total: lineup.reduce(function (sum, row) { return sum + (row.player ? expectedScore(row.player) || 0 : 0); }, 0) };
  }

  function lineupMatchesOptimizer() {
    var draft = lineupDraftIds(), optimized = optimizedLineupIds();
    return draft.every(function (id, index) { return id === optimized[index]; });
  }

  function reservePlayers() {
    var active = {};
    lineupDraftIds().forEach(function (id) { if (id) active[id] = true; });
    return teamPlayers(MY_TEAM).filter(function (p) { return !active[p.id]; }).sort(function (a, b) {
      if (taxi(a) !== taxi(b)) return taxi(a) ? 1 : -1;
      if (unavailable(a) !== unavailable(b)) return unavailable(a) ? 1 : -1;
      return (expectedScore(b) == null ? -1 : expectedScore(b)) - (expectedScore(a) == null ? -1 : expectedScore(a));
    });
  }

  function completeSum(players, getter) {
    if (!players.length) return 0;
    var values = players.map(getter);
    return values.every(function (value) { return value != null; }) ? values.reduce(function (sum, value) { return sum + value; }, 0) : null;
  }

  function depthMetrics(teamName) {
    var players = teamPlayers(teamName), opt = optimize(teamName), starterIds = {};
    opt.lineup.forEach(function (row) { if (row.player) starterIds[row.player.id] = true; });
    var starters = players.filter(function (p) { return starterIds[p.id]; });
    var bench = players.filter(function (p) { return !starterIds[p.id]; });
    var taxiPlayers = bench.filter(taxi);
    var unavailablePlayers = bench.filter(function (p) { return !taxi(p) && unavailable(p); });
    var active = bench.filter(function (p) { return !taxi(p) && !unavailable(p); });
    var projected = completeSum(active, projection);
    var performance = completeSum(active, production);
    var activeSalary = active.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var starterSalary = starters.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var taxiSalary = taxiPlayers.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var unavailableSalary = unavailablePlayers.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var benchSalary = bench.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var totalSalary = players.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var age = active.length && active.every(function (p) { return num(p.age) != null; }) ? mean(active.map(function (p) { return num(p.age); })) : null;
    var value = projected != null && activeSalary > 0 ? projected / activeSalary * 100 : null;
    var healthPool = bench.filter(function (p) { return !taxi(p); });
    var health = healthPool.length ? active.length / healthPool.length * 100 : null;
    var nextUp = active.filter(function (p) { return projection(p) != null; }).sort(function (a, b) { return projection(b) - projection(a); }).slice(0, 5);
    return { starters: starters, bench: bench, active: active, taxi: taxiPlayers, unavailable: unavailablePlayers, projected: projected, performance: performance, age: age, value: value, health: health, activeSalary: activeSalary, starterSalary: starterSalary, benchSalary: benchSalary, taxiSalary: taxiSalary, unavailableSalary: unavailableSalary, totalSalary: totalSalary, nextUp: nextUp };
  }

  function leagueDepthGrades() {
    var names = allTeamNames(), metrics = {};
    names.forEach(function (name) { metrics[name] = depthMetrics(name); });
    var fields = { projected: [], performance: [], value: [], age: [], health: [] };
    names.forEach(function (name) {
      var m = metrics[name]; fields.projected.push(m.projected); fields.performance.push(m.performance); fields.value.push(m.value); fields.age.push(m.age == null ? null : -m.age); fields.health.push(m.health);
    });
    var out = {};
    names.forEach(function (name) {
      var m = metrics[name];
      var components = [
        { name: "projection", score: percentile(m.projected, fields.projected), weight: 0.4 },
        { name: "prior performance", score: percentile(m.performance, fields.performance), weight: 0.2 },
        { name: "salary value", score: percentile(m.value, fields.value), weight: 0.15 },
        { name: "age", score: percentile(m.age == null ? null : -m.age, fields.age), weight: 0.1 },
        { name: "availability", score: percentile(m.health, fields.health), weight: 0.15 }
      ].filter(function (component) { return component.score != null; });
      var weight = components.reduce(function (sum, component) { return sum + component.weight; }, 0);
      var score = weight ? components.reduce(function (sum, component) { return sum + component.score * component.weight; }, 0) / weight : null;
      out[name] = { score: score, grade: grade(score), metrics: m, components: components, appliedWeight: weight };
    });
    return out;
  }

  function depthExplainer(depth) {
    if (!depth.components || !depth.components.length) return "Depth grade unavailable because Fantrax has not returned enough comparable bench data.";
    return "Depth grade uses " + depth.components.map(function (component) { return component.name + " " + Math.round(component.weight / depth.appliedWeight * 100) + "%"; }).join(", ") + "; missing Fantrax fields are excluded and the remaining weights are rebalanced.";
  }

  function available(value, formatter) { return value == null ? "unavailable" : formatter(value); }

  function teamMetrics(teamName) {
    var players = teamPlayers(teamName);
    var projected = completeSum(players, expectedScore);
    var performance = completeSum(players, production);
    var age = players.length && players.every(function (p) { return num(p.age) != null; }) ? mean(players.map(function (p) { return num(p.age); })) : null;
    var salary = players.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var injured = players.filter(unavailable).length;
    var health = players.length ? (players.length - injured) / players.length * 100 : null;
    var value = projected != null && salary > 0 ? projected / salary * 100 : null;
    return { players: players.length, projected: projected, performance: performance, age: age, salary: salary, injured: injured, health: health, value: value };
  }

  function leagueGrades() {
    var names = allTeamNames(), metrics = {}; names.forEach(function (name) { metrics[name] = teamMetrics(name); });
    var arrays = { projected: names.map(function (n) { return metrics[n].projected; }), performance: names.map(function (n) { return metrics[n].performance; }), value: names.map(function (n) { return metrics[n].value; }), age: names.map(function (n) { return metrics[n].age; }), health: names.map(function (n) { return metrics[n].health; }) };
    var out = {};
    names.forEach(function (name) {
      var m = metrics[name];
      var components = [
        { name: "Projection", score: percentile(m.projected, arrays.projected), weight: 0.4 },
        { name: "Performance", score: percentile(m.performance, arrays.performance), weight: 0.2 },
        { name: "Value", score: percentile(m.value, arrays.value), weight: 0.15 },
        { name: "Age", score: percentile(m.age == null ? null : -m.age, arrays.age.map(function (x) { return x == null ? null : -x; })), weight: 0.1 },
        { name: "Health", score: percentile(m.health, arrays.health), weight: 0.15 }
      ].filter(function (c) { return c.score != null; });
      var weight = components.reduce(function (s, c) { return s + c.weight; }, 0);
      var score = weight ? components.reduce(function (s, c) { return s + c.score * c.weight; }, 0) / weight : null;
      out[name] = { score: score, grade: grade(score), metrics: m, components: components, appliedWeight: weight, scope: "full roster" };
    });
    return out;
  }

  function leaguePowerGrades() {
    var fullRosterGrades = leagueGrades(), depthGrades = leagueDepthGrades(), out = {};
    allTeamNames().forEach(function (name) {
      var fullRoster = fullRosterGrades[name] || {}, depth = depthGrades[name] || {};
      var starterMetrics = starterTeamMetrics(name);
      out[name] = {
        score: fullRoster.score,
        grade: fullRoster.grade,
        fullRoster: fullRoster,
        starters: { metrics: starterMetrics },
        depth: depth,
        components: fullRoster.components || [],
        appliedWeight: fullRoster.appliedWeight
      };
    });
    return out;
  }

  function starterTeamMetrics(teamName) {
    var opt = optimize(teamName);
    return {
      projected: opt.total,
      performance: completeSum(opt.lineup.filter(function (row) { return row.player; }).map(function (row) { return row.player; }), production),
      age: mean(opt.lineup.map(function (row) { return row.player && num(row.player.age); })),
      missing: opt.missing
    };
  }

  function opponentName() {
    var games = state.matchups.matchups || [];
    for (var i = 0; i < games.length; i++) {
      if (games[i].home && games[i].home.teamName === MY_TEAM) return games[i].away.teamName;
      if (games[i].away && games[i].away.teamName === MY_TEAM) return games[i].home.teamName;
    }
    return "Opponent not loaded";
  }

  function teamPicks(teamName) {
    var team = teamByName(teamName); if (!team) return [];
    return state.picks.filter(function (pick) { return pick.currentOwnerTeamId === team.id; }).map(function (pick) {
      var original = state.teams[pick.originalOwnerTeamId];
      return { year: pick.year, round: pick.round, original: original && original.name || "Original team unavailable" };
    });
  }

  function existingDead(teamName) {
    var team = teamByName(teamName); var info = team && state.teamData[team.id] && state.teamData[team.id].season || {};
    var rows = info.capPenaltyData && info.capPenaltyData.tableData || [];
    return rows.map(function (row) { return { name: row.scorer && row.scorer.name || "Unknown", amount: Number(String(row.salaryAmount || 0).replace(/[^0-9.\-]/g, "")) || 0, year: row.endingSeasonYear, description: String(row.description || "").replace(/<[^>]*>/g, "") }; });
  }

  function salaryInfo(teamName) {
    var team = teamByName(teamName); var info = team && state.teamData[team.id] && state.teamData[team.id].season || {};
    var result = {}; (info.salaryInfo || []).forEach(function (row) { result[row.key] = num(row.value); }); return result;
  }

  function deadSchedule(salary, years) { var y = Math.max(1, Number(years) || 1), s = Number(salary) || 0; return { now: s, next: s * (BYLAWS.dead[y] == null ? 0 : BYLAWS.dead[y]) }; }

  function capProjection(teamName, cutIds) {
    var players = teamPlayers(teamName), penalties = existingDead(teamName), cuts = {};
    (cutIds || []).forEach(function (id) { cuts[id] = true; });
    var currentYear = new Date().getFullYear();
    var dated = penalties.some(function (row) { return num(row.year) != null; });
    var currentDead = penalties.filter(function (row) { return !dated || num(row.year) == null || num(row.year) === currentYear; }).reduce(function (sum, row) { return sum + row.amount; }, 0);
    var existingNextDead = penalties.filter(function (row) { return num(row.year) === currentYear + 1; }).reduce(function (sum, row) { return sum + row.amount; }, 0);
    var selectedCuts = players.filter(function (p) { return cuts[p.id]; });
    var team = teamByName(teamName), cap = team && team.salaryCap != null ? team.salaryCap : CAP_NOW;
    var rosterSalary = players.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var cutSalary = selectedCuts.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var newDeadNow = selectedCuts.reduce(function (sum, p) { return sum + deadSchedule(p.salary, p.years).now; }, 0);
    var newDeadNext = selectedCuts.reduce(function (sum, p) { return sum + deadSchedule(p.salary, p.years).next; }, 0);
    var expiring = players.filter(function (p) { return !cuts[p.id] && p.years <= 1; });
    var returning = players.filter(function (p) { return !cuts[p.id] && p.years > 1; });
    var expiringSalary = expiring.reduce(function (sum, p) { return sum + p.salary; }, 0);
    var nextRosterSalary = returning.reduce(function (sum, p) { return sum + p.salary * (1 + BYLAWS.salaryRaise); }, 0);
    var nextDead = existingNextDead + newDeadNext;
    return {
      cap: cap, nextCap: cap * (1 + BYLAWS.capInflation), rosterSalary: rosterSalary, currentDead: currentDead,
      currentUsed: rosterSalary + currentDead, currentRoom: cap - rosterSalary - currentDead,
      cutSalary: cutSalary, newDeadNow: newDeadNow, newDeadNext: newDeadNext,
      afterRosterSalary: rosterSalary - cutSalary, afterDead: currentDead + newDeadNow,
      afterUsed: rosterSalary - cutSalary + currentDead + newDeadNow,
      expiringCount: expiring.length, expiringSalary: expiringSalary, returningCount: returning.length,
      nextRosterSalary: nextRosterSalary, existingNextDead: existingNextDead, nextDead: nextDead,
      nextUsed: nextRosterSalary + nextDead, nextRoom: cap * (1 + BYLAWS.capInflation) - nextRosterSalary - nextDead
    };
  }

  function playerSignal(p) {
    var same = allRosteredPlayers().filter(function (x) { return x.pos === p.pos && expectedScore(x) != null; });
    var projPct = percentile(expectedScore(p), same.map(expectedScore));
    var value = expectedScore(p) != null ? expectedScore(p) / Math.max(1, p.salary) : null;
    var valuePct = percentile(value, same.map(function (x) { return expectedScore(x) == null ? null : expectedScore(x) / Math.max(1, x.salary); }));
    var agePct = percentile(p.age == null ? null : -p.age, same.map(function (x) { return x.age == null ? null : -x.age; }));
    var score = mean([projPct, valuePct, agePct]);
    var label = score == null ? "HOLD" : (score >= 67 && !unavailable(p) ? "BUY" : score <= 33 || unavailable(p) ? "SELL" : "HOLD");
    var reasons = [];
    if (projPct != null) reasons.push("projection percentile " + Math.round(projPct));
    if (valuePct != null) reasons.push("salary-value percentile " + Math.round(valuePct));
    if (p.age != null) reasons.push("age " + p.age);
    if (p.injury) reasons.push(p.injury);
    return { label: label, score: score, reasons: reasons };
  }

  function teamNeeds(teamName) {
    var opt = optimize(teamName), needs = {};
    opt.lineup.filter(function (row) { return !row.player; }).forEach(function (row) { needs[row.slot] = (needs[row.slot] || 0) + 1; });
    var counts = {}; teamPlayers(teamName).forEach(function (p) { counts[p.pos] = (counts[p.pos] || 0) + 1; });
    ["QB", "RB", "WR", "TE", "DL", "LB", "DB"].forEach(function (pos) { if ((counts[pos] || 0) < (pos === "WR" ? 5 : 3)) needs[pos] = (needs[pos] || 0) + 1; });
    return needs;
  }

  function waiverReason(p) {
    var needs = teamNeeds(MY_TEAM), need = needs[p.pos] || 0, score = expectedScore(p), mine = teamPlayers(MY_TEAM).filter(function (x) { return x.pos === p.pos && expectedScore(x) != null; }).sort(function (a, b) { return expectedScore(a) - expectedScore(b); });
    var replace = mine[0]; var pieces = [];
    if (need) pieces.push("fills a " + p.pos + " depth/lineup need"); else pieces.push("adds competition at " + p.pos);
    if (replace && score != null) pieces.push((score - expectedScore(replace) >= 0 ? "projects " + (score - expectedScore(replace)).toFixed(1) + " above " : "does not out-project ") + replace.name);
    if (p.performancePpg != null) pieces.push("produced " + p.performancePpg.toFixed(1) + " FP/G last season");
    if (p.rosteredPct != null) pieces.push(p.rosteredPct.toFixed(0) + "% rostered on Fantrax");
    if (p.injury) pieces.push("risk: " + p.injury);
    return pieces.join("; ") + ".";
  }

  function waiverAdvice(p) {
    var score = expectedScore(p);
    var mine = teamPlayers(MY_TEAM).filter(function (x) { return x.pos === p.pos && expectedScore(x) != null; }).sort(function (a, b) { return expectedScore(a) - expectedScore(b); });
    var replacement = mine[0] || null;
    var need = (teamNeeds(MY_TEAM)[p.pos] || 0) > 0;
    var verdict = unavailable(p) ? "PASS" : (need || (replacement && score != null && score > expectedScore(replacement)) ? "PICK UP" : "MONITOR");
    var reason = waiverReason(p);
    if (verdict === "PASS") reason = "Do not bid while Fantrax marks this player unavailable. " + reason;
    else if (verdict === "MONITOR") reason = "Not a current projected upgrade or identified depth need. " + reason;
    else reason = "Recommended pickup. " + reason;

    if (score == null) return { verdict: verdict, reason: reason, maxBid: null, bidBasis: "Fantrax expectation unavailable" };
    var comparables = allRosteredPlayers().filter(function (x) { return x.pos === p.pos && expectedScore(x) != null && x.salary > 0; }).sort(function (a, b) { return Math.abs(expectedScore(a) - score) - Math.abs(expectedScore(b) - score); });
    var comparable = comparables[0] || null;
    if (!comparable) return { verdict: verdict, reason: reason, maxBid: null, bidBasis: "No salaried Fantrax comparable available" };
    var room = capProjection(MY_TEAM, []).currentRoom;
    var maxBid = verdict === "PASS" ? 0 : Math.max(0, Math.min(room, comparable.salary));
    return { verdict: verdict, reason: reason, maxBid: maxBid, bidBasis: "Capped by " + comparable.name + " (" + money(comparable.salary) + ") and current room" };
  }

  function hiddenGems() {
    var pool = freeAgents().filter(function (p) {
      return !unavailable(p) && expectedScore(p) != null && (num(p.rosteredPct) != null || num(p.rosterTrend) != null);
    });
    var needs = teamNeeds(MY_TEAM);
    var byPosition = {};
    pool.forEach(function (p) { (byPosition[p.pos] || (byPosition[p.pos] = [])).push(p); });
    var candidates = pool.map(function (p) {
      var same = byPosition[p.pos] || [];
      var components = [
        { name: "expectation", score: percentile(expectedScore(p), same.map(expectedScore)), weight: 0.4 },
        { name: "prior production", score: percentile(production(p), same.map(production)), weight: 0.2 },
        { name: "low roster rate", score: percentile(num(p.rosteredPct) == null ? null : -num(p.rosteredPct), same.map(function (x) { return num(x.rosteredPct) == null ? null : -num(x.rosteredPct); })), weight: 0.15 },
        { name: "roster trend", score: percentile(num(p.rosterTrend), same.map(function (x) { return num(x.rosterTrend); })), weight: 0.15 },
        { name: "age", score: percentile(num(p.age) == null ? null : -num(p.age), same.map(function (x) { return num(x.age) == null ? null : -num(x.age); })), weight: 0.1 }
      ].filter(function (component) { return component.score != null; });
      var weight = components.reduce(function (sum, component) { return sum + component.weight; }, 0);
      var evidenceScore = weight ? components.reduce(function (sum, component) { return sum + component.score * component.weight; }, 0) / weight : null;
      var projectionRank = percentile(expectedScore(p), same.map(expectedScore));
      var overlooked = num(p.rosteredPct) != null ? num(p.rosteredPct) <= 50 : num(p.rosterTrend) > 0;
      var qualifies = evidenceScore != null && projectionRank != null && projectionRank >= 60 && overlooked;
      var fitBonus = needs[p.pos] ? 5 : 0;
      var advice = waiverAdvice(p);
      var facts = [];
      facts.push(pts(expectedScore(p)) + " expected points, " + Math.round(projectionRank) + "th percentile among available " + p.pos + "s");
      if (production(p) != null) facts.push(pts(production(p)) + " prior FP/G");
      if (num(p.rosteredPct) != null) facts.push(num(p.rosteredPct).toFixed(0) + "% rostered");
      if (num(p.rosterTrend) != null) facts.push((num(p.rosterTrend) > 0 ? "+" : "") + num(p.rosterTrend).toFixed(0) + "% Fantrax trend");
      if (num(p.age) != null) facts.push("age " + num(p.age));
      if (needs[p.pos]) facts.push("fills a Capitol Carnage " + p.pos + " need");
      else {
        var mine = teamPlayers(MY_TEAM).filter(function (x) { return x.pos === p.pos && expectedScore(x) != null; }).sort(function (a, b) { return expectedScore(a) - expectedScore(b); });
        if (mine[0]) facts.push((expectedScore(p) >= expectedScore(mine[0]) ? "projects above " : "adds competition behind ") + mine[0].name);
      }
      return { player: p, score: evidenceScore == null ? null : evidenceScore + fitBonus, evidenceScore: evidenceScore, projectionRank: projectionRank, qualifies: qualifies, facts: facts, advice: advice };
    }).filter(function (gem) { return gem.qualifies; });
    return candidates.sort(function (a, b) { return b.score - a.score || expectedScore(b.player) - expectedScore(a.player); }).slice(0, 10);
  }

  function keyNews() {
    var myTeams = {}; teamPlayers(MY_TEAM).forEach(function (p) { if (p.nfl) myTeams[p.nfl] = true; });
    var relevant = state.news.filter(function (article) { return (article.teams || []).some(function (team) { return myTeams[team]; }); });
    return (relevant.length ? relevant : state.news).slice(0, 5);
  }

  function viewWar() {
    var grades = leagueGrades(), mine = grades[MY_TEAM] || {}, opp = opponentName(), myOpt = optimize(MY_TEAM), oppOpt = optimize(opp);
    var gems = hiddenGems();
    var threats = teamPlayers(opp).filter(function (p) { return expectedScore(p) != null; }).sort(function (a, b) { return expectedScore(b) - expectedScore(a); }).slice(0, 5);
    var html = '<div class="card"><div class="sectionhead"><h2>What should I do today?</h2><span class="pill">FANTRAX LIVE</span></div><div class="notice"><b>Full-roster rule:</b> the roster grade covers every player. Only the current-week Game Day edge below compares best legal starters. Every reason is tied to current Fantrax evidence; unavailable data is never replaced or invented.</div><div class="actions"><button class="primary" onclick="GMS.sync()">Refresh analysis</button><button class="secondary" onclick="GMS.news()">Refresh news</button></div></div>';
    html += '<div class="grid4"><div class="metric"><b>' + esc(mine.grade || "N/A") + '</b><span>Live roster grade</span></div><div class="metric"><b>' + pts(myOpt.total) + '</b><span>Expected lineup</span></div><div class="metric"><b>' + pts(oppOpt.total) + '</b><span>' + esc(opp) + '</span></div><div class="metric"><b class="' + (myOpt.total >= oppOpt.total ? "good" : "bad") + '">' + (myOpt.total >= oppOpt.total ? "+" : "") + pts(myOpt.total - oppOpt.total) + '</b><span>Current-week edge</span></div></div>';
    html += '<div class="card hidden-gems"><div class="sectionhead"><div><h2>Top 10 Hidden Gems in Free Agency</h2><span class="small muted">Live Fantrax value targets for Capitol Carnage</span></div><span class="pill">BUY WATCHLIST</span></div><div class="notice">Up to 10 players are shown. A hidden gem must rank at or above the 60th projection percentile among available players at his position and also be overlooked (50% rostered or less, or rising when roster percentage is unavailable). Ranking then uses Fantrax expectation 40%, prior production 20%, low roster rate 15%, trend 15%, and age 10%, reweighted when fields are missing, with a small roster-need tiebreaker.</div>';
    if (!gems.length) html += '<div class="muted">No free agent currently clears the live hidden-gem evidence rules.</div>';
    gems.forEach(function (gem, index) { var p = gem.player, bid = gem.advice.maxBid == null ? "unavailable" : money(gem.advice.maxBid); html += '<div class="gem-card"><div class="gem-rank">' + (index + 1) + '</div><div class="gem-body"><div class="sectionhead"><div><h3>' + esc(p.name) + ' <span class="teamBadge">' + esc(p.pos) + '</span></h3><span class="small">' + esc(p.nfl || "NFL team unavailable") + (p.injury ? ' · ' + esc(p.injury) : '') + '</span></div><div class="gem-bid"><b>' + bid + '</b><span>Max blind bid</span></div></div><p><b>Why buy:</b> ' + esc(gem.facts.join("; ")) + '.</p><p class="muted">Evidence score ' + gem.evidenceScore.toFixed(1) + ' · ' + esc(gem.advice.bidBasis) + '</p></div></div>'; });
    html += '</div><div class="card"><h2>Opponent threats</h2>' + threats.map(function (p) { return '<div class="gate"><span><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos + " · " + (p.injury || "No Fantrax injury flag")) + '</span></span><b>' + pts(expectedScore(p)) + '</b></div>'; }).join("") + '</div>';
    html += '<div class="card"><div class="sectionhead"><h2>Key news brief</h2><span class="pill">ESPN</span></div>' + keyNews().map(newsRow).join("") + (!state.news.length ? '<div class="muted">News is loading. Tap Refresh news.</div>' : "") + '</div>';
    return html;
  }

  function viewStartSit() {
    var players = teamPlayers(MY_TEAM), opt = optimize(MY_TEAM), starterIds = {};
    opt.lineup.forEach(function (row) { if (row.player) starterIds[row.player.id] = true; });
    var ordered = players.slice().sort(function (a, b) {
      var aStart = starterIds[a.id] ? 1 : 0, bStart = starterIds[b.id] ? 1 : 0;
      return bStart - aStart || (projection(b) == null ? -1 : projection(b)) - (projection(a) == null ? -1 : projection(a));
    });
    var html = '<div class="card"><div class="sectionhead"><div><h2>Weekly Start / Sit</h2><span class="small">Capitol Carnage · best legal Pride Dynasty lineup</span></div><div class="actions"><span class="pill">FANTRAX LIVE</span><button class="primary" onclick="GMS.sync()">Refresh week</button></div></div><div class="notice"><b>GMS Boom/Bust Ratio:</b> The weekly model weighs Fantrax projection, positional startability, prior production, and injury availability. It is an explainable decision index—not a claimed probability. A 2.0× ratio means the measured boom index is twice the bust index.</div></div>';
    html += '<div class="grid4"><div class="metric"><b>' + opt.lineup.filter(function (row) { return row.player; }).length + '</b><span>Projected starters</span></div><div class="metric"><b>' + pts(opt.total) + '</b><span>Starter projection</span></div><div class="metric"><b>' + ordered.filter(function (p) { return !starterIds[p.id] && !unavailable(p); }).length + '</b><span>Playable bench</span></div><div class="metric"><b>' + ordered.filter(unavailable).length + '</b><span>Unavailable</span></div></div>';
    html += '<div class="card"><div class="tableWrap"><table class="startsit-table"><thead><tr><th>Call</th><th>Player</th><th>Role</th><th>Opp</th><th>Week</th><th>Boom</th><th>Bust</th><th>Ratio</th><th>Why</th></tr></thead><tbody>';
    ordered.forEach(function (p) {
      var risk = weeklyRisk(p), role = starterIds[p.id] ? "PROJECTED STARTER" : (taxi(p) ? "TAXI" : unavailable(p) ? "UNAVAILABLE" : "BENCH");
      if (!risk) {
        html += '<tr><td><span class="bhs hold">UNAVAILABLE</span></td><td><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos) + '</span></td><td>' + role + '</td><td>' + esc(p.opponent || "—") + '</td><td>—</td><td colspan="3">unavailable</td><td>Fantrax weekly projection unavailable; no ratio calculated.</td></tr>';
        return;
      }
      var call = starterIds[p.id] && risk.verdict === "FLEX CALL" ? "START" : risk.verdict;
      html += '<tr><td><span class="start-call ' + call.toLowerCase().replace(/\s/g, "-") + '">' + esc(call) + '</span></td><td><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos + (p.nfl ? " · " + p.nfl : "")) + '</span></td><td>' + role + '</td><td>' + esc(p.opponent || "—") + '</td><td>' + pts(projection(p)) + '</td><td><b class="good">' + risk.boom.toFixed(0) + '</b></td><td><b class="bad">' + risk.bust.toFixed(0) + '</b></td><td><b>' + (risk.ratio == null ? "unavailable" : risk.ratio.toFixed(2) + "×") + '</b></td><td>' + esc(risk.facts.join(" · ")) + '</td></tr>';
    });
    return html + '</tbody></table></div><p class="muted">The optimizer selects the highest live expected legal lineup and excludes OUT/IR players. Opponent is displayed from Fantrax but is not scored as favorable or unfavorable unless a live matchup-strength field is available.</p></div>';
  }

  function viewTeam() {
    var g = leagueGrades()[MY_TEAM] || {}, depth = leagueDepthGrades()[MY_TEAM] || {}, dm = depth.metrics || {}, opt = optimize(MY_TEAM), preview = lineupPreview(), starter = starterTeamMetrics(MY_TEAM), players = teamPlayers(MY_TEAM), matches = lineupMatchesOptimizer(), reserves = reservePlayers(), selectedIndex = state.selectedLineupIndex, selectedRow = selectedIndex == null ? null : preview.lineup[selectedIndex];
    var html = '<div class="card"><div class="sectionhead"><h2>My Team</h2><span class="pill">FULL ROSTER ' + esc(g.grade || "N/A") + '</span></div><div class="notice">The overall grade evaluates the entire Fantrax roster—starters, active depth, Taxi, and IR/unavailable—using projection (40%), prior performance (20%), salary value (15%), age (10%), and availability (15%). The starter figures below are lineup facts, not the team grade.</div><div class="grid4"><div class="metric"><b>' + pts(starter.projected) + '</b><span>Expected starters</span></div><div class="metric"><b>' + available(starter.performance, pts) + '</b><span>Prior FP/G lineup</span></div><div class="metric"><b>' + available(starter.age, function (value) { return value.toFixed(1); }) + '</b><span>Starter age</span></div><div class="metric"><b>' + (g.metrics ? g.metrics.injured : "—") + '</b><span>Full-roster unavailable</span></div></div></div>';
    html += '<div class="card lineup-editor"><div class="sectionhead"><div><h2>Optimization / Lineup Preview</h2><span class="small muted">Tap Active to highlight a starter, then move him to Reserve or swap in an eligible reserve</span></div><div class="actions"><button class="primary" onclick="GMS.applyOptimizedLineup()">Apply optimized lineup</button><button class="secondary" onclick="GMS.resetLineupPreview()">Reset preview</button><button class="secondary" onclick="GMS.sync()">Refresh projections</button></div></div><div class="notice"><b>League-scored simulation:</b> weekly and season projections come from the live Pride Fantrax scoring setup, including Superflex / two-QB lineup eligibility, TE premium, sack premium, and the league\'s other scoring settings. GMS Locker does not create replacement projections. Fantrax is not changed.</div><div class="lineup-summary"><span class="pill ' + (matches ? 'lineup-matched' : '') + '">' + (matches ? 'MATCHES OPTIMIZER' : 'CUSTOM PREVIEW') + '</span><b>' + pts(preview.total) + ' projected points</b><span>Optimizer: ' + pts(opt.total) + '</span><span class="projection-delta ' + (preview.total >= opt.total ? 'good' : 'bad') + '">' + (preview.total - opt.total >= 0 ? '+' : '') + pts(preview.total - opt.total) + ' vs optimized</span></div><div class="lineup-workspace"><section><h3 class="lineup-zone-title">Active lineup</h3><div class="active-lineup-list">';
    preview.lineup.forEach(function (row, index) {
      var p = row.player, isSelected = selectedIndex === index;
      html += '<div class="lineup-player active-player' + (isSelected ? ' selected-player' : '') + '"><button type="button" class="active-toggle" aria-pressed="' + (isSelected ? 'true' : 'false') + '" onclick="GMS.selectActive(' + index + ')">' + (isSelected ? 'SELECTED' : 'ACTIVE') + '</button><div class="lineup-player-main"><b>' + esc(p ? p.name : 'Open starter spot') + '</b><span>' + esc(row.slot + (p ? ' · ' + p.pos + (p.opponent ? ' · vs ' + p.opponent : '') : '')) + '</span></div><div class="lineup-points"><b>' + (p ? pts(projection(p)) : '—') + '</b><span>week</span></div></div>';
    });
    html += '</div></section><section class="reserve-zone"><div class="reserve-heading"><div><h3 class="lineup-zone-title">Reserve spots</h3><span class="small muted">Bench, Taxi, and unavailable players stay separated</span></div>' + (selectedRow && selectedRow.player ? '<button class="reserve-drop" onclick="GMS.moveSelectedToReserve()">Move ' + esc(selectedRow.player.name) + ' to reserve</button>' : '<span class="pill">SELECT AN ACTIVE PLAYER</span>') + '</div><div class="reserve-list">';
    reserves.forEach(function (p) {
      var usable = !taxi(p) && !unavailable(p), fits = selectedRow && selectedRow.accept.indexOf(p.pos) >= 0, canSwap = selectedRow && usable && fits;
      var group = taxi(p) ? 'TAXI' : unavailable(p) ? 'IR / UNAVAILABLE' : 'ACTIVE RESERVE';
      html += '<div class="lineup-player reserve-player' + (canSwap ? ' legal-reserve' : '') + '"><span class="reserve-status">' + group + '</span><div class="lineup-player-main"><b>' + esc(p.name) + '</b><span>' + esc(p.pos + (p.opponent ? ' · vs ' + p.opponent : '') + (p.injury ? ' · ' + p.injury : '')) + '</span></div><div class="lineup-points"><b>' + pts(projection(p)) + '</b><span>week</span></div><button type="button" class="swap-button" onclick="GMS.swapSelectedWithReserve(\'' + esc(p.id) + '\')"' + (canSwap ? '' : ' disabled') + '>' + (selectedRow ? (canSwap ? 'START HERE' : fits ? 'NOT PLAYABLE' : 'NOT ELIGIBLE') : 'SELECT ACTIVE') + '</button></div>';
    });
    html += '</div></section></div><p class="muted">Select an Active player first. Moving him to Reserve leaves that starter slot open; choosing Start Here swaps the selected starter with a healthy, position-eligible reserve. Taxi and unavailable players cannot be started.</p></div>';
    html += '<div class="card depth-card"><div class="sectionhead"><div><h2>Depth / Bench</h2><span class="small muted">Players outside the best projected Pride starting lineup</span></div><span class="pill">DEPTH GRADE ' + esc(depth.grade || "N/A") + '</span></div><div class="notice">' + esc(depthExplainer(depth)) + ' Active-depth projection and prior FP/G cover all usable bench players; a total is unavailable if any player in that group is missing the required Fantrax field.</div><div class="grid4"><div class="metric"><b>' + available(dm.projected, pts) + '</b><span>Active bench projection</span></div><div class="metric"><b>' + available(dm.performance, pts) + '</b><span>Active bench prior FP/G</span></div><div class="metric"><b>' + available(dm.benchSalary, money) + '</b><span>Total bench salary</span></div><div class="metric"><b>' + available(dm.age, function (value) { return value.toFixed(1); }) + '</b><span>Active depth age</span></div></div>';
    html += '<div class="depth-split"><div class="depth-bucket"><b>Active depth</b><span>' + (dm.active ? dm.active.length : "—") + ' players · ' + money(dm.activeSalary) + '</span></div><div class="depth-bucket"><b>Taxi</b><span>' + (dm.taxi ? dm.taxi.length : "—") + ' players · ' + money(dm.taxiSalary) + '</span></div><div class="depth-bucket"><b>IR / unavailable</b><span>' + (dm.unavailable ? dm.unavailable.length : "—") + ' players · ' + money(dm.unavailableSalary) + '</span></div></div>';
    html += '<div class="salary-check"><b>Salary reconciliation:</b> starters ' + money(dm.starterSalary) + ' + bench ' + money(dm.benchSalary) + ' = roster ' + money(dm.totalSalary) + '</div><h3 class="depth-heading">Next up by Fantrax weekly projection</h3>';
    if (dm.nextUp && dm.nextUp.length) dm.nextUp.forEach(function (p, index) { html += '<div class="gate"><span><b>' + (index + 1) + '. ' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos + ' · ' + (p.status || 'ACTIVE') + (p.injury ? ' · ' + p.injury : '')) + '</span></span><b>' + pts(projection(p)) + '</b></div>'; });
    else html += '<div class="muted">Fantrax weekly projections are unavailable for active bench players.</div>';
    html += '</div>';
    html += rosterTable(players, true);
    return html;
  }

  function rosterTable(players, showSignal) {
    var html = '<div class="card"><div class="tableWrap"><table><thead><tr><th>Player</th><th>Pos</th><th>Status</th><th>Salary</th><th>Years</th><th>Age</th><th>Week proj</th><th>Season proj</th><th>Prior FP/G</th><th>Injury</th>' + (showSignal ? '<th>Eval</th>' : '') + '</tr></thead><tbody>';
    players.slice().sort(function (a, b) { return (expectedScore(b) || -1) - (expectedScore(a) || -1); }).forEach(function (p) { var signal = showSignal ? playerSignal(p) : null; html += '<tr><td><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.nfl) + '</span></td><td>' + esc(p.pos) + '</td><td>' + esc(p.status) + '</td><td>' + money(p.salary) + '</td><td>' + p.years + '</td><td>' + (p.age == null ? "—" : p.age) + '</td><td>' + pts(projection(p)) + '</td><td>' + pts(seasonProjection(p)) + '</td><td>' + pts(production(p)) + '</td><td>' + esc(p.injury || "—") + '</td>' + (signal ? '<td><span class="bhs ' + signal.label.toLowerCase() + '">' + signal.label + '</span></td>' : '') + '</tr>'; });
    return html + '</tbody></table></div></div>';
  }

  function viewTeams() {
    var names = allTeamNames(), selected = state.selectedTeam; if (names.indexOf(selected) < 0) selected = state.selectedTeam = names[0] || MY_TEAM;
    var g = leagueGrades()[selected] || {}, picks = teamPicks(selected);
    var html = '<div class="card"><div class="sectionhead"><h2>League Teams</h2><span class="pill">FULL-ROSTER GRADE ' + esc(g.grade || "N/A") + '</span></div><div class="field"><label>Select team</label><select onchange="GMS.selectTeam(this.value)">' + names.map(function (name) { return '<option' + (name === selected ? " selected" : "") + '>' + esc(name) + '</option>'; }).join("") + '</select></div><div class="notice">This evaluation includes every rostered player, including active depth, Taxi, and IR/unavailable. It changes with live Fantrax projections, performance, age, injuries, and salary value; missing fields remain unavailable.</div></div>';
    html += rosterTable(teamPlayers(selected), false);
    html += '<div class="card"><h2>Owned draft picks</h2>' + picks.map(function (p) { return '<div class="gate"><span><b>' + p.year + ' Round ' + p.round + '</b></span><span class="small">Originally ' + esc(p.original) + '</span></div>'; }).join("") + (!picks.length ? '<div class="muted">No future picks returned by Fantrax.</div>' : "") + '</div>';
    return html;
  }

  function viewCap() {
    var players = teamPlayers(MY_TEAM), penalties = existingDead(MY_TEAM), selected = {}, simulated = {};
    state.cutIds.forEach(function (id) { selected[id] = true; });
    state.simulatedCutIds.forEach(function (id) { simulated[id] = true; });
    var simulatedCuts = players.filter(function (p) { return simulated[p.id]; });
    var capData = capProjection(MY_TEAM, state.simulatedCutIds);
    var html = '<div class="card"><div class="sectionhead"><h2>Cap / Dead</h2><span class="pill">FANTRAX PENALTIES</span></div><div class="notice"><b>Current cap used includes existing dead money.</b> It is calculated as live Fantrax roster salary plus the current Cap Hit Penalties table. A cut does not create current-year room because 100% of that salary becomes new dead cap.</div><div class="grid4"><div class="metric"><b>' + money(capData.rosterSalary) + '</b><span>Current roster salary</span></div><div class="metric"><b>' + money(capData.currentDead) + '</b><span>Existing current dead cap</span></div><div class="metric"><b>' + money(capData.currentUsed) + '</b><span>Total current cap used</span></div><div class="metric"><b>' + money(capData.currentRoom) + '</b><span>Current cap room</span></div></div></div>';
    html += '<div class="card"><div class="sectionhead"><h2>Cut simulation result</h2><span class="pill">' + simulatedCuts.length + ' CUT' + (simulatedCuts.length === 1 ? '' : 'S') + '</span></div>' + (!simulatedCuts.length ? '<div class="muted">Select players below, then press Simulate Cuts.</div>' : '<div class="grid4"><div class="metric"><b>' + money(capData.afterRosterSalary) + '</b><span>Roster salary after cuts</span></div><div class="metric"><b>' + money(capData.afterDead) + '</b><span>Dead cap after cuts</span></div><div class="metric"><b>' + money(capData.afterUsed) + '</b><span>Total used after cuts</span></div><div class="metric"><b>' + money(capData.newDeadNext) + '</b><span>New next-year dead</span></div></div><div class="notice"><b>Current-year change: ' + money(capData.afterUsed - capData.currentUsed) + '.</b> This simulation is advice only and does not submit cuts to Fantrax.</div>') + '</div>';
    html += '<div class="card"><div class="sectionhead"><h2>Next-year cap outlook</h2><span class="pill">PRIDE +5% CAP</span></div><div class="notice">Next year removes expiring contracts, applies the Pride 20% salary increase to returning contracts, and includes both Fantrax-recorded next-year penalties and dead money created by simulated cuts.</div><div class="grid4"><div class="metric"><b>' + money(capData.nextCap) + '</b><span>Next-year salary cap</span></div><div class="metric"><b>' + money(capData.nextRosterSalary) + '</b><span>Returning-contract salary</span></div><div class="metric"><b>' + money(capData.nextDead) + '</b><span>Total next-year dead cap</span></div><div class="metric"><b>' + money(capData.nextRoom) + '</b><span>Projected next-year room</span></div></div><div class="depth-split"><div class="depth-bucket"><b>Expiring contracts</b><span>' + capData.expiringCount + ' players · ' + money(capData.expiringSalary) + ' current salary</span></div><div class="depth-bucket"><b>Existing next-year dead</b><span>' + money(capData.existingNextDead) + '</span></div><div class="depth-bucket"><b>New dead from cuts</b><span>' + money(capData.newDeadNext) + '</span></div></div></div>';
    html += '<div class="card"><h2>Fantrax recorded penalties</h2>' + penalties.map(function (row) { return '<div class="gate"><span><b>' + esc(row.name) + '</b><br><span class="small">' + esc(row.description) + '</span></span><b>' + money(row.amount) + '</b></div>'; }).join("") + (!penalties.length ? '<div class="muted">Fantrax returned no cap-hit penalties.</div>' : "") + '</div>';
    html += '<div class="card"><div class="sectionhead"><h2>Cut simulator</h2><div class="actions"><button class="primary" onclick="GMS.simulateCuts()">Simulate Cuts</button><button class="secondary" onclick="GMS.clearCuts()">Clear</button></div></div><div class="notice">Check one or more players, then press <b>Simulate Cuts</b>. Nothing is sent to Fantrax.</div>' + players.slice().sort(function (a, b) { return b.salary - a.salary; }).map(function (p) { var d = deadSchedule(p.salary, p.years); return '<label class="gate"><span><input type="checkbox" ' + (selected[p.id] ? "checked" : "") + ' onchange="GMS.toggleCut(\'' + esc(p.id) + '\')"> <b>' + esc(p.name) + '</b><br><span class="small">' + money(p.salary) + ' · ' + p.years + ' years · current dead ' + money(d.now) + ' · next dead ' + money(d.next) + '</span></span></label>'; }).join("") + '</div>';
    return html;
  }

  function viewBhs() {
    var rows = allRosteredPlayers().map(function (p) { return { p: p, s: playerSignal(p) }; }).sort(function (a, b) { return (b.s.score || -1) - (a.s.score || -1); });
    var counts = { BUY: 0, HOLD: 0, SELL: 0 }; rows.forEach(function (r) { counts[r.s.label]++; });
    var html = '<div class="card"><div class="sectionhead"><h2>Buy / Hold / Sell</h2><span class="pill">LEAGUE-WIDE</span></div><div class="notice">Each player receives exactly one evaluation. The label is relative to same-position players using Fantrax expectation, salary efficiency, age, and injury availability—not a generic team-wide label.</div><div class="grid3"><div class="metric"><b>' + counts.BUY + '</b><span>Buy</span></div><div class="metric"><b>' + counts.HOLD + '</b><span>Hold</span></div><div class="metric"><b>' + counts.SELL + '</b><span>Sell</span></div></div></div><div class="card"><div class="tableWrap"><table><thead><tr><th>Eval</th><th>Player</th><th>Owner</th><th>Pos</th><th>Week</th><th>Season</th><th>Prior FP/G</th><th>Salary</th><th>Why</th></tr></thead><tbody>';
    rows.forEach(function (row) { html += '<tr><td><span class="bhs ' + row.s.label.toLowerCase() + '">' + row.s.label + '</span></td><td><b>' + esc(row.p.name) + '</b></td><td>' + esc(row.p.team) + '</td><td>' + esc(row.p.pos) + '</td><td>' + pts(projection(row.p)) + '</td><td>' + pts(seasonProjection(row.p)) + '</td><td>' + pts(production(row.p)) + '</td><td>' + money(row.p.salary) + '</td><td class="muted">' + esc(row.s.reasons.join("; ") || "Insufficient Fantrax data") + '</td></tr>'; });
    return html + '</tbody></table></div></div>';
  }

  function viewWaivers() {
    var needs = teamNeeds(MY_TEAM);
    var list = freeAgents().filter(function (p) { return expectedScore(p) != null; }).sort(function (a, b) { var needA = needs[a.pos] || 0, needB = needs[b.pos] || 0; return (needB * 10 + expectedScore(b)) - (needA * 10 + expectedScore(a)); }).slice(0, 150);
    var positionOrder = ["QB", "RB", "WR", "TE", "DL", "LB", "DB"];
    var grouped = {};
    list.forEach(function (p) { (grouped[p.pos] || (grouped[p.pos] = [])).push(p); });
    Object.keys(grouped).forEach(function (pos) { if (positionOrder.indexOf(pos) < 0) positionOrder.push(pos); });
    var html = '<div class="card"><div class="sectionhead"><h2>Waivers / Free Agency by Position</h2><button class="primary" onclick="GMS.sync()">Refresh free agents</button></div><div class="notice">Players are grouped by their primary Fantrax position and ranked within that position using live Fantrax expectation plus Capitol Carnage roster need. Pickup advice compares each player with your same-position depth. The blind-bid maximum uses the salary of the closest live projected, same-position rostered player and never exceeds current cap room; it shows unavailable when no Fantrax comparable exists.</div><div class="actions">';
    positionOrder.forEach(function (pos) { if (grouped[pos] && grouped[pos].length) html += '<a class="secondary" href="#free-agents-' + esc(pos.toLowerCase()) + '">' + esc(pos) + ' (' + grouped[pos].length + ')</a>'; });
    html += '</div></div>';
    positionOrder.forEach(function (pos) {
      var players = grouped[pos] || [];
      if (!players.length) return;
      html += '<div class="card" id="free-agents-' + esc(pos.toLowerCase()) + '"><div class="sectionhead"><h2>' + esc(pos) + ' Free Agents</h2><span class="pill">' + players.length + ' AVAILABLE</span></div><div class="tableWrap"><table><thead><tr><th>Player</th><th>Week</th><th>Season</th><th>Prior FP/G</th><th>Age</th><th>Ros%</th><th>Trend</th><th>Pickup?</th><th>Blind-bid max</th><th>Why</th></tr></thead><tbody>';
      players.forEach(function (p) { var advice = waiverAdvice(p); html += '<tr><td><b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.nfl + (p.injury ? " · " + p.injury : "")) + '</span></td><td>' + pts(projection(p)) + '</td><td>' + pts(seasonProjection(p)) + '</td><td>' + pts(production(p)) + '</td><td>' + (p.age == null ? "—" : p.age) + '</td><td>' + (p.rosteredPct == null ? "—" : p.rosteredPct.toFixed(0) + "%") + '</td><td>' + (p.rosterTrend == null ? "—" : (p.rosterTrend > 0 ? "+" : "") + p.rosterTrend.toFixed(0) + "%") + '</td><td><b>' + esc(advice.verdict) + '</b></td><td><b>' + (advice.maxBid == null ? "unavailable" : money(advice.maxBid)) + '</b><br><span class="small">' + esc(advice.bidBasis) + '</span></td><td>' + esc(advice.reason) + '</td></tr>'; });
      html += '</tbody></table></div></div>';
    });
    return html;
  }

  function tradeAssetValue(asset) {
    if (asset.type === "pick") return Math.max(15, 100 - (asset.year - 2027) * 12 - (asset.round - 1) * 28);
    var p = asset.player, exp = expectedScore(p), prod = production(p), age = p.age;
    var base = (exp == null ? 0 : exp * 5) + (prod == null ? 0 : prod * 2) + p.years * 5 - p.salary * 0.035;
    if (age != null) base += age <= 24 ? 18 : age <= 27 ? 8 : age >= 31 ? -10 : 0;
    if (unavailable(p)) base -= 15;
    return Math.max(0, base);
  }

  function selectedAssets(side, teamName) {
    var team = teamByName(teamName), picks = teamPicks(teamName);
    return state["trade" + side].map(function (key) {
      if (key.indexOf("P:") === 0) { var player = teamPlayers(teamName).filter(function (p) { return p.id === key.slice(2); })[0]; return player && { type: "player", player: player, name: player.name }; }
      var bits = key.split(":"); var pick = picks[Number(bits[3])]; return pick && { type: "pick", year: Number(bits[1]), round: Number(bits[2]), name: bits[1] + " Round " + bits[2] + " (orig. " + pick.original + ")" };
    }).filter(Boolean);
  }

  function viewTrade() {
    var names = allTeamNames(); if (!state.tradeTeamB || state.tradeTeamB === state.tradeTeamA) state.tradeTeamB = names.filter(function (n) { return n !== state.tradeTeamA; })[0] || "";
    function side(team, code) {
      var html = '<div class="card"><div class="field"><label>' + (code === "A" ? "Team A" : "Team B") + '</label><select onchange="GMS.tradeTeam(\'' + code + '\',this.value)">' + names.map(function (name) { return '<option' + (name === team ? " selected" : "") + '>' + esc(name) + '</option>'; }).join("") + '</select></div><h3>Players</h3>';
      teamPlayers(team).sort(function (a, b) { return (expectedScore(b) || -1) - (expectedScore(a) || -1); }).forEach(function (p) { var key = "P:" + p.id, checked = state["trade" + code].indexOf(key) >= 0; html += '<label class="gate"><span><input type="checkbox" ' + (checked ? "checked" : "") + ' onchange="GMS.tradeAsset(\'' + code + '\',\'' + key + '\')"> <b>' + esc(p.name) + '</b><br><span class="small">' + esc(p.pos) + ' · ' + money(p.salary) + ' · wk ' + pts(projection(p)) + ' · season ' + pts(seasonProjection(p)) + '</span></span></label>'; });
      html += '<h3>Picks</h3>'; teamPicks(team).forEach(function (p, index) { var key = "D:" + p.year + ":" + p.round + ":" + index, checked = state["trade" + code].indexOf(key) >= 0; html += '<label class="gate"><span><input type="checkbox" ' + (checked ? "checked" : "") + ' onchange="GMS.tradeAsset(\'' + code + '\',\'' + key + '\')"> <b>' + p.year + ' Round ' + p.round + '</b><br><span class="small">Originally ' + esc(p.original) + '</span></span></label>'; });
      return html + '</div>';
    }
    return '<div class="card"><div class="sectionhead"><h2>Trade Lab</h2><span class="pill">FULL EXPLANATION</span></div><div class="notice">Evaluation shows asset value, weekly/season scoring change, salary, age, injury, roster need, and draft capital for both sides.</div></div><div class="grid2">' + side(state.tradeTeamA, "A") + side(state.tradeTeamB, "B") + '</div><div class="card"><button class="primary" onclick="GMS.evalTrade()">Evaluate trade</button><div id="tradeResult" style="margin-top:12px"></div></div>';
  }

  function evaluateTradeHtml() {
    var giveA = selectedAssets("A", state.tradeTeamA), giveB = selectedAssets("B", state.tradeTeamB);
    if (!giveA.length && !giveB.length) return '<div class="error-banner">Select at least one player or pick.</div>';
    function summary(receivingTeam, outgoing, incoming) {
      var outPlayers = outgoing.filter(function (a) { return a.type === "player"; }).map(function (a) { return a.player; });
      var inPlayers = incoming.filter(function (a) { return a.type === "player"; }).map(function (a) { return a.player; });
      var valueOut = outgoing.reduce(function (s, a) { return s + tradeAssetValue(a); }, 0), valueIn = incoming.reduce(function (s, a) { return s + tradeAssetValue(a); }, 0);
      var weeklyOut = outPlayers.reduce(function (s, p) { return s + (expectedScore(p) || 0); }, 0), weeklyIn = inPlayers.reduce(function (s, p) { return s + (expectedScore(p) || 0); }, 0);
      var seasonOut = outPlayers.reduce(function (s, p) { return s + (seasonProjection(p) || 0); }, 0), seasonIn = inPlayers.reduce(function (s, p) { return s + (seasonProjection(p) || 0); }, 0);
      var salaryOut = outPlayers.reduce(function (s, p) { return s + p.salary; }, 0), salaryIn = inPlayers.reduce(function (s, p) { return s + p.salary; }, 0);
      var needs = teamNeeds(receivingTeam), needFits = inPlayers.filter(function (p) { return needs[p.pos]; }).map(function (p) { return p.name + " fills " + p.pos; });
      return { team: receivingTeam, outgoing: outgoing, incoming: incoming, value: valueIn - valueOut, weekly: weeklyIn - weeklyOut, season: seasonIn - seasonOut, salary: salaryIn - salaryOut, needFits: needFits };
    }
    var a = summary(state.tradeTeamA, giveA, giveB), b = summary(state.tradeTeamB, giveB, giveA);
    function block(s) { var verdict = s.value > 12 ? "Favorable" : s.value < -12 ? "Unfavorable" : "Close / needs-based"; return '<div class="card"><h3>' + esc(s.team) + ': ' + verdict + '</h3><div class="grid4"><div class="metric"><b class="' + (s.value >= 0 ? "good" : "bad") + '">' + (s.value >= 0 ? "+" : "") + s.value.toFixed(1) + '</b><span>Composite value</span></div><div class="metric"><b>' + (s.weekly >= 0 ? "+" : "") + s.weekly.toFixed(1) + '</b><span>Weekly expectation</span></div><div class="metric"><b>' + (s.season >= 0 ? "+" : "") + s.season.toFixed(1) + '</b><span>Season projection</span></div><div class="metric"><b>' + (s.salary >= 0 ? "+" : "") + money(s.salary) + '</b><span>Salary change</span></div></div><p><b>Receives:</b> ' + esc(s.incoming.map(function (x) { return x.name; }).join(", ") || "Nothing") + '</p><p><b>Sends:</b> ' + esc(s.outgoing.map(function (x) { return x.name; }).join(", ") || "Nothing") + '</p><p><b>Roster fit:</b> ' + esc(s.needFits.join("; ") || "No direct thin-position fit identified") + '.</p><p class="muted">Composite value uses Fantrax expectations and prior production, salary, contract years, age, injury availability, and pick round/year. It is a decision aid, not a fabricated market price.</p></div>'; }
    return '<div class="notice"><b>Bottom line:</b> ' + (Math.abs(a.value) <= 12 ? 'The deal is close on total value; decide by lineup fit and competitive window.' : (a.value > 0 ? esc(state.tradeTeamA) : esc(state.tradeTeamB)) + ' receives the stronger package on the current live inputs.') + '</div><div class="grid2">' + block(a) + block(b) + '</div>';
  }

  function rankingExplanation(name, ranking, position, total) {
    var fullRoster = ranking.fullRoster || {}, depthGrade = ranking.depth || {}, starterMetrics = ranking.starters && ranking.starters.metrics || {}, depthMetrics = depthGrade.metrics || {};
    var components = (fullRoster.components || []).slice().sort(function (a, b) { return b.score - a.score; });
    var strongest = components[0], weakest = components[components.length - 1];
    var players = teamPlayers(name).filter(function (p) { return expectedScore(p) != null; }).sort(function (a, b) { return expectedScore(b) - expectedScore(a); }).slice(0, 3);
    var m = fullRoster.metrics || {}, unavailableCount = m.injured || 0;
    var leads = players.map(function (p) { return p.name; }).join(", ") || "no projected leaders available";
    var summaries = [
      "Rank " + position + " is driven by " + (strongest ? strongest.name.toLowerCase() : "available full-roster evidence") + ", with " + leads + " setting the projection ceiling",
      "The full roster lands " + position + " of " + total + "; " + (weakest ? weakest.name.toLowerCase() : "missing comparative data") + " is the clearest constraint behind that placement",
      (unavailableCount ? unavailableCount + " unavailable player" + (unavailableCount === 1 ? "" : "s") + " materially shape" : "Full-roster projection and value shape") + " this rank, while " + leads + " supply the leading expectations",
      "Across all " + (m.players == null ? "available" : m.players) + " roster spots, " + (strongest ? strongest.name.toLowerCase() : "the returned evidence") + " carries the profile and " + (weakest ? weakest.name.toLowerCase() : "missing data") + " limits it"
    ];
    var seed = name.split("").reduce(function (sum, char) { return sum + char.charCodeAt(0); }, position);
    var summary = summaries[seed % summaries.length];
    var details = [];
    if (strongest) details.push(strongest.name + " is the roster's strongest measured category at the " + Math.round(strongest.score) + "th percentile");
    if (weakest) details.push(weakest.name + " is the lowest at the " + Math.round(weakest.score) + "th percentile");
    if (starterMetrics.missing) details.push(starterMetrics.missing + " projected starter slot" + (starterMetrics.missing === 1 ? " is" : "s are") + " unfilled");
    if (unavailableCount) details.push(unavailableCount + " unavailable roster player" + (unavailableCount === 1 ? "" : "s"));
    if (depthGrade.score != null) details.push((depthMetrics.active ? depthMetrics.active.length : 0) + " usable depth players produce a separate " + depthGrade.grade + " depth grade (" + depthGrade.score.toFixed(1) + ")");
    return { summary: summary, details: details.join("; ") + ".", leaders: players };
  }

  function viewRankings() {
    var grades = leaguePowerGrades(), ranked = Object.keys(grades).sort(function (a, b) { return (grades[b].score || -1) - (grades[a].score || -1); });
    var mineIndex = ranked.indexOf(MY_TEAM), mine = grades[MY_TEAM], above = ranked.slice(0, mineIndex);
    var html = '<div class="card"><div class="sectionhead"><h2>League Power Rankings</h2><div class="actions"><span class="pill">FULL ROSTERS · FANTRAX LIVE</span><button class="primary" onclick="GMS.sync()">Refresh rankings</button></div></div><div class="notice">Power rankings evaluate every player on every roster: starters, active depth, Taxi, IR/unavailable, projections, prior performance, salary value, age, and health. Starter-only comparison is reserved for Game Day. Each explanation is built from that team’s own live strongest and weakest evidence; missing fields are reweighted, never invented.</div></div>';
    html += '<div class="grid4"><div class="metric"><b>#' + (mineIndex + 1) + '</b><span>Capitol Carnage rank</span></div><div class="metric"><b>' + esc(mine && mine.grade || "N/A") + '</b><span>Full-roster power grade</span></div><div class="metric"><b>' + (mine && mine.fullRoster && mine.fullRoster.metrics ? mine.fullRoster.metrics.players : "—") + '</b><span>Players evaluated</span></div><div class="metric"><b>' + (mine && mine.depth && mine.depth.score != null ? mine.depth.score.toFixed(1) : "—") + '</b><span>Depth grade</span></div></div>';
    html += '<div class="power-list">';
    ranked.forEach(function (name, i) {
      var g = grades[name], reason = rankingExplanation(name, g, i + 1, ranked.length);
      var sm = g.starters.metrics || {}, dm = g.depth.metrics || {};
      html += '<div class="power-card' + (name === MY_TEAM ? ' my-power-card' : '') + '"><div class="power-rank">' + (i + 1) + '</div><div class="power-body"><div class="sectionhead"><div><h2>' + esc(name) + (name === MY_TEAM ? ' <span class="teamBadge">MY TEAM</span>' : '') + '</h2><div class="power-verdict">' + esc(reason.summary) + '</div></div><div><span class="grade">' + esc(g.grade) + '</span> <b class="power-score">' + (g.score == null ? "—" : g.score.toFixed(1)) + '</b></div></div><div class="power-metrics"><span><b>' + (g.fullRoster && g.fullRoster.metrics ? g.fullRoster.metrics.players : "—") + '</b> full roster</span><span><b>' + (g.depth.score == null ? "—" : g.depth.score.toFixed(1)) + '</b> depth grade</span><span><b>' + pts(sm.projected) + '</b> Game Day starters</span><span><b>' + available(dm.projected, pts) + '</b> active-depth weekly</span><span><b>' + (dm.active ? dm.active.length : "—") + '</b> usable depth</span><span><b>' + (g.fullRoster && g.fullRoster.metrics ? g.fullRoster.metrics.injured : "—") + '</b> unavailable</span></div><p>' + esc(reason.details) + '</p><p class="muted"><b>Highest Fantrax expectations:</b> ' + esc(reason.leaders.map(function (p) { return p.name + " (" + pts(expectedScore(p)) + ")"; }).join(", ") || "Projection data unavailable") + '</p></div></div>';
    });
    html += '</div><div class="card"><h2>Capitol Carnage vs league</h2><p>Ranked <b>' + (mineIndex + 1) + ' of ' + ranked.length + '</b> with grade <b>' + esc(mine && mine.grade || "N/A") + '</b>.</p><p class="muted">Teams currently ahead: ' + esc(above.join(", ") || "None") + '.</p></div>';
    return html;
  }

  function newsRow(article) { return '<div class="gate"><span><b>' + esc(article.headline) + '</b><br><span class="small">' + esc(article.description || "") + '</span></span>' + (article.link ? '<a href="' + esc(article.link) + '" target="_blank" rel="noopener">Open</a>' : "") + '</div>'; }
  function viewNews() { return '<div class="card"><div class="sectionhead"><h2>NFL News</h2><button class="primary" onclick="GMS.news()">Refresh news</button></div><div class="notice">Current ESPN NFL feed. The War Room front page prioritizes stories connected to your players’ NFL teams.</div>' + state.news.map(newsRow).join("") + '</div>'; }

  function viewGames() {
    var roster = teamPlayers(MY_TEAM), rows = [], rules = scoringRules();
    state.games.forEach(function (game) {
      roster.forEach(function (player) {
        var result = liveLeaguePoints(game, player);
        if (result.matched) rows.push({ game: game, player: player, result: result });
      });
    });
    rows.sort(function (a, b) { return (b.result.points == null ? -1 : b.result.points) - (a.result.points == null ? -1 : a.result.points); });
    var html = '<div class="card"><div class="sectionhead"><div><h2>Current Game Tracker</h2><span class="small">Capitol Carnage · actual NFL box-score stats under Pride scoring</span></div><div class="actions"><button class="' + (state.gameSeasonType === 2 ? 'primary' : 'secondary') + '" onclick="GMS.games(2)">Regular season</button><button class="' + (state.gameSeasonType === 1 ? 'primary' : 'secondary') + '" onclick="GMS.games(1)">Preseason</button><button class="secondary" onclick="GMS.games()">Refresh games</button></div></div><div class="notice"><b>Scoring integrity:</b> Official Fantrax totals remain authoritative when Fantrax scores the game. During preseason, the displayed total is a GMS Locker calculation from actual box-score stats and live Pride league scoring rules—not a projection. If every applicable rule cannot be matched, the total stays unavailable and the missing rules are named.</div></div>';
    html += '<div class="grid4"><div class="metric"><b>' + state.games.length + '</b><span>Games found</span></div><div class="metric"><b>' + rows.length + '</b><span>Your players active</span></div><div class="metric"><b>' + rules.length + '</b><span>League scoring rules read</span></div><div class="metric"><b>' + esc(state.gamesAsOf ? new Date(state.gamesAsOf).toLocaleTimeString() : 'Not refreshed') + '</b><span>Box-score update</span></div></div>';
    if (state.gamesLoading) return html + '<div class="loading">Refreshing current NFL game stats…</div>';
    if (state.gamesError) html += '<div class="error-banner"><b>Game feed unavailable:</b> ' + esc(state.gamesError) + '</div>';
    if (!rules.length) html += '<div class="error-banner"><b>Pride scoring unavailable:</b> the live Fantrax league response did not include readable point values, so GMS Locker will not invent a total.</div>';
    if (!rows.length) return html + '<div class="card"><h2>No Capitol Carnage box-score activity found</h2><p class="muted">Choose Preseason or Regular season and refresh. Players appear only after an NFL box score reports a verified name and team match.</p></div>';
    html += '<div class="game-player-list">';
    rows.forEach(function (row) {
      var detail = row.result.contributions.map(function (item) { return item.stat + ' ' + item.label + ' × ' + item.rate + ' = ' + pts(item.points); }).join(' · ');
      html += '<div class="card game-player-card"><div class="sectionhead"><div><h3>' + esc(row.player.name) + ' <span class="teamBadge">' + esc(row.player.pos) + '</span></h3><span class="small">' + esc(row.game.name + ' · ' + row.game.status) + '</span></div><div class="live-points"><b>' + (row.result.points == null ? 'unavailable' : pts(row.result.points)) + '</b><span>' + (state.gameSeasonType === 1 ? 'GMS calculated Pride points' : 'Pride points from box score') + '</span></div></div><p>' + esc(detail || 'No scoring stats recorded yet.') + '</p>' + (row.result.unmatched.length ? '<p class="bad"><b>Total withheld—unmatched scoring rules:</b> ' + esc(row.result.unmatched.join(', ')) + '</p>' : '') + '</div>';
    });
    return html + '</div>';
  }

  function viewPicks() { var html = '<div class="card"><h2>League Draft Picks</h2><div class="tableWrap"><table><thead><tr><th>Owner</th><th>Year</th><th>Round</th><th>Original owner</th></tr></thead><tbody>'; state.picks.forEach(function (p) { html += '<tr><td>' + esc(state.teams[p.currentOwnerTeamId] && state.teams[p.currentOwnerTeamId].name || p.currentOwnerTeamId) + '</td><td>' + p.year + '</td><td>' + p.round + '</td><td>' + esc(state.teams[p.originalOwnerTeamId] && state.teams[p.originalOwnerTeamId].name || p.originalOwnerTeamId) + '</td></tr>'; }); return html + '</tbody></table></div></div>'; }
  function viewChat() { var coach = COACHES[COACH] || COACHES.process, html = '<div class="card"><div class="sectionhead"><h2>GM Chat</h2><span class="pill">' + esc(coach.name) + ' PERSONALITY</span></div><div class="notice">Chat receives the same live rosters, Fantrax projections/performance, injuries, picks, matchup, grades, free agents, and exact dead-cap penalties shown in the app.</div><div class="chat-box"><div class="chat-log" id="chatLog">'; if (!state.chat.length) html += '<div class="chat-msg ai"><b>GM:</b> Ask me about the league, your roster, a trade, cap, or anything else.</div>'; else state.chat.forEach(function (m) { html += '<div class="chat-msg ' + (m.role === "user" ? "user" : "ai") + '"><b>' + (m.role === "user" ? "You" : "GM") + ':</b> ' + esc(m.text) + '</div>'; }); return html + '</div><div class="chat-input-row"><input id="chatInput" type="text" placeholder="Ask about the league or anything else..." onkeydown="if(event.key===\'Enter\')GMS.sendChat()"><button class="primary" onclick="GMS.sendChat()">Send</button></div></div></div>'; }
  function viewSettings() { var coach = COACHES[COACH] || COACHES.process, html = '<div class="card"><div class="sectionhead"><h2>App Personality</h2><span class="pill">CURRENT: ' + esc(coach.name) + '</span></div><div class="notice"><b>This is where the app’s personality lives.</b> It changes the tone and decision lens in War Room and GM Chat, while live Fantrax facts always remain the same.</div><div class="grid2">'; Object.keys(COACHES).forEach(function (key) { var c = COACHES[key]; html += '<button class="personality-card ' + (key === COACH ? "selected" : "") + '" onclick="GMS.setCoach(\'' + key + '\')"><b>' + esc(c.name) + '</b><span>' + esc(c.lens) + '</span></button>'; }); return html + '</div></div>' + mvpCheckout('settings') + '<div class="card"><h2>Data integrity</h2><div class="gate"><span>Projection source</span><b>Fantrax</b></div><div class="gate"><span>Performance source</span><b>Fantrax prior season</b></div><div class="gate"><span>Dead-cap source</span><b>Fantrax penalty table</b></div><div class="gate"><span>Last refresh</span><b>' + esc(state.asOf ? new Date(state.asOf).toLocaleString() : "Not synced") + '</b></div><div class="gate"><span>Version</span><b>' + VERSION + '</b></div><div class="actions"><button class="primary" onclick="GMS.sync()">Force live refresh</button></div></div>'; }
  function viewContact() { return '<div class="card"><h2>Contact</h2><div class="contact-emails"><a class="email-card" href="mailto:gmslocker@gmail.com"><b>GMS Locker</b><span>gmslocker@gmail.com</span></a><a class="email-card" href="mailto:pinvaultcollectibles@gmail.com"><b>Pin Vault Collectibles</b><span>pinvaultcollectibles@gmail.com</span></a></div></div>'; }

  function render() {
    var root = document.getElementById("main"); if (!root) return;
    var view = localStorage.getItem("gms_view") || "war";
    if (view === "analysts") { view = "rankings"; localStorage.setItem("gms_view", view); }
    var views = { war: viewWar, team: viewTeam, startsit: viewStartSit, games: viewGames, teams: viewTeams, cap: viewCap, bhs: viewBhs, waivers: viewWaivers, trade: viewTrade, rankings: viewRankings, picks: viewPicks, news: viewNews, chat: viewChat, contact: viewContact, settings: viewSettings };
    document.querySelectorAll(".nav button").forEach(function (button) { button.classList.toggle("active", button.getAttribute("data-view") === view); });
    var asof = document.getElementById("asof"); if (asof) asof.innerHTML = state.loading ? "<b>Refreshing Fantrax…</b>" : state.asOf ? "Updated <b>" + esc(new Date(state.asOf).toLocaleTimeString()) + "</b>" : "Not synced";
    if (state.loading && !Object.keys(state.teams).length) { root.innerHTML = '<div class="loading">Loading live Fantrax projections, performance, rosters, and cap penalties…</div>'; return; }
    var body = '<div class="notice evaluation-policy"><b>Evaluation standard:</b> Full Fantrax rosters drive every team judgment. Only Game Day is best legal starters vs best legal starters. Reasons must be original to the subject, specific to live facts, and show unavailable instead of invented data.</div>';
    if (state.error) body += '<div class="error-banner"><b>Refresh failed:</b> ' + esc(state.error) + '</div>';
    try { body += (views[view] || viewWar)(); } catch (error) { body += '<div class="error-banner"><b>Screen error:</b> ' + esc(error.message || error) + '</div>'; }
    root.innerHTML = body;
    renderPayPalButtons();
    var chatLog = document.getElementById("chatLog"); if (chatLog) chatLog.scrollTop = chatLog.scrollHeight;
  }

  window.GMS = {
    sync: syncFantrax, news: function () { refreshNews(true); }, games: function (seasonType) { refreshGames(seasonType, true); },
    depth: function (teamName) { return depthMetrics(teamName || MY_TEAM); },
    power: function (teamName) { return leaguePowerGrades()[teamName || MY_TEAM]; },
    cap: function (teamName, cutIds) { return capProjection(teamName || MY_TEAM, cutIds || []); },
    gems: hiddenGems, weeklyRisk: weeklyRisk,
    applyOptimizedLineup: function () { state.selectedLineupIndex = null; saveLineupDraft(optimizedLineupIds()); render(); },
    resetLineupPreview: function () { state.lineupDraft = null; state.selectedLineupIndex = null; localStorage.removeItem("gms_lineup_preview"); render(); },
    selectActive: function (index) { state.selectedLineupIndex = state.selectedLineupIndex === index ? null : index; render(); },
    moveSelectedToReserve: function () {
      var index = state.selectedLineupIndex, ids = lineupDraftIds();
      if (index == null || index < 0 || index >= ids.length || !ids[index]) return;
      ids[index] = null; state.selectedLineupIndex = null; saveLineupDraft(ids); render();
    },
    swapSelectedWithReserve: function (id) {
      var index = state.selectedLineupIndex, ids = lineupDraftIds(), slots = starterSlots();
      var p = teamPlayers(MY_TEAM).filter(function (player) { return player.id === id; })[0];
      if (index == null || !p || taxi(p) || unavailable(p) || ids.indexOf(id) >= 0 || slots[index].accept.indexOf(p.pos) < 0) return;
      ids[index] = id; state.selectedLineupIndex = null; saveLineupDraft(ids); render();
    },
    moveStarter: function (index, id) {
      var ids = lineupDraftIds(), slots = starterSlots(), p = teamPlayers(MY_TEAM).filter(function (player) { return player.id === id; })[0];
      if (index < 0 || index >= slots.length) return;
      if (!id) ids[index] = null;
      else if (p && !unavailable(p) && slots[index].accept.indexOf(p.pos) >= 0 && ids.indexOf(id) < 0) ids[index] = id;
      saveLineupDraft(ids); render();
    },
    moveStarterDirection: function (index, direction) {
      var ids = lineupDraftIds(), slots = starterSlots(), players = {}, movingId = ids[index], target = index + direction;
      teamPlayers(MY_TEAM).forEach(function (p) { players[p.id] = p; });
      if (!movingId || (direction !== -1 && direction !== 1)) return;
      while (target >= 0 && target < slots.length) {
        var targetId = ids[target], moving = players[movingId], displaced = targetId ? players[targetId] : null;
        var movingFits = moving && slots[target].accept.indexOf(moving.pos) >= 0;
        var displacedFits = !displaced || slots[index].accept.indexOf(displaced.pos) >= 0;
        if (movingFits && displacedFits) {
          ids[target] = movingId; ids[index] = targetId || null; saveLineupDraft(ids); render(); return;
        }
        target += direction;
      }
    },
    show: function (view) { localStorage.setItem("gms_view", view); if (view === "games" && !state.gamesLoading && !state.gamesAsOf) refreshGames(state.gameSeasonType, true); else render(); },
    selectTeam: function (name) { state.selectedTeam = name; render(); },
    toggleCut: function (id) { var i = state.cutIds.indexOf(id); if (i >= 0) state.cutIds.splice(i, 1); else state.cutIds.push(id); render(); },
    simulateCuts: function () { state.simulatedCutIds = state.cutIds.slice(); render(); },
    clearCuts: function () { state.cutIds = []; state.simulatedCutIds = []; render(); },
    setCoach: function (key) { if (COACHES[key]) { COACH = key; localStorage.setItem("gms_coach", key); } render(); },
    tradeTeam: function (side, name) { state[side === "A" ? "tradeTeamA" : "tradeTeamB"] = name; state["trade" + side] = []; render(); },
    tradeAsset: function (side, key) { var list = state["trade" + side], i = list.indexOf(key); if (i >= 0) list.splice(i, 1); else list.push(key); },
    evalTrade: function () { var el = document.getElementById("tradeResult"); if (el) el.innerHTML = evaluateTradeHtml(); },
    sendChat: async function () {
      var input = document.getElementById("chatInput"); if (!input || !input.value.trim()) return;
      var text = input.value.trim(); input.value = ""; state.chat.push({ role: "user", text: text }); localStorage.setItem("gms_chat", JSON.stringify(state.chat.slice(-40))); render();
      try {
        function compact(p) { return { id: p.id, name: p.name, position: p.pos, nfl: p.nfl, salary: p.salary, years: p.years, status: p.status, age: p.age, weeklyProjection: projection(p), seasonProjection: seasonProjection(p), priorPerformancePpg: production(p), opponent: p.opponent, injury: p.injury, evaluation: p.team === "Free Agent" ? null : playerSignal(p).label }; }
        var rosters = allTeamNames().map(function (name) { var g = leagueGrades()[name]; return { team: name, grade: g && g.grade, score: g && g.score, metrics: g && g.metrics, players: teamPlayers(name).map(compact), picks: teamPicks(name), deadCap: existingDead(name) }; });
        var response = await fetch(API_BASE + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text, history: state.chat.slice(0, -1).slice(-40), personality: COACHES[COACH], evaluationPolicy: EVALUATION_POLICY, league: BYLAWS, team: { name: MY_TEAM, opponent: opponentName(), gameDayStarters: optimize(MY_TEAM), fullRosterGrade: leagueGrades()[MY_TEAM] }, leagueRosters: rosters, freeAgents: freeAgents().filter(function (p) { return expectedScore(p) != null; }).sort(function (a, b) { return expectedScore(b) - expectedScore(a); }).slice(0, 200).map(compact), draftPicks: state.picks, standings: state.standings, matchups: state.matchups, deadCap: existingDead(MY_TEAM), preferences: localStorage.getItem("gms_preferences") || "" }) });
        var data = await response.json(); if (!response.ok) throw new Error(data.detail || data.error || "Chat failed");
        state.chat.push({ role: "ai", text: data.reply || "I couldn't form a response." }); if (data.preferences) localStorage.setItem("gms_preferences", String(data.preferences).slice(0, 12000));
      } catch (error) { state.chat.push({ role: "ai", text: "Chat could not answer: " + String(error.message || error) }); }
      localStorage.setItem("gms_chat", JSON.stringify(state.chat.slice(-40))); render();
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".nav button").forEach(function (button) { button.addEventListener("click", function () { window.GMS.show(button.getAttribute("data-view")); }); });
    render(); syncFantrax();
  });
})();
