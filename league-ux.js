(function () {
  "use strict";

  var PAGE_COPY = {
    leagues: ["LEAGUE HUB", "Manage the active Fantrax league, sync its data, and switch leagues."],
    war: ["WAR ROOM", "Team-specific decisions, priorities, targets, and opponent strategy."],
    team: ["MY TEAM", "Your roster, lineup, depth, contracts, injuries, and player evaluations."],
    startsit: ["START / SIT", "Weekly lineup decisions built from your legal roster and live projections."],
    games: ["GAME DAY", "NFL schedule, live games, and scoring context for the current week."],
    teams: ["LEAGUE TEAMS", "Inspect every franchise roster and its league-specific profile."],
    cap: ["CAP / DEAD", "Salary, dead money, contract pressure, and cut simulations."],
    bhs: ["BUY / HOLD / SELL", "League-wide player market signals using current roster evidence."],
    waivers: ["WAIVERS", "Available Fantrax players, roster fit, and pickup analysis."],
    trade: ["TRADE LAB", "Build and evaluate trades against the two actual rosters involved."],
    rankings: ["POWER RANKINGS", "League strength, starters, depth, cap, age, and draft capital."],
    picks: ["DRAFT PICKS", "Future draft capital and current ownership by franchise."],
    news: ["NFL NEWS", "Current NFL stories relevant to league decisions."],
    chat: ["GM CHAT", "Ask the assistant about this league using its current synced context."],
    contact: ["CONTACT", "Support, business, and Pin Vault Collectibles contacts."],
    settings: ["SETTINGS", "Account, personality, lineup rules, and data controls."]
  };

  function activeView() {
    var button = document.querySelector('.nav button.active');
    return button ? button.getAttribute('data-view') || '' : '';
  }

  function removeGlobalRedundancy(main) {
    var policy = main.querySelector('.evaluation-policy');
    if (policy) policy.remove();

    if (activeView() === 'settings') {
      Array.prototype.slice.call(main.querySelectorAll('.card')).forEach(function (card) {
        var heading = card.querySelector('h2');
        if (heading && heading.textContent.trim() === 'Your account') {
          var selector = card.querySelector('label');
          if (selector && /Active league/i.test(selector.textContent || '')) {
            var field = selector.closest('.field');
            if (field) field.remove();
          }
          var add = Array.prototype.slice.call(card.querySelectorAll('button')).filter(function (button) {
            return /Add another league/i.test(button.textContent || '');
          })[0];
          if (add) add.remove();
        }
      });
    }
  }

  function addPageIdentity(main, view) {
    if (!PAGE_COPY[view] || main.querySelector('.page-identity')) return;
    var copy = PAGE_COPY[view];
    var identity = document.createElement('div');
    identity.className = 'page-identity';
    identity.innerHTML = '<span>' + copy[0] + '</span><p>' + copy[1] + '</p>';
    main.insertBefore(identity, main.firstChild);
  }

  function addLeagueHub(main) {
    if (activeView() !== 'leagues' || main.querySelector('.league-command-center')) return;
    var firstCard = main.querySelector('.card');
    if (!firstCard) return;

    var hub = document.createElement('section');
    hub.className = 'card league-command-center';
    hub.innerHTML =
      '<div class="sectionhead"><div><h2>Active League Control</h2><span class="small muted">League setup is saved. Use this page for league-level actions.</span></div><span class="pill">FANTRAX</span></div>' +
      '<div class="league-command-grid">' +
        '<button class="league-command" type="button" data-league-action="roster"><b>Sync Roster</b><span>Refresh teams, players, roster assignments, contracts, and salaries.</span></button>' +
        '<button class="league-command" type="button" data-league-action="league"><b>Sync League</b><span>Refresh the complete Fantrax league dataset used throughout GMS Locker.</span></button>' +
        '<button class="league-command" type="button" data-league-action="team"><b>Open My Team</b><span>Go directly to your roster and lineup.</span></button>' +
        '<button class="league-command" type="button" data-league-action="teams"><b>League Teams</b><span>Open the full franchise directory.</span></button>' +
      '</div>';
    firstCard.parentNode.insertBefore(hub, firstCard.nextSibling);
  }

  function enhance() {
    var main = document.getElementById('main');
    if (!main) return;
    var view = activeView();
    removeGlobalRedundancy(main);
    addPageIdentity(main, view);
    addLeagueHub(main);

    var globalSync = document.getElementById('syncBtn');
    if (globalSync) globalSync.style.display = 'none';
  }

  function scheduleEnhance() {
    if (scheduleEnhance.pending) return;
    scheduleEnhance.pending = true;
    requestAnimationFrame(function () {
      scheduleEnhance.pending = false;
      enhance();
    });
  }

  function wrapLeagueFlow() {
    if (!window.GMS || window.GMS.__leagueUxWrapped) return;
    window.GMS.__leagueUxWrapped = true;

    var originalSave = window.GMS.saveLeague;
    if (typeof originalSave === 'function') {
      window.GMS.saveLeague = async function () {
        // A newly saved league should become the active league. Clearing the
        // old selection makes loadAccount choose the newly updated workspace.
        try { localStorage.removeItem('gms_active_workspace'); } catch (_) {}
        await originalSave.apply(window.GMS, arguments);
        try { localStorage.setItem('gms_view', 'leagues'); } catch (_) {}
        if (window.GMS && typeof window.GMS.show === 'function') window.GMS.show('leagues');
        scheduleEnhance();
      };
    }

    var originalCancel = window.GMS.cancelAddLeague;
    if (typeof originalCancel === 'function') {
      window.GMS.cancelAddLeague = function () {
        var result = originalCancel.apply(window.GMS, arguments);
        try { localStorage.setItem('gms_view', 'leagues'); } catch (_) {}
        if (window.GMS && typeof window.GMS.show === 'function') window.GMS.show('leagues');
        scheduleEnhance();
        return result;
      };
    }

    var originalShow = window.GMS.show;
    if (typeof originalShow === 'function') {
      window.GMS.show = function () {
        var result = originalShow.apply(window.GMS, arguments);
        scheduleEnhance();
        return result;
      };
    }
  }

  document.addEventListener('click', function (event) {
    var command = event.target.closest('[data-league-action]');
    if (!command) { scheduleEnhance(); return; }
    var action = command.getAttribute('data-league-action');
    if (action === 'roster' || action === 'league') {
      command.disabled = true;
      var original = command.innerHTML;
      command.innerHTML = '<b>Syncing…</b><span>Reading the active Fantrax league.</span>';
      Promise.resolve(window.GMS && window.GMS.sync && window.GMS.sync()).finally(function () {
        command.disabled = false;
        command.innerHTML = original;
        scheduleEnhance();
      });
    } else if (action === 'team' && window.GMS) {
      window.GMS.show('team');
    } else if (action === 'teams' && window.GMS) {
      window.GMS.show('teams');
    }
  });

  var observer = new MutationObserver(function (mutations) {
    var meaningful = mutations.some(function (mutation) {
      return mutation.target && mutation.target.id === 'main';
    });
    if (meaningful) scheduleEnhance();
  });

  function boot() {
    wrapLeagueFlow();
    var main = document.getElementById('main');
    if (main) observer.observe(main, { childList: true });
    scheduleEnhance();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
