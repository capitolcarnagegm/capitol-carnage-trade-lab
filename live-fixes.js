/**
 * GMS Locker live-fixes
 * Client-side recovery when server data is partial or empty.
 * - Forces ESPN schedule onto Game Day when /current-games has no schedule
 * - Surfaces live data health for rosters + free agents
 */
(function () {
  "use strict";

  var originalFetch = window.fetch.bind(window);
  var latestLeagueData = null;
  var latestGames = null;
  var lastView = "";
  var scheduleLoading = false;

  window.fetch = async function () {
    var response = await originalFetch.apply(window, arguments);
    try {
      var url = String((arguments[0] && arguments[0].url) || arguments[0] || "");
      if (response.ok && (url.indexOf("/league-data") >= 0 || url.indexOf("/current-games") >= 0)) {
        var data = await response.clone().json();
        if (url.indexOf("/league-data") >= 0) latestLeagueData = data;
        if (url.indexOf("/current-games") >= 0) {
          latestGames = data;
          // If server returned no schedule, pull ESPN directly in the browser
          if (!data.schedule || !data.schedule.length) {
            ensureClientSchedule();
          }
        }
        setTimeout(refreshDiagnostics, 0);
      }
    } catch (_) {}
    return response;
  };

  function ensureClientSchedule() {
    if (scheduleLoading) return;
    scheduleLoading = true;
    var year = new Date().getUTCFullYear();
    // Try regular season (2) then preseason (1)
    Promise.all([
      fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=" + year + "&seasontype=2").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?limit=100&dates=" + year + "&seasontype=1").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (boards) {
      var events = [];
      boards.forEach(function (board) {
        if (board && board.events) events = events.concat(board.events);
      });
      var schedule = events.map(function (event) {
        var competition = event.competitions && event.competitions[0];
        if (!competition) return null;
        var competitors = competition.competitors || [];
        var home = competitors.find(function (t) { return t.homeAway === "home"; }) || {};
        var away = competitors.find(function (t) { return t.homeAway === "away"; }) || {};
        return {
          id: String(event.id || ""),
          date: event.date || competition.date || "",
          name: event.name || event.shortName || "NFL game",
          shortName: event.shortName || event.name || "NFL game",
          state: event.status && event.status.type && event.status.type.state || "pre",
          status: (event.status && event.status.type && (event.status.type.shortDetail || event.status.type.detail)) || "Scheduled",
          home: {
            id: String((home.team && home.team.id) || ""),
            abbreviation: (home.team && home.team.abbreviation) || "",
            name: (home.team && (home.team.displayName || home.team.shortDisplayName)) || "",
            score: home.score == null ? "" : String(home.score)
          },
          away: {
            id: String((away.team && away.team.id) || ""),
            abbreviation: (away.team && away.team.abbreviation) || "",
            name: (away.team && (away.team.displayName || away.team.shortDisplayName)) || "",
            score: away.score == null ? "" : String(away.score)
          },
          venue: (competition.venue && competition.venue.fullName) || "",
          broadcasts: (competition.broadcasts || []).flatMap(function (b) { return b.names || []; })
        };
      }).filter(Boolean).sort(function (a, b) { return new Date(a.date) - new Date(b.date); });

      latestGames = Object.assign({}, latestGames || {}, {
        schedule: schedule,
        scheduleSource: "ESPN (client recovery)",
        syncedAt: new Date().toISOString()
      });
      scheduleLoading = false;
      refreshDiagnostics();
    }).catch(function () {
      scheduleLoading = false;
    });
  }

  function countRosterPlayers(data) {
    var total = 0;
    Object.keys((data && data.rosters && data.rosters.rosters) || {}).forEach(function (id) {
      total += ((data.rosters.rosters[id].rosterItems) || []).length;
    });
    return total;
  }

  function countFreeAgents(data) {
    var seen = {};
    var pool = (data && data.freeAgents) || {};
    [pool.season || {}, pool.weekly || {}, pool.performance || {}].forEach(function (group) {
      Object.keys(group).forEach(function (id) { seen[id] = true; });
    });
    return Object.keys(seen).length;
  }

  function diagnosticsHtml() {
    if (!latestLeagueData) return "";
    var teamCount = Object.keys((latestLeagueData.rosters && latestLeagueData.rosters.rosters) || {}).length;
    var rosterCount = countRosterPlayers(latestLeagueData);
    var freeCount = countFreeAgents(latestLeagueData);
    var warnings = latestLeagueData.warnings || [];
    return '<div class="card live-data-health"><div class="sectionhead"><h2>Live Data Health</h2><span class="pill">' +
      (warnings.length ? "PARTIAL" : "SYNCED") + '</span></div>' +
      '<div class="grid4">' +
      '<div class="metric"><b>' + teamCount + '</b><span>Fantrax teams</span></div>' +
      '<div class="metric"><b>' + rosterCount + '</b><span>Roster assignments</span></div>' +
      '<div class="metric"><b>' + freeCount + '</b><span>Free agents loaded</span></div>' +
      '<div class="metric"><b>' + (latestLeagueData.syncedAt ? new Date(latestLeagueData.syncedAt).toLocaleTimeString() : "—") + '</b><span>Last server sync</span></div>' +
      '</div>' +
      (rosterCount === 0 ? '<div class="error-banner"><b>No roster data.</b> Link a Fantrax league under Add New League / Settings, then hit Refresh.</div>' : "") +
      (freeCount === 0 ? '<div class="error-banner"><b>No free agents loaded.</b> Re-sync after the worker fix is deployed.</div>' : "") +
      (warnings.length ? '<div class="error-banner"><b>Partial Fantrax sync:</b> ' + escapeHtml(warnings.join(" · ")) + '</div>' : "") +
      '</div>';
  }

  function scheduleHtml() {
    if (!latestGames || !Array.isArray(latestGames.schedule)) {
      ensureClientSchedule();
      return '<div class="card nfl-schedule"><div class="sectionhead"><h2>NFL Schedule</h2></div><div class="notice">Loading schedule…</div></div>';
    }
    var games = latestGames.schedule;
    var upcoming = games.filter(function (g) { return g.state === "pre"; });
    var display = (upcoming.length ? upcoming : games).slice(0, 24);
    var html = '<div class="card nfl-schedule"><div class="sectionhead"><div><h2>NFL Schedule</h2><span class="small muted">' +
      escapeHtml(latestGames.scheduleSource || "Schedule") +
      '</span></div><span class="pill">' + games.length + ' GAMES</span></div>';
    if (!display.length) {
      return html + '<div class="error-banner">No games found for this season.</div></div>';
    }
    display.forEach(function (game) {
      var when = game.date
        ? new Date(game.date).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "Time TBA";
      var matchup =
        ((game.away && (game.away.abbreviation || game.away.name)) || "Away") +
        " @ " +
        ((game.home && (game.home.abbreviation || game.home.name)) || "Home");
      html += '<div class="gate"><span><b>' + escapeHtml(matchup) + '</b><br><span class="small">' +
        escapeHtml(when + (game.venue ? " · " + game.venue : "") + (game.broadcasts && game.broadcasts.length ? " · " + game.broadcasts.join(", ") : "")) +
        '</span></span><b>' + escapeHtml(game.status || "Scheduled") + '</b></div>';
    });
    return html + "</div>";
  }

  function currentView() {
    var current = document.querySelector(".nav button.active");
    return (current && current.getAttribute("data-view")) || "";
  }

  function refreshDiagnostics() {
    var main = document.getElementById("main");
    var view = currentView();
    if (!main) return;
    var oldHealth = main.querySelector(".live-data-health");
    if (oldHealth) oldHealth.remove();
    var oldSchedule = main.querySelector(".nfl-schedule");
    if (oldSchedule) oldSchedule.remove();
    if (latestLeagueData && (view === "leagues" || view === "team" || view === "waivers" || view === "war")) {
      main.insertAdjacentHTML("afterbegin", diagnosticsHtml());
    }
    if (view === "games") {
      var firstCard = main.querySelector(".card");
      if (firstCard) firstCard.insertAdjacentHTML("afterend", scheduleHtml());
      else main.insertAdjacentHTML("afterbegin", scheduleHtml());
    }
    lastView = view;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  document.addEventListener("click", function () { setTimeout(refreshDiagnostics, 80); });
  setInterval(function () {
    if (currentView() !== lastView) refreshDiagnostics();
  }, 500);

  // If user is already on Game Day, try loading schedule immediately
  setTimeout(function () {
    if (currentView() === "games") ensureClientSchedule();
  }, 800);
})();
