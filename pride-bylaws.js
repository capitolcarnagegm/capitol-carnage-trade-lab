// Pride Dynasty Bylaws — franchise rule base for gmslocker.com
// Source: PRIDE DYNASTY FANTASY FOOTBALL BYLAWS (Google Doc)
(function () {
  window.PRIDE_BYLAWS = {
    name: "Pride Dynasty",
    motto: "Pride ain't cheap.",
    teams: 14,
    division: 1,

    roster: {
      activeMin: 30,
      activeMax: 37,
      taxi: 6,
      taxiMaxAge: 23,
      ir: 5,
      qbMaxMain: 4,
      starters: {
        offense: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "RWT", "SFX"],
        defense: ["DL", "DL", "DL", "LB", "LB", "DB", "DB", "DB", "ID", "ID"],
        total: 19
      }
    },

    cap: {
      inaugural: 1100,
      auctionBudget: 1000,
      faBudgetInaugural: 100,
      annualIncreasePct: 0.05, // March 1 each year
      current: 1404, // after successive 5% increases from 1100
      complianceWindow: "March 1 through championship week",
      offseasonSoft: "Week 18 through Feb 28 — may exceed temporarily"
    },

    // Article IX §6 — exact
    deadCap: {
      currentYearPct: 1.0,
      followingYearPctByYearsRemaining: {
        1: 0,
        2: 0.40,
        3: 0.60,
        4: 0.80,
        5: 0.85 // rookie 5-yr extension only
      },
      note: "Dead only this year (100%) and optionally next year. No dead in year 3+."
    },

    contracts: {
      minYears: 1,
      maxYears: 4,
      rookieMaxYears: 5, // extension exception Art XIV
      annualRaisePct: 0.20,
      extensionMinRaisePct: 0.20,
      extensionMinFloor: 10, // if under $9.99, extend jumps to max($10, +20%)
      oneExtensionBeforeFA: true
    },

    ir: {
      salaryCountsPct: 0, // 0% while on IR
      seasonWindow: "Aug 1 through championship",
      offseasonOnlyCommissionerExemption: true
    },

    taxi: {
      size: 6,
      maxAge: 23,
      salaryCountsPct: 1.0, // 100% of salary still counts
      mustActivateOrCutAt24: true
    },

    // Article XII-ish tiers for tags/holdouts
    positionTiers: {
      franchiseTagTopN: { CB: 5, S: 5, RB: 8, TE: 8, DT: 8, DE: 8, QB: 10, WR: 12, LB: 12 },
      holdoutTopN: { CB: 8, S: 8, RB: 10, TE: 10, DT: 10, DE: 10, QB: 15, WR: 15, LB: 15 }
    },

    franchiseTag: {
      maxPerTeam: 1,
      mustBeExpiringMarch1: true,
      mustHaveBeenOnRosterRegularSeason: true,
      bidRequiresFirst: true,
      contractIfAwardedYears: 3,
      notifyDeadline: "Feb 28 11:59pm CT",
      bidDeadline: "March 21 noon CT",
      matchDeadline: "March 28 noon CT",
      declineCompensation: "1st round pick (current or defer next year)"
    },

    transitionTag: {
      maxPerTeam: 2,
      contractYears: 1,
      salary: "avg top-tier at position prior year, OR prior salary +20%, whichever higher",
      becomesUFAAfter: true
    },

    holdouts: {
      stage1: "If top-tier fantasy finish AND salary < 1/2 of avg top-tier salaries at pos → Stage 1 salary = 50% of that average (unless +20% raise already exceeds it)",
      stage2: "Further holdout tier per bylaws / annual sheet",
      cutBeforeMarch1UsesOriginalContractForDead: true
    },

    playoffs: {
      teams: 7,
      bye: 1,
      startWeek: 15,
      weeks: 3
    },

    schedule: {
      regularSeasonWeeks: 14,
      doubleHeader: "1v14, 2v13, … based on prior year finish"
    },

    fees: {
      annual: 350,
      fantrax: 7.14,
      due: "March 1"
    }
  };

  // Apply config into live db when available
  function applyToDb() {
    if (typeof db === "undefined" || !db) return;
    db.config = db.config || {};
    var B = window.PRIDE_BYLAWS;
    db.config.leagueName = B.name;
    db.config.teamName = db.config.teamName || "Capitol Carnage";
    db.config.teams = B.teams;
    db.config.salaryCap = B.cap.current;
    db.config.superflex = true;
    db.config.idp = true;
    db.config.tep = true;
    db.prideBylaws = B;
  }

  function ensureView() {
    if (document.getElementById("bylaws")) return;
    var sec = document.createElement("section");
    sec.id = "bylaws";
    sec.className = "view";
    (document.querySelector(".app") || document.body).appendChild(sec);
  }

  function patchNav() {
    var navEl = document.getElementById("nav");
    if (!navEl || navEl.querySelector('[data-view="bylaws"]')) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.view = "bylaws";
    btn.textContent = "Bylaws";
    btn.onclick = function () { showView("bylaws"); };
    navEl.appendChild(btn);
  }

  window.renderBylawsPage = function () {
    ensureView();
    var root = document.getElementById("bylaws");
    if (!root) return;
    var B = window.PRIDE_BYLAWS;
    root.innerHTML =
      '<div class="card"><div class="sectionhead"><h2>Pride Dynasty Bylaws</h2><span class="pill">FRANCHISE BASE</span></div>' +
      '<div class="notice"><b>"' + B.motto + '"</b> — These rules drive Cap/Dead, roster checks, tags, and 5-year projections on this site.</div></div>' +

      '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>Roster</h2></div>' +
      '<div class="gate"><span>Active roster</span><b>' + B.roster.activeMin + '–' + B.roster.activeMax + '</b></div>' +
      '<div class="gate"><span>Starters</span><b>' + B.roster.starters.total + ' (9 OFF / 10 DEF)</b></div>' +
      '<div class="gate"><span>Taxi</span><b>' + B.roster.taxi + ' (≤' + B.roster.taxiMaxAge + ' yrs, 100% cap)</b></div>' +
      '<div class="gate"><span>IR</span><b>' + B.roster.ir + ' (0% salary while on IR)</b></div>' +
      '<div class="gate"><span>QB max (main)</span><b>' + B.roster.qbMaxMain + '</b></div></div>' +

      '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>Salary Cap</h2></div>' +
      '<div class="gate"><span>Current cap</span><b>$' + B.cap.current + '</b></div>' +
      '<div class="gate"><span>March 1 raise</span><b>+' + (B.cap.annualIncreasePct * 100) + '%</b></div>' +
      '<div class="gate"><span>Must be under</span><b>March 1 → championship</b></div>' +
      '<div class="gate"><span>Soft offseason</span><b>Wk18 → Feb 28</b></div></div>' +

      '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>Dead Cap (Art. IX §6)</h2></div>' +
      '<div class="notice">Cut before contract ends:</div>' +
      '<div class="gate"><span>This year</span><b>100% of salary</b></div>' +
      '<div class="gate"><span>2 years left → next year</span><b>40%</b></div>' +
      '<div class="gate"><span>3 years left → next year</span><b>60%</b></div>' +
      '<div class="gate"><span>4 years left → next year</span><b>80%</b></div>' +
      '<div class="gate"><span>5 years left → next year</span><b>85% (rookie ext only)</b></div>' +
      '<div class="notice">No dead in year 3+. Example: $20 × 3 yrs → $20 now, $12 next year, then $0.</div></div>' +

      '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>Contracts</h2></div>' +
      '<div class="gate"><span>Length</span><b>1–4 years (rookies up to 5 on ext)</b></div>' +
      '<div class="gate"><span>Annual raise</span><b>+20% each year</b></div>' +
      '<div class="gate"><span>Extension</span><b>min +20% (floor $10 if under $9.99)</b></div></div>' +

      '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>Tags & Holdouts</h2></div>' +
      '<div class="gate"><span>Franchise tag</span><b>1 player, expiring only, bid starts at top-tier avg</b></div>' +
      '<div class="gate"><span>Decline match</span><b>Gets a 1st (or defer)</b></div>' +
      '<div class="gate"><span>Transition tag</span><b>Up to 2, 1-year deal</b></div>' +
      '<div class="gate"><span>Stage 1 holdout</span><b>Top-tier finish + low pay → 50% of top-tier avg</b></div></div>' +

      '<div class="card" style="margin-top:12px"><div class="sectionhead"><h2>Season</h2></div>' +
      '<div class="gate"><span>Regular season</span><b>' + B.schedule.regularSeasonWeeks + ' weeks</b></div>' +
      '<div class="gate"><span>Playoffs</span><b>Top ' + B.playoffs.teams + ', bye to #1, start wk ' + B.playoffs.startWeek + '</b></div></div>';
  };

  var origShow = window.showView;
  window.showView = function (id) {
    ensureView();
    if (id === "bylaws") {
      document.querySelectorAll(".view").forEach(function (x) { x.classList.remove("active"); });
      var el = document.getElementById("bylaws");
      if (el) el.classList.add("active");
      document.querySelectorAll("#nav button").forEach(function (x) {
        x.classList.toggle("active", x.dataset.view === id);
      });
      try { localStorage.setItem("ccgm_view", id); } catch (e) {}
      window.renderBylawsPage();
      return;
    }
    if (typeof origShow === "function") origShow(id);
  };

  function boot() {
    applyToDb();
    setInterval(applyToDb, 3000);
    ensureView();
    patchNav();
    setInterval(patchNav, 4000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
