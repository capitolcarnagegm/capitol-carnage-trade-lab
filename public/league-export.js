(()=>{
  const API_BASE='https://api.gmslocker.com';
  const ACTIVE_WORKSPACE_KEY='gms_active_workspace_v1';
  const escCsv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const pick=(obj,keys)=>{for(const k of keys){if(obj&&obj[k]!=null&&obj[k]!=="")return obj[k];}return '';};
  async function getWorkspace(){
    const token=sessionStorage.getItem('gms_session')||'';
    if(!token)throw new Error('Sign in to GMS Locker first.');
    const headers={Accept:'application/json',Authorization:'Bearer '+token};
    const acct=await fetch(API_BASE+'/account/leagues',{headers,cache:'no-store'});
    const data=await acct.json();
    if(!acct.ok)throw new Error(data.detail||data.error||'Could not load leagues.');
    const leagues=data.leagues||[];
    const remembered=localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    const workspace=leagues.find(x=>x.id===remembered)||leagues[0];
    if(!workspace)throw new Error('No linked league found.');
    return {token,workspace};
  }
  async function exportLeague(){
    const {token,workspace}=await getWorkspace();
    const headers={Accept:'application/json',Authorization:'Bearer '+token};
    const res=await fetch(API_BASE+'/league-data?workspaceId='+encodeURIComponent(workspace.id),{headers,cache:'no-store'});
    const data=await res.json();
    if(!res.ok)throw new Error(data.detail||data.error||'League data export failed.');
    const teams=(data.teams&&data.teams.length)?data.teams:Object.entries(data.rosters?.rosters||{}).map(([id,t])=>({id,name:t.teamName||id,players:t.rosterItems||[],picks:t.picks||[]}));
    const rows=[['Team','Team ID','Player','Position','NFL Team','Age','Salary','Contract Years','Roster Slot','Injury/Status','Season Projection','Weekly Projection','Performance PPG','Player ID']];
    for(const team of teams){
      for(const p of (team.players||team.items||[])){
        rows.push([
          team.name||team.teamName||'', team.id||'', pick(p,['name','playerName']), pick(p,['position','pos']), pick(p,['nflTeam','nfl']), pick(p,['age']),
          pick(p,['salary','currentSalary','contractSalary']), pick(p,['contractYears','years','contract']), pick(p,['rosterSlot','slot']), pick(p,['injury','status']),
          pick(p,['seasonProjection','projectedPoints','fpts']), pick(p,['weeklyProjection']), pick(p,['performancePpg','ppg','fpPerGame']), pick(p,['id','playerId'])
        ]);
      }
    }
    const csv=rows.map(r=>r.map(escCsv).join(',')).join('\r\n');
    const safe=(workspace.leagueName||'league').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase();
    const stamp=new Date().toISOString().slice(0,10);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=`${safe||'league'}-roster-export-${stamp}.csv`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function addButton(){
    const header=document.querySelector('header');
    if(!header||document.getElementById('leagueExportBtn'))return;
    const b=document.createElement('button');
    b.id='leagueExportBtn';b.type='button';b.textContent='Export Rosters';
    b.addEventListener('click',async()=>{
      const old=b.textContent;b.disabled=true;b.textContent='Exporting…';
      try{await exportLeague();b.textContent='Exported';setTimeout(()=>b.textContent=old,1800);}catch(e){alert(e.message||String(e));b.textContent=old;}
      finally{b.disabled=false;}
    });
    header.appendChild(b);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addButton);else addButton();
})();