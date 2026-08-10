// Pride Dynasty config override
(function(){
  try {
    if (typeof DEFAULT_CONFIG !== 'undefined') {
      Object.assign(DEFAULT_CONFIG, {
        leagueName: 'Pride Dynasty',
        teamName: 'Capitol Carnage',
        teams: 14,
        salaryCap: 1404,
        superflex: true,
        tep: true,
        idp: true,
        sackPremium: true,
        fantraxLeagueId: 'astbqxhwmk4b6bg9',
        fantraxTeamId: 'nsf1b7esmk4b6bgd'
      });
      if (typeof db !== 'undefined' && db.config) {
        Object.assign(db.config, {
          leagueName: 'Pride Dynasty',
          teamName: 'Capitol Carnage',
          teams: 14,
          salaryCap: 1404,
          superflex: true,
          tep: true,
          idp: true,
          sackPremium: true
        });
        try { localStorage.setItem('ccgm_db', JSON.stringify(db)); } catch(e) {}
      }
    }
    console.log("GM's Locker Pride override applied — Capitol Carnage / astbqxhwmk4b6bg9");
  } catch(e) { console.warn('Pride override', e); }
})();
