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
  var VERSION = "1.1.1";
  var AI_GATEWAY = "https://gms-locker-ai.robinharvey001.workers.dev";

  var TIER = localStorage.getItem("gms_tier") || "free";
  var COACH = localStorage.getItem("gms_coach") || "process";
  var CHAT_PROVIDER = localStorage.getItem("gms_chat_provider") === "gemini" ? "gemini" : "llama";
  var GEMINI_CONSENT = localStorage.getItem("gms_gemini_consent") === "true";

  function loadSavedChat() {
    try {
      var saved = JSON.parse(localStorage.getItem("gms_chat") || "[]");
      return Array.isArray(saved) ? saved.slice(-40) : [];
    } catch (e) {
      return [];
    }
  }

  var state = {
    teams: {}, players: {}, standings: [], picks: [], matchups: null,
    asOf: null, loading: false, error: null, selectedTeam: MY_TEAM,
    cutIds: [], chat: loadSavedChat(), chatBusy: false, chatError: null,
    trade: null, tradePartner: localStorage.getItem("gms_trade_partner") || "",
    tradeAiBusy: false, tradeAiText: "", tradeAiError: null
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

  function objectOrEmpty(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizeFantrax(parts) {
    var rosterPayload = objectOrEmpty(parts[0]);
    var rosterMap = objectOrEmpty(rosterPayload.rosters || rosterPayload);
    var rawPlayers = objectOrEmpty(parts[1]);
    var rawStandings = parts[2];
    var draftPayload = objectOrEmpty(parts[3]);
    var matchupPayload = objectOrEmpty(parts[4]);
    var rawLeagueInfo = objectOrEmpty(parts[5]);
    var teams = {};
    var players = {};

    Object.keys(rosterMap).forEach(function (teamId) {
      var team = objectOrEmpty(rosterMap[teamId]);
      teams[teamId] = {
        id: teamId,
        name: String(team.teamName || team.name || teamId),
        items: Array.isArray(team.rosterItems) ? team.rosterItems.filter(function (item) {
          return item && item.id;
        }) : [],
        salaryCap: Number(team.salaryCap || CAP_NOW)
      };
    });

    Object.keys(rawPlayers).forEach(function (playerId) {
      var player = rawPlayers[playerId];
      if (player && typeof player === "object" && player.name) players[playerId] = player;
    });

    var standings = Array.isArray(rawStandings)
      ? rawStandings.slice()
      : (Array.isArray(objectOrEmpty(rawStandings).standings) ? rawStandings.standings.slice() : []);
    standings.sort(function (a, b) { return Number(a.rank || 999) - Number(b.rank || 999); });

    var picks = Array.isArray(draftPayload.futureDraftPicks)
      ? draftPayload.futureDraftPicks.filter(function (pick) {
        return pick && Number(pick.year) && Number(pick.round);
      }) : [];

    var matchups = {
      period: matchupPayload.period == null ? null : matchupPayload.period,
      matchups: Array.isArray(matchupPayload.matchups) ? matchupPayload.matchups : []
    };

    var leagueInfo = {};
    Object.keys(rawLeagueInfo).forEach(function (key) {
      if (key !== "playerInfo") leagueInfo[key] = rawLeagueInfo[key];
    });

    return {
      teams: teams,
      players: players,
      standings: standings,
      picks: picks,
      matchups: matchups,
      leagueInfo: leagueInfo,
      asOf: new Date().toISOString()
    };
  }

  function applyFantraxSnapshot(snapshot) {
    state.teams = objectOrEmpty(snapshot.teams);
    state.players = objectOrEmpty(snapshot.players);
    state.standings = Array.isArray(snapshot.standings) ? snapshot.standings : [];
    state.picks = Array.isArray(snapshot.picks) ? snapshot.picks : [];
    state.matchups = objectOrEmpty(snapshot.matchups);
    state.leagueInfo = objectOrEmpty(snapshot.leagueInfo);
    state.asOf = snapshot.asOf || new Date().toISOString();
  }

  function saveFantraxSnapshot() {
    try {
      localStorage.setItem("gms_fantrax_snapshot_v1", JSON.stringify({
        teams: state.teams,
        players: state.players,
        standings: state.standings,
        picks: state.picks,
        matchups: state.matchups,
        leagueInfo: state.leagueInfo,
        asOf: state.asOf
      }));
    } catch (e) {}
  }

  function restoreFantraxSnapshot() {
    try {
      var snapshot = JSON.parse(localStorage.getItem("gms_fantrax_snapshot_v1") || "null");
      if (!snapshot || !Object.keys(objectOrEmpty(snapshot.teams)).length) return false;
      applyFantraxSnapshot(snapshot);
      return true;
    } catch (e) {
      return false;
    }
  }

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
      applyFantraxSnapshot(normalizeFantrax(parts));
      saveFantraxSnapshot();
      state.loading = false;
      try { localStorage.setItem("gms_last_sync", state.asOf); } catch (e) {}
    } catch (e) {
      state.loading = false;
      var msg = String(e.message || e);
      if (/Failed to fetch|NetworkError|CORS|blocked/i.test(msg)) {
        msg = "Fantrax blocked browser request (CORS). Need a proxy worker for live rosters. UI still works offline.";
      }
      state.error = Object.keys(state.teams).length
        ? ("Live refresh failed; showing the last saved Fantrax sync. " + msg)
        : msg;
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

  function allRosterPlayers() {
    var players = [];
    allTeamNames().forEach(function (teamName) {
      players = players.concat(teamPlayers(teamName));
    });
    return players;
  }

  function compactPlayer(player) {
    return {
      id: player.id,
      name: player.name,
      position: player.pos,
      nflTeam: player.nfl,
      salary: Math.round(player.salary * 100) / 100,
      contractYears: player.years,
      rosterStatus: player.status
    };
  }

  function aiLeagueContext() {
    var league = state.leagueInfo || {};
    var teams = Object.keys(state.teams).map(function (teamId) {
      var team = state.teams[teamId];
      var players = teamPlayers(team.name);
      var spent = players.reduce(function (sum, player) { return sum + player.salary; }, 0);
      return {
        id: teamId,
        name: team.name,
        salaryCap: Number(team.salaryCap || CAP_NOW),
        salaryUsed: Math.round(spent * 100) / 100,
        capSpace: Math.round((Number(team.salaryCap || CAP_NOW) - spent) * 100) / 100,
        roster: players.map(compactPlayer)
      };
    });
    return {
      asOf: state.asOf,
      source: "Live Fantrax league astbqxhwmk4b6bg9",
      league: {
        id: LEAGUE_ID,
        name: league.leagueName || BYLAWS.name,
        season: league.seasonYear || 2026,
        ppr: league.ppr,
        draftType: league.draftType,
        draftSettings: league.draftSettings || null,
        rosterRules: league.rosterInfo || null,
        scoringFormat: "Superflex, TE premium, offense plus IDP with sack premium"
      },
      bylaws: BYLAWS,
      franchise: { id: MY_TEAM_ID, name: MY_TEAM, coach: COACHES[COACH] || COACHES.process },
      teams: teams,
      standings: state.standings || [],
      futureDraftPicks: state.picks || [],
      currentMatchups: state.matchups || null
    };
  }

  function providerLabel(provider) {
    return provider === "gemini" ? "Gemini" : "Cloudflare Llama";
  }

  async function requestGM(messages, provider) {
    var selected = provider === "gemini" ? "gemini" : "llama";
    if (selected === "gemini" && !GEMINI_CONSENT) {
      throw new Error("Check the Gemini consent box before sending a prompt to Gemini.");
    }
    var coach = COACHES[COACH] || COACHES.process;
    var response = await fetch(AI_GATEWAY + "/gm-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: selected,
        geminiConsent: selected === "gemini" && GEMINI_CONSENT,
        messages: (messages || []).slice(-16),
        context: selected === "gemini" ? { asOf: state.asOf, nflLive: null } : aiLeagueContext(),
        memory: {
          personalization: (selected === "gemini" ? "GM style: " : "Capitol Carnage GM style: ") + coach.name + ". " + coach.lens
        }
      })
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || (providerLabel(selected) + " request failed (HTTP " + response.status + ")"));
    if (!data.answer || !data.answer.text) throw new Error(providerLabel(selected) + " returned no answer.");
    return data.answer;
  }

  function persistChat() {
    try { localStorage.setItem("gms_chat", JSON.stringify(state.chat.slice(-40))); } catch (e) {}
  }

  function normalizeAssetName(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function teamIdByName(name) {
    var ids = Object.keys(state.teams);
    for (var i = 0; i < ids.length; i++) {
      if (state.teams[ids[i]].name === name) return ids[i];
    }
    return "";
  }

  function draftPickAsset(query, ownerName) {
    var text = String(query || "");
    var yearMatch = text.match(/\b(20\d{2})\b/);
    if (!yearMatch) return null;
    var round = /\b(?:1st|first|round\s*1)\b/i.test(text) ? 1
      : /\b(?:2nd|second|round\s*2)\b/i.test(text) ? 2
        : /\b(?:3rd|third|round\s*3)\b/i.test(text) ? 3 : 0;
    if (!round) return null;
    var year = Number(yearMatch[1]);
    var ownerId = teamIdByName(ownerName);
    var matchingPicks = state.picks.filter(function (pick) {
      return Number(pick.year) === year && Number(pick.round) === round && String(pick.currentOwnerTeamId) === ownerId;
    });
    if (/original/i.test(text) && matchingPicks.length > 1) {
      var normalizedQuery = normalizeAssetName(text);
      var hintedTeamId = Object.keys(state.teams).find(function (teamId) {
        return normalizedQuery.indexOf(normalizeAssetName(state.teams[teamId].name)) >= 0;
      });
      if (hintedTeamId) {
        matchingPicks = matchingPicks.filter(function (pick) {
          return String(pick.originalOwnerTeamId) === hintedTeamId;
        });
      }
    }
    if (!matchingPicks.length) {
      return { error: ownerName + " does not own a " + year + " Round " + round + " pick in the synced Fantrax data." };
    }
    var pick = matchingPicks[0];
    var originalOwner = state.teams[pick.originalOwnerTeamId] && state.teams[pick.originalOwnerTeamId].name;
    var base = round === 1 ? 74 : round === 2 ? 42 : 24;
    var value = Math.max(10, base - Math.max(0, year - 2027) * 6);
    return {
      type: "pick",
      id: [pick.currentOwnerTeamId, pick.originalOwnerTeamId, year, round].join(":"),
      name: year + " Round " + round + " pick" + (originalOwner ? " (originally " + originalOwner + ")" : ""),
      team: ownerName,
      value: value,
      salary: 0,
      years: 0,
      pos: "PICK",
      status: "FUTURE"
    };
  }

  function playerAssetValue(player) {
    var bases = { QB: 42, SFX: 42, RB: 38, WR: 40, TE: 37, DL: 34, ID: 34, LB: 33, DB: 31 };
    var base = bases[player.pos] || 28;
    var market = Math.min(42, Math.sqrt(Math.max(0, player.salary) / CAP_NOW) * 88);
    var control = Math.min(18, Math.max(0, player.years) * 4.5);
    var contractSignal = (bhsSignal(player).score - 50) * 0.3;
    var status = /ACTIVE/i.test(player.status) ? 4 : /MINORS|TAXI/i.test(player.status) ? 6 : /INJURED|OUT|SUSPEND/i.test(player.status) ? -6 : 0;
    return Math.max(10, Math.min(99, Math.round(base + market + control + contractSignal + status)));
  }

  function findPlayerAsset(query, ownerName) {
    var target = normalizeAssetName(query);
    if (!target) return { error: "Empty asset" };
    var players = allRosterPlayers();
    var exact = players.filter(function (player) { return normalizeAssetName(player.name) === target; });
    var matches = exact.length ? exact : players.filter(function (player) {
      var name = normalizeAssetName(player.name);
      return target.length >= 4 && (name.indexOf(target) >= 0 || target.indexOf(name) >= 0);
    });
    var ownedMatches = ownerName ? matches.filter(function (player) { return player.team === ownerName; }) : matches;
    if (ownedMatches.length === 1) matches = ownedMatches;
    if (matches.length !== 1) {
      return { error: matches.length ? ("Ambiguous player: " + query) : ("Player not found: " + query) };
    }
    var player = matches[0];
    if (ownerName && player.team !== ownerName) {
      return { error: player.name + " is rostered by " + player.team + ", not " + ownerName + "." };
    }
    return {
      type: "player",
      id: player.id,
      name: player.name,
      pos: player.pos,
      team: player.team,
      salary: player.salary,
      years: player.years,
      status: player.status,
      value: playerAssetValue(player)
    };
  }

  function resolveTradeSide(text, ownerName) {
    var queries = String(text || "").split(/[,;\n]+/).map(function (part) { return part.trim(); }).filter(Boolean);
    var assets = [];
    var errors = [];
    var seen = {};
    queries.forEach(function (query) {
      var asset = draftPickAsset(query, ownerName) || findPlayerAsset(query, ownerName);
      if (asset.error) {
        errors.push(asset.error);
      } else if (seen[asset.type + ":" + asset.id]) {
        errors.push("Duplicate asset: " + asset.name);
      } else {
        seen[asset.type + ":" + asset.id] = true;
        assets.push(asset);
      }
    });
    return { assets: assets, errors: errors };
  }

  function scoreTrade(giveText, getText, partnerName) {
    var give = resolveTradeSide(giveText, MY_TEAM);
    var get = resolveTradeSide(getText, partnerName);
    var errors = give.errors.concat(get.errors);
    if (!give.assets.length) errors.push("Add at least one asset to Your side.");
    if (!get.assets.length) errors.push("Add at least one asset to Their side.");
    var giveValue = give.assets.reduce(function (sum, asset) { return sum + asset.value; }, 0);
    var getValue = get.assets.reduce(function (sum, asset) { return sum + asset.value; }, 0);
    var ratio = giveValue ? getValue / giveValue : 0;
    var grade = ratio >= 1.15 ? "A" : ratio >= 1.05 ? "B+" : ratio >= 0.97 ? "B" : ratio >= 0.90 ? "C" : ratio >= 0.78 ? "D" : "F";
    var verdict = ratio >= 1.05 ? "ACCEPT" : ratio >= 0.97 ? "COUNTER" : "DECLINE";
    var salarySent = give.assets.reduce(function (sum, asset) { return sum + (asset.salary || 0); }, 0);
    var salaryReceived = get.assets.reduce(function (sum, asset) { return sum + (asset.salary || 0); }, 0);
    return {
      giveText: giveText,
      getText: getText,
      partner: partnerName,
      give: give.assets,
      get: get.assets,
      errors: errors,
      giveValue: giveValue,
      getValue: getValue,
      delta: getValue - giveValue,
      salaryDelta: salaryReceived - salarySent,
      ratio: ratio,
      grade: grade,
      verdict: verdict
    };
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
      html += '<option value="' + esc(n) + '"' + (n === sel ? " selected" : "") + ">" + esc(n) + (n === MY_TEAM ? " (YOU)" : "") + "</option>";
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

  function tradeAssetRows(assets) {
    return (assets || []).map(function (asset) {
      return '<tr><td><b>' + esc(asset.name) + '</b></td><td>' + esc(asset.pos || "-") + '</td><td>' +
        (asset.type === "pick" ? "-" : ("$" + Number(asset.salary || 0).toFixed(1))) + '</td><td>' +
        (asset.type === "pick" ? "-" : esc(asset.years)) + '</td><td><b>' + esc(asset.value) + '</b></td></tr>';
    }).join("");
  }

  function tradeResultHtml(result) {
    if (!result) return "";
    if (result.errors.length) {
      return '<div class="error-banner"><b>Fix these assets:</b><br>' + result.errors.map(esc).join("<br>") + '</div>';
    }
    var capClass = result.salaryDelta <= 0 ? "good" : "bad";
    var capText = (result.salaryDelta > 0 ? "+" : "") + "$" + result.salaryDelta.toFixed(1);
    var html = '<div class="notice"><b>' + esc(result.verdict) + ' · Grade ' + esc(result.grade) + '</b><br>' +
      'Contract-market value: receive ' + result.getValue + ', send ' + result.giveValue +
      ' (' + (result.delta >= 0 ? "+" : "") + result.delta + ').</div>';
    html += '<div class="grid3" style="margin-top:10px">';
    html += '<div class="metric"><b>' + esc(result.grade) + '</b><span>Trade grade</span></div>';
    html += '<div class="metric"><b>' + Math.round(result.ratio * 100) + '%</b><span>Value received</span></div>';
    html += '<div class="metric"><b class="' + capClass + '">' + capText + '</b><span>Annual cap change</span></div></div>';
    html += '<div class="grid2" style="margin-top:10px">';
    html += '<div><h3>Your side — sending</h3><div class="tableWrap"><table><thead><tr><th>Asset</th><th>Pos</th><th>Sal</th><th>Yrs</th><th>Value</th></tr></thead><tbody>' + tradeAssetRows(result.give) + '</tbody></table></div></div>';
    html += '<div><h3>Their side — receiving</h3><div class="tableWrap"><table><thead><tr><th>Asset</th><th>Pos</th><th>Sal</th><th>Yrs</th><th>Value</th></tr></thead><tbody>' + tradeAssetRows(result.get) + '</tbody></table></div></div></div>';
    html += '<p class="muted small" style="margin-top:10px">Baseline uses verified Fantrax salary, contract years, position, and roster status. It is a cap/asset screen—not a substitute for current projection and injury evidence.</p>';
    html += '<div class="actions"><button class="secondary" onclick="GMS.askTradeAI()"' + (state.tradeAiBusy ? " disabled" : "") + '>' +
      (state.tradeAiBusy ? "Reviewing…" : ("Ask " + esc(providerLabel(CHAT_PROVIDER)) + " for full review")) + '</button></div>';
    if (state.tradeAiError) html += '<div class="error-banner" style="margin-top:10px">' + esc(state.tradeAiError) + '</div>';
    if (state.tradeAiText) html += '<div class="notice" style="margin-top:10px"><b>' + esc(providerLabel(CHAT_PROVIDER)) + ' review</b><br>' + esc(state.tradeAiText).replace(/\n/g, "<br>") + '</div>';
    return html;
  }

  function viewTrade() {
    var partners = allTeamNames().filter(function (name) { return name !== MY_TEAM; });
    if (partners.indexOf(state.tradePartner) < 0) state.tradePartner = partners[0] || "";
    var tradeOwnerIds = [teamIdByName(MY_TEAM), teamIdByName(state.tradePartner)];
    var pickSuggestions = state.picks.filter(function (pick) {
      return tradeOwnerIds.indexOf(String(pick.currentOwnerTeamId)) >= 0;
    }).map(function (pick) {
      var original = state.teams[pick.originalOwnerTeamId] && state.teams[pick.originalOwnerTeamId].name;
      return pick.year + " " + (Number(pick.round) === 1 ? "1st" : Number(pick.round) === 2 ? "2nd" : "3rd") +
        (original ? " (originally " + original + ")" : "");
    });
    var html = '<div class="card"><div class="sectionhead"><h2>Trade Lab</h2><span class="pill">ADVISE ONLY</span></div>';
    html += '<div class="notice"><b>Simulate here. Execute in Fantrax.</b> Enter exact player names separated by commas. Draft picks work as “2027 1st”, “2028 2nd”, etc.</div>';
    html += '<div class="field"><label>Trade partner</label><select onchange="GMS.setTradePartner(this.value)">';
    partners.forEach(function (name) {
      html += '<option value="' + esc(name) + '"' + (name === state.tradePartner ? " selected" : "") + '>' + esc(name) + '</option>';
    });
    html += '</select></div>';
    html += '<div class="field"><label>Your side — assets you send</label><input type="text" id="tradeGive" list="tradeAssets" value="' + esc(state.trade ? state.trade.giveText : "") + '" placeholder="Player A, 2027 2nd"></div>';
    html += '<div class="field"><label>Their side — assets you receive</label><input type="text" id="tradeGet" list="tradeAssets" value="' + esc(state.trade ? state.trade.getText : "") + '" placeholder="Player B"></div>';
    html += '<datalist id="tradeAssets">' + allRosterPlayers().map(function (player) { return '<option value="' + esc(player.name) + '">'; }).join("") +
      pickSuggestions.map(function (pick) { return '<option value="' + esc(pick) + '">'; }).join("") + '</datalist>';
    html += '<div class="actions"><button class="primary" onclick="GMS.evalTrade()">Evaluate trade</button></div>';
    html += '<div id="tradeResult" style="margin-top:12px">' + tradeResultHtml(state.trade) + '</div></div>';
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
    html += '<div class="notice"><b>Real AI assistant.</b> Cloudflare Llama uses the synced Pride Dynasty roster, contracts, picks, standings, and matchup context. Gemini receives your prompt plus public NFL context only. Advise only—nothing is submitted to Fantrax.</div>';
    html += '<div class="field"><label>AI provider</label><select onchange="GMS.setChatProvider(this.value)">';
    html += '<option value="llama"' + (CHAT_PROVIDER === "llama" ? " selected" : "") + '>Cloudflare Llama</option>';
    html += '<option value="gemini"' + (CHAT_PROVIDER === "gemini" ? " selected" : "") + '>Gemini</option></select></div>';
    html += '<label class="notice" style="display:block;margin-top:8px"><input type="checkbox" onchange="GMS.setGeminiConsent(this.checked)"' + (GEMINI_CONSENT ? " checked" : "") + '> I agree to send my prompt and approved public context to Gemini when Gemini is selected.</label>';
    html += '<div class="chat-box"><div class="chat-log" id="chatLog">';
    if (!state.chat.length) html += '<div class="chat-msg ai"><b>GM:</b> Sync Fantrax, then ask about cuts, trades, waivers, picks, opponents, or cap.</div>';
    else state.chat.forEach(function (m) {
      html += '<div class="chat-msg ' + (m.role === "user" ? "user" : "ai") + '"><b>' + (m.role === "user" ? "You" : providerLabel(m.provider || CHAT_PROVIDER)) + ':</b> ' + esc(m.text).replace(/\n/g, "<br>") + '</div>';
    });
    if (state.chatBusy) html += '<div class="chat-msg ai"><b>' + esc(providerLabel(CHAT_PROVIDER)) + ':</b> Thinking…</div>';
    if (state.chatError) html += '<div class="error-banner">' + esc(state.chatError) + '</div>';
    html += '</div><div class="chat-input-row"><input type="text" id="chatInput" placeholder="Ask about your team..." onkeydown="if(event.key===\'Enter\')GMS.sendChat()"' + (state.chatBusy ? " disabled" : "") + '><button class="primary" onclick="GMS.sendChat()"' + (state.chatBusy ? " disabled" : "") + '>Send</button></div>';
    html += '<div class="actions"><button class="secondary" onclick="GMS.clearChat()">Clear chat</button></div></div></div>';
    return html;
  }

  function viewContact() {
    var html = '<div class="card"><div class="sectionhead"><h2>Contact Us</h2><span class="pill">GM LOCKER</span></div>';
    html += '<a class="contact-sponsor" href="https://www.ebay.com/str/pinvaultcollectibles" target="_blank" rel="noopener"><img src="pinvault-collectibles-logo.png" alt="Pin Vault Collectibles — Unlock the Vault. Chase the Rare."></a>';
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

  function openChat() {
    show("chat");
    var main = document.getElementById("main");
    if (main && typeof main.scrollIntoView === "function") main.scrollIntoView({ behavior: "smooth", block: "start" });
    var input = document.getElementById("chatInput");
    if (input && typeof input.focus === "function") input.focus();
  }

  window.GMS = {
    sync: syncFantrax,
    show: show,
    openChat: openChat,
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
    setTradePartner: function (partner) {
      state.tradePartner = allTeamNames().indexOf(partner) >= 0 && partner !== MY_TEAM ? partner : "";
      state.trade = null;
      state.tradeAiText = "";
      state.tradeAiError = null;
      try { localStorage.setItem("gms_trade_partner", state.tradePartner); } catch (e) {}
      render();
    },
    evalTrade: function () {
      var give = (document.getElementById("tradeGive") || {}).value || "";
      var get = (document.getElementById("tradeGet") || {}).value || "";
      state.trade = scoreTrade(give, get, state.tradePartner);
      state.tradeAiText = "";
      state.tradeAiError = null;
      render();
    },
    askTradeAI: async function () {
      if (!state.trade || state.trade.errors.length || state.tradeAiBusy) return;
      state.tradeAiBusy = true;
      state.tradeAiText = "";
      state.tradeAiError = null;
      render();
      var selected = CHAT_PROVIDER;
      var trade = state.trade;
      var prompt = "Evaluate this proposed trade between Capitol Carnage and " + trade.partner + ". Use the verified Fantrax league context and Pride Dynasty rules. " +
        "Return VERDICT, GRADE, FOUR-QUESTION VALUE TEST, WHY, RISKS, BEST COUNTER, and WHAT WOULD CHANGE THE DECISION. " +
        "Assets sent: " + JSON.stringify(trade.give) + ". Assets received: " + JSON.stringify(trade.get) + ". " +
        "The deterministic contract-market screen scored sent=" + trade.giveValue + ", received=" + trade.getValue +
        ", cap change=" + trade.salaryDelta.toFixed(1) + ". Treat that score as a baseline, not authoritative talent evaluation.";
      try {
        var answer = await requestGM([{ role: "user", content: prompt }], selected);
        state.tradeAiText = answer.text;
      } catch (e) {
        state.tradeAiError = String(e.message || e);
      }
      state.tradeAiBusy = false;
      render();
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
    setChatProvider: function (provider) {
      CHAT_PROVIDER = provider === "gemini" ? "gemini" : "llama";
      try { localStorage.setItem("gms_chat_provider", CHAT_PROVIDER); } catch (e) {}
      state.chatError = null;
      render();
    },
    setGeminiConsent: function (consent) {
      GEMINI_CONSENT = Boolean(consent);
      try { localStorage.setItem("gms_gemini_consent", GEMINI_CONSENT ? "true" : "false"); } catch (e) {}
      state.chatError = null;
      render();
    },
    clearChat: function () {
      state.chat = [];
      state.chatError = null;
      persistChat();
      render();
    },
    sendChat: async function () {
      var input = document.getElementById("chatInput");
      if (!input || !input.value.trim() || state.chatBusy) return;
      var text = input.value.trim();
      input.value = "";
      state.chat.push({ role: "user", text: text });
      persistChat();
      state.chatBusy = true;
      state.chatError = null;
      render();
      var selected = CHAT_PROVIDER;
      var messages = state.chat.map(function (message) {
        return { role: message.role === "ai" ? "assistant" : "user", content: message.text };
      });
      try {
        var answer = await requestGM(messages, selected);
        state.chat.push({ role: "ai", provider: selected, text: answer.text });
        persistChat();
      } catch (e) {
        state.chatError = String(e.message || e);
      }
      state.chatBusy = false;
      render();
    }
  };

  if (window.__GMS_TEST__) {
    window.GMS.__test = {
      normalizeFantrax: normalizeFantrax,
      applyFantraxSnapshot: applyFantraxSnapshot,
      scoreTrade: scoreTrade,
      state: state
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".nav button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        show(btn.getAttribute("data-view"));
      });
    });
    restoreFantraxSnapshot();
    render();
    syncFantrax();
  });
})();
