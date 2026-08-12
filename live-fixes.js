(function () {
  "use strict";

  var originalFetch = window.fetch.bind(window);
  var latestLeagueData = null;
  var latestGames = null;
  var lastView = "";

  window.fetch = async function () {
    var response = await originalFetch.apply(window, arguments);
    try {
      var url = String(arguments[0] && arguments[0].url || arguments[0] || "");
      if (response.ok && (url.indexOf("/league-data?") >= 0 || url.indexOf("/current-games?") >= 0)) {
        var data = await response.clone().json();
        if (url.indexOf("/league-data?") >= 0) latestLeagueData = data;
        if (url.indexOf("/current-games?") >= 0) latestGames = data;
        setTimeout(refreshDiagnostics, 0);
      }
    } catch (_) {}
    return response;
  };

  function countRosterPlayers(data) {
    var total = 0;
    Object.keys(data && data.rosters && data.rosters.rosters || {}).forEach(function (id) { total += (data.rosters.rosters[id].rosterItems || []).length; });
    return total;
  }

  function countFreeAgents(data) {
    var seen = {}, pool = data && data.freeAgents || {};
    [pool.season || {}, pool.weekly || {}, pool.performance || {}].forEach(function (group) { Object.keys(group).forEach(function (id) { seen[id] = true; }); });
    return Object.keys(seen).length;
  }

  function diagnosticsHtml() {
    if (!latestLeagueData) return "";
    var teamCount = Object.keys(latestLeagueData.rosters && latestLeagueData.rosters.rosters || {}).length;
    var rosterCount = countRosterPlayers(latestLeagueData), freeCount = countFreeAgents(latestLeagueData), warnings = latestLeagueData.warnings || [];
    return '<div class="card live-data-health"><div class="sectionhead"><h2>Live Data Health</h2><span class="pill">' + (warnings.length ? 'PARTIAL' : 'SYNCED') + '</span></div>' +
      '<div class="grid4"><div class="metric"><b>' + teamCount + '</b><span>Fantrax teams</span></div><div class="metric"><b>' + rosterCount + '</b><span>Roster assignments</span></div><div class="metric"><b>' + freeCount + '</b><span>Free agents loaded</span></div><div class="metric"><b>' + (latestLeagueData.syncedAt ? new Date(latestLeagueData.syncedAt).toLocaleTimeString() : '—') + '</b><span>Last server sync</span></div></div>' +
      (warnings.length ? '<div class="error-banner"><b>Partial Fantrax sync:</b> ' + escapeHtml(warnings.join(' · ')) + '</div>' : '<div class="notice"><b>Verified:</b> these roster assignments and free agents came from the current Fantrax response. No sample players are counted here.</div>') + '</div>';
  }

  function scheduleHtml() {
    if (!latestGames || !Array.isArray(latestGames.schedule)) return "";
    var games = latestGames.schedule, upcoming = games.filter(function (game) { return game.state === "pre"; }), display = (upcoming.length ? upcoming : games).slice(0, 20);
    var html = '<div class="card nfl-schedule"><div class="sectionhead"><div><h2>NFL Schedule</h2><span class="small muted">Upcoming games load before box scores exist</span></div><span class="pill">' + games.length + ' GAMES</span></div>';
    if (!display.length) return html + '<div class="error-banner">The schedule feed returned no games for this season type.</div></div>';
    display.forEach(function (game) {
      var when = game.date ? new Date(game.date).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';
      html += '<div class="gate"><span><b>' + escapeHtml((game.away && (game.away.abbreviation || game.away.name) || 'Away') + ' @ ' + (game.home && (game.home.abbreviation || game.home.name) || 'Home')) + '</b><br><span class="small">' + escapeHtml(when + (game.venue ? ' · ' + game.venue : '') + (game.broadcasts && game.broadcasts.length ? ' · ' + game.broadcasts.join(', ') : '')) + '</span></span><b>' + escapeHtml(game.status || 'Scheduled') + '</b></div>';
    });
    return html + '</div>';
  }

  function currentView() {
    var current = document.querySelector('.nav button.active');
    return current && current.getAttribute('data-view') || '';
  }

  function refreshDiagnostics() {
    var main = document.getElementById("main"), view = currentView();
    if (!main) return;
    var oldHealth = main.querySelector('.live-data-health'); if (oldHealth) oldHealth.remove();
    var oldSchedule = main.querySelector('.nfl-schedule'); if (oldSchedule) oldSchedule.remove();
    if (latestLeagueData && (view === 'leagues' || view === 'team' || view === 'waivers')) main.insertAdjacentHTML('afterbegin', diagnosticsHtml());
    if (view === 'games' && latestGames) {
      var firstCard = main.querySelector('.card');
      if (firstCard) firstCard.insertAdjacentHTML('afterend', scheduleHtml()); else main.insertAdjacentHTML('afterbegin', scheduleHtml());
    }
    lastView = view;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }

  document.addEventListener('click', function () { setTimeout(refreshDiagnostics, 80); });
  setInterval(function () { if (currentView() !== lastView) refreshDiagnostics(); }, 500);
})();
