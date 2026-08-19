(()=>{
  const API='https://api.gmslocker.com';
  const escCsv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  async function exportLeague(){
    const res=await fetch(API+'/public/pride-league?export='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.ok===false)throw new Error(data.detail||data.error||'League data export failed.');
    const teams=data.teams||[];
    if(!teams.length)throw new Error('No league teams were returned.');
    const rows=[['Team','Team ID','Player','Position','NFL Team','Age','Salary','Contract Years','Roster Slot','Status','Season Projection','Weekly Projection','PPG','Player ID']];
    for(const team of teams){for(const p of (team.players||[])){rows.push([team.name||'',team.id||'',p.name||p.playerName||'',p.position||p.pos||'',p.nflTeam||'',p.age??'',p.salary??'',p.contract??p.contractYears??'',p.rosterSlot||'',p.status||p.injury||'',p.seasonProjection??'',p.weeklyProjection??'',p.ppg??'',p.id||p.playerId||'']);}}
    const csv=rows.map(r=>r.map(escCsv).join(',')).join('\r\n');
    const safe=(data.leagueName||'pride-dynasty').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase();
    const stamp=new Date().toISOString().slice(0,10);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=`${safe}-roster-export-${stamp}.csv`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function addButton(){const header=document.querySelector('header');if(!header||document.getElementById('leagueExportBtn'))return;const b=document.createElement('button');b.id='leagueExportBtn';b.type='button';b.textContent='Export Rosters';b.addEventListener('click',async()=>{const old=b.textContent;b.disabled=true;b.textContent='Exporting…';try{await exportLeague();b.textContent='Exported';setTimeout(()=>b.textContent=old,1800);}catch(e){alert(e.message||String(e));b.textContent=old;}finally{b.disabled=false;}});header.appendChild(b);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addButton);else addButton();
})();