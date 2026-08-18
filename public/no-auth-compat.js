(()=>{
  const API='https://api.gmslocker.com';
  const LEAGUE_ID='astbqxhwmk4b6bg9';
  const WORKSPACE_ID='pride-live';
  const nativeFetch=window.fetch.bind(window);
  let leagueCache=null;

  // The legacy full UI expects a session token. Give it a local sentinel only;
  // this is never sent to a real auth service because auth/account calls below
  // are intercepted in-browser.
  try{sessionStorage.setItem('gms_session','gms-public-live');}catch{}
  try{localStorage.setItem('gms_active_workspace_v1',WORKSPACE_ID);}catch{}

  const response=(body,status=200)=>new Response(JSON.stringify(body),{
    status,
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });

  async function liveLeague(force=false){
    if(leagueCache&&!force)return leagueCache;
    const r=await nativeFetch(API+'/public/pride-league?ts='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.ok)throw new Error(d.detail||d.error||'Pride league sync failed');
    leagueCache=d;
    return d;
  }

  function myTeam(league){
    return (league.teams||[]).find(t=>/capitol\s+carnage/i.test(t.name||''))||(league.teams||[])[0]||{id:'capitol-carnage',name:'Capitol Carnage'};
  }

  function workspace(league){
    const mine=myTeam(league);
    return {
      id:WORKSPACE_ID,
      leagueId:LEAGUE_ID,
      leagueName:league.leagueName||'Pride Dynasty',
      teamId:mine.id,
      teamName:mine.name,
      settings:{publicLive:true}
    };
  }

  function fullSnapshot(league){
    const teams=(league.teams||[]).map(t=>({
      id:t.id,
      name:t.name,
      players:t.players||[],
      items:t.players||[],
      picks:t.picks||[],
      deadCap:null
    }));
    return {
      leagueId:LEAGUE_ID,
      leagueName:league.leagueName||'Pride Dynasty',
      teams,
      rosters:{rosters:Object.fromEntries(teams.map(t=>[t.id,{teamName:t.name,rosterItems:t.players||[]}]))},
      picks:league.picks||{futureDraftPicks:[]},
      freeAgents:league.freeAgents||[],
      recommendations:league.recommendations||[],
      rankings:league.rankings||[],
      myAnalysis:league.myAnalysis||null,
      warnings:league.warnings||[],
      syncedAt:league.syncedAt||new Date().toISOString(),
      source:league.source||'Fantrax live read-only'
    };
  }

  window.fetch=async function(input,init={}){
    const raw=typeof input==='string'?input:input?.url||'';
    let url;
    try{url=new URL(raw,location.href);}catch{return nativeFetch(input,init);}
    if(url.origin!==API)return nativeFetch(input,init);

    const path=url.pathname;
    if(path==='/auth/me'){
      return response({user:{id:'public-live',username:'Capitol Carnage',displayName:'Capitol Carnage',email:'',isOwner:true}});
    }
    if(path==='/auth/login'||path==='/auth/register'){
      return response({token:'gms-public-live',user:{id:'public-live',username:'Capitol Carnage',displayName:'Capitol Carnage'}});
    }
    if(path==='/auth/logout')return response({ok:true});
    if(path==='/account/leagues'){
      try{const league=await liveLeague();return response({leagues:[workspace(league)]});}
      catch(e){return response({error:String(e.message||e)},502);}
    }
    if(path==='/league-data'){
      try{const league=await liveLeague(true);return response(fullSnapshot(league));}
      catch(e){return response({error:String(e.message||e)},502);}
    }
    if(path==='/news')return response({articles:[],syncedAt:new Date().toISOString()});
    if(path==='/account/league/inspect'){
      try{const league=await liveLeague();return response({leagueId:LEAGUE_ID,leagueName:league.leagueName||'Pride Dynasty',teams:(league.teams||[]).map(t=>({id:t.id,name:t.name}))});}
      catch(e){return response({error:String(e.message||e)},502);}
    }
    if(path==='/account/league'){
      try{const league=await liveLeague();return response({league:workspace(league)});}
      catch(e){return response({error:String(e.message||e)},502);}
    }
    return nativeFetch(input,init);
  };

  // Full UI settings historically exposed "Sign out". There is no account now,
  // so keep users inside the app if legacy code calls logout.
  window.addEventListener('DOMContentLoaded',()=>{
    document.documentElement.dataset.auth='disabled';
  });
})();
