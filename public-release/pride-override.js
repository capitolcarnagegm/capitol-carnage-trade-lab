// Pride Dynasty + open access override
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
    }
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
    }

    var lock = document.getElementById('serverAuthLock');
    if (lock) lock.style.display = 'none';

    window.initializePrivateVault = async function(){
      if (typeof hideServerAuth === 'function') hideServerAuth();
      try {
        if (typeof startPrivateServices === 'function') await startPrivateServices();
      } catch (e) {
        console.warn(e);
        try { if (typeof loadFantraxLive === 'function') await loadFantraxLive({quiet:true}); } catch(err){}
        try { if (typeof loadSportsLive === 'function') await loadSportsLive({quiet:true}); } catch(err){}
      }
    };

    if (typeof apiFetch === 'function') {
      var _apiFetch = apiFetch;
      window.apiFetch = async function(path, options){
        var res = await _apiFetch(path, options || {});
        if (res.status === 401 && typeof hideServerAuth === 'function') hideServerAuth();
        return res;
      };
    }

    setTimeout(function(){
      var lock2 = document.getElementById('serverAuthLock');
      if (lock2) lock2.style.display = 'none';
      if (typeof startPrivateServices === 'function' && !window.__prideStarted) {
        window.__prideStarted = true;
        startPrivateServices().catch(function(){});
      }
    }, 400);

    console.log("GM's Locker open-access Pride override loaded");
  } catch (e) {
    console.warn('Pride override error', e);
  }
})();
