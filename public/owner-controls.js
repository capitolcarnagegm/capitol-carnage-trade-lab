const OWNER_API='https://api.gmslocker.com';
const OWNER_WORKSPACE_KEY='gms_active_workspace_v1';
let pendingLeague=null;

function ownerHeaders(){
  const token=sessionStorage.getItem('gms_session')||localStorage.getItem('gms_session')||'';
  return token?{Accept:'application/json',Authorization:'Bearer '+token}:{Accept:'application/json'};
}

async function ownerApi(path,opts={}){
  const headers={...ownerHeaders(),...(opts.headers||{})};
  const res=await fetch(OWNER_API+path,{...opts,headers,cache:'no-store'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail||data.error||`HTTP ${res.status}`);
  return data;
}

async function ownerIdentity(){try{return await ownerApi('/auth/me');}catch{return null;}}

function ownerNav(){
  const nav=document.getElementById('nav');
  if(!nav||document.getElementById('ownerTab'))return;
  const btn=document.createElement('button');
  btn.id='ownerTab';btn.type='button';
  btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><circle cx="12" cy="10" r="2"/><path d="M8.5 16c.8-2 2-3 3.5-3s2.7 1 3.5 3"/></svg><span>Owner</span>';
  btn.addEventListener('click',showOwnerPanel);nav.appendChild(btn);
}

async function diagnostics(){
  const result={api:'Checking',depth:'Checking',league:'Checking',workspace:'—'};
  try{const h=await ownerApi('/health');result.api=h?.ok?'Healthy':'Degraded';}catch(e){result.api='Failed: '+e.message;}
  try{const d=await ownerApi('/depth-charts?teams=IND,KC,PHI,BUF');result.depth=(d?.players?.length||0)>0?'Live':'No rows returned';}catch(e){result.depth='Failed: '+e.message;}
  try{const leagues=await ownerApi('/account/leagues');const remembered=localStorage.getItem(OWNER_WORKSPACE_KEY);const ws=(leagues.leagues||[]).find(x=>x.id===remembered)||(leagues.leagues||[])[0];result.workspace=ws?.leagueName||'No active league';if(ws){const league=await ownerApi('/league-data?workspaceId='+encodeURIComponent(ws.id));result.league=(league?.teams?.length||Object.keys(league?.rosters?.rosters||{}).length)>0?'Live':'No teams returned';}else result.league='No league linked';}catch(e){result.league='Failed: '+e.message;}
  return result;
}

function statusCard(label,value){const bad=/failed|degraded|no /i.test(String(value));return `<div class="metric"><span>${label}</span><b>${bad?'⚠ ':''}${String(value)}</b></div>`;}

async function showOwnerPanel(){
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.id==='ownerTab'));
  const main=document.getElementById('main');if(!main)return;
  main.innerHTML=`<section class="card"><div class="sectionhead"><div><span class="kicker">OWNER ONLY</span><h2>League Control Center</h2><p class="muted">Import or reconnect a Fantrax league, force a fresh pull, and verify every live-data layer.</p></div><span class="pill">ADMIN</span></div><div id="ownerStatus" class="grid3"><div class="metric"><span>Diagnostics</span><b>Running…</b></div></div></section>
  <section class="card"><h3>Import Fantrax League</h3><p class="muted">Paste the Fantrax league URL or league ID. GMS Locker will inspect the league, show its teams, and let you choose your franchise before saving it as the active workspace.</p><div class="field"><label>Fantrax league URL or ID</label><input id="ownerLeagueInput" placeholder="https://www.fantrax.com/...leagueId=... or league ID"></div><div class="actions"><button id="ownerInspect" class="primary" type="button">Find League</button></div><div id="ownerImportResult" class="notice" style="margin-top:16px"><b>No league selected</b><br>Importing is read-only. GMS Locker will never submit trades, cuts, or lineup changes to Fantrax.</div></section>
  <section class="card"><h3>Live League Operations</h3><div class="actions"><button id="ownerReload" class="primary" type="button">Reload League Data</button><button id="ownerHardReload" type="button">Clear App Cache + Reload</button><button id="ownerDepth" type="button">Open Depth Charts</button></div><div id="ownerResult" class="notice" style="margin-top:16px"><b>Reload League Data</b><br>Forces a new Fantrax snapshot for the active workspace.</div></section>`;
  document.getElementById('ownerInspect')?.addEventListener('click',inspectLeague);
  document.getElementById('ownerReload')?.addEventListener('click',reloadLeague);
  document.getElementById('ownerHardReload')?.addEventListener('click',hardReload);
  document.getElementById('ownerDepth')?.addEventListener('click',()=>location.href='depth-chart.html');
  const d=await diagnostics();const el=document.getElementById('ownerStatus');if(el)el.innerHTML=statusCard('API',d.api)+statusCard('Depth feed',d.depth)+statusCard('League',d.league)+statusCard('Workspace',d.workspace);
}

async function inspectLeague(){
  const input=document.getElementById('ownerLeagueInput'),btn=document.getElementById('ownerInspect'),out=document.getElementById('ownerImportResult');
  const league=input?.value?.trim();if(!league){if(out)out.innerHTML='<b>Enter a Fantrax league URL or ID.</b>';return;}
  if(btn){btn.disabled=true;btn.textContent='Finding League…';}
  try{
    pendingLeague=await ownerApi('/account/league/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({league})});
    const teams=pendingLeague.teams||[];
    if(!teams.length)throw new Error('Fantrax returned no teams for this league');
    if(out)out.innerHTML=`<b>${pendingLeague.leagueName||'Fantrax League'}</b><br>${teams.length} teams found.<div class="field" style="margin-top:12px"><label>Your franchise</label><select id="ownerTeamSelect">${teams.map(t=>`<option value="${String(t.id).replace(/"/g,'&quot;')}">${String(t.name).replace(/</g,'&lt;')}</option>`).join('')}</select></div><div class="actions" style="margin-top:12px"><button id="ownerSaveLeague" class="primary" type="button">Import This League</button></div>`;
    document.getElementById('ownerSaveLeague')?.addEventListener('click',saveImportedLeague);
  }catch(e){pendingLeague=null;if(out)out.innerHTML=`<b>Import failed</b><br>${String(e.message||e)}`;}finally{if(btn){btn.disabled=false;btn.textContent='Find League';}}
}

async function saveImportedLeague(){
  const out=document.getElementById('ownerImportResult'),sel=document.getElementById('ownerTeamSelect');
  if(!pendingLeague||!sel)return;
  const team=(pendingLeague.teams||[]).find(t=>String(t.id)===String(sel.value));if(!team)return;
  if(out)out.innerHTML='<b>Importing league…</b><br>Saving workspace and pulling live Fantrax data.';
  try{
    const saved=await ownerApi('/account/league',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({leagueId:pendingLeague.leagueId,leagueName:pendingLeague.leagueName,teamId:team.id,teamName:team.name})});
    const ws=saved.league;if(!ws?.id)throw new Error('League saved without a workspace ID');
    localStorage.setItem(OWNER_WORKSPACE_KEY,ws.id);
    const data=await ownerApi('/league-data?workspaceId='+encodeURIComponent(ws.id));
    const teamCount=data?.teams?.length||Object.keys(data?.rosters?.rosters||{}).length;
    if(!teamCount)throw new Error('League saved, but Fantrax returned no roster teams');
    if(window.GMS?.useLeague)await window.GMS.useLeague(ws.id);else if(window.GMS?.sync)await window.GMS.sync();
    const stamp=data.syncedAt?new Date(data.syncedAt).toLocaleString():new Date().toLocaleString();
    if(out)out.innerHTML=`<b>League imported successfully</b><br>${ws.leagueName||pendingLeague.leagueName} · Your team: ${team.name} · ${teamCount} teams loaded · ${stamp}`;
    pendingLeague=null;
    const d=await diagnostics();const status=document.getElementById('ownerStatus');if(status)status.innerHTML=statusCard('API',d.api)+statusCard('Depth feed',d.depth)+statusCard('League',d.league)+statusCard('Workspace',d.workspace);
  }catch(e){if(out)out.innerHTML=`<b>Import failed</b><br>${String(e.message||e)}`;}
}

async function reloadLeague(){
  const btn=document.getElementById('ownerReload'),out=document.getElementById('ownerResult');if(btn){btn.disabled=true;btn.textContent='Reloading Fantrax…';}if(out)out.innerHTML='<b>Reloading league source…</b><br>Requesting current teams, rosters, contracts, cap, picks, free agents and analysis.';
  try{const leagues=await ownerApi('/account/leagues');const remembered=localStorage.getItem(OWNER_WORKSPACE_KEY);const ws=(leagues.leagues||[]).find(x=>x.id===remembered)||(leagues.leagues||[])[0];if(!ws)throw new Error('No linked Fantrax league found');localStorage.setItem(OWNER_WORKSPACE_KEY,ws.id);const data=await ownerApi('/league-data?workspaceId='+encodeURIComponent(ws.id));const teamCount=data?.teams?.length||Object.keys(data?.rosters?.rosters||{}).length;if(!teamCount)throw new Error('Fantrax returned no teams');if(window.GMS?.useLeague)await window.GMS.useLeague(ws.id);else if(window.GMS?.sync)await window.GMS.sync();const stamp=data.syncedAt?new Date(data.syncedAt).toLocaleString():new Date().toLocaleString();if(out)out.innerHTML=`<b>Reload successful</b><br>${teamCount} teams loaded from ${ws.leagueName||'Fantrax'} · ${stamp}`;const d=await diagnostics();const status=document.getElementById('ownerStatus');if(status)status.innerHTML=statusCard('API',d.api)+statusCard('Depth feed',d.depth)+statusCard('League',d.league)+statusCard('Workspace',d.workspace);}catch(e){if(out)out.innerHTML=`<b>Reload failed</b><br>${String(e.message||e)}`;}finally{if(btn){btn.disabled=false;btn.textContent='Reload League Data';}}
}

async function hardReload(){try{if('caches'in window){for(const key of await caches.keys())await caches.delete(key);}const regs=await navigator.serviceWorker?.getRegistrations?.()||[];for(const reg of regs)await reg.update().catch(()=>{});}catch{}location.reload();}
async function initOwner(){const me=await ownerIdentity();if(me?.user?.isOwner)ownerNav();}
window.addEventListener('load',()=>setTimeout(initOwner,400));
