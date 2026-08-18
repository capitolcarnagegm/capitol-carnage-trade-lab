const OWNER_API='https://api.gmslocker.com';
const OWNER_WORKSPACE_KEY='gms_active_workspace_v1';

function ownerHeaders(){
  const token=sessionStorage.getItem('gms_session')||'';
  return token?{Accept:'application/json',Authorization:'Bearer '+token}:{Accept:'application/json'};
}

async function ownerApi(path){
  const res=await fetch(OWNER_API+path,{headers:ownerHeaders(),cache:'no-store'});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail||data.error||`HTTP ${res.status}`);
  return data;
}

async function ownerIdentity(){
  try{return await ownerApi('/auth/me');}catch{return null;}
}

function ownerNav(){
  const nav=document.getElementById('nav');
  if(!nav||document.getElementById('ownerTab')) return;
  const btn=document.createElement('button');
  btn.id='ownerTab';
  btn.type='button';
  btn.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><circle cx="12" cy="10" r="2"/><path d="M8.5 16c.8-2 2-3 3.5-3s2.7 1 3.5 3"/></svg><span>Owner</span>';
  btn.addEventListener('click',showOwnerPanel);
  nav.appendChild(btn);
}

async function diagnostics(){
  const result={api:'Checking',depth:'Checking',league:'Checking',workspace:'—'};
  try{
    const h=await ownerApi('/health');
    result.api=h?.ok?'Healthy':'Degraded';
  }catch(e){result.api='Failed: '+e.message;}
  try{
    const d=await ownerApi('/depth-charts?teams=IND,KC,PHI,BUF');
    result.depth=(d?.players?.length||0)>0?'Live':'No rows returned';
  }catch(e){result.depth='Failed: '+e.message;}
  try{
    const leagues=await ownerApi('/account/leagues');
    const remembered=localStorage.getItem(OWNER_WORKSPACE_KEY);
    const ws=(leagues.leagues||[]).find(x=>x.id===remembered)||(leagues.leagues||[])[0];
    result.workspace=ws?.leagueName||'No active league';
    if(ws){
      const league=await ownerApi('/league-data?workspaceId='+encodeURIComponent(ws.id));
      result.league=(league?.teams?.length||Object.keys(league?.rosters?.rosters||{}).length)>0?'Live':'No teams returned';
    }else result.league='No league linked';
  }catch(e){result.league='Failed: '+e.message;}
  return result;
}

function statusCard(label,value){
  const bad=/failed|degraded|no /i.test(String(value));
  return `<div class="metric"><span>${label}</span><b>${bad?'⚠ ':''}${String(value)}</b></div>`;
}

async function showOwnerPanel(){
  document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active',b.id==='ownerTab'));
  const main=document.getElementById('main');
  if(!main)return;
  main.innerHTML=`<section class="card"><div class="sectionhead"><div><span class="kicker">OWNER ONLY</span><h2>League Control Center</h2><p class="muted">Force a fresh Fantrax pull, verify the API, and see exactly where live data is failing.</p></div><span class="pill">ADMIN</span></div><div id="ownerStatus" class="grid3"><div class="metric"><span>Diagnostics</span><b>Running…</b></div></div><div class="actions" style="margin-top:18px"><button id="ownerReload" class="primary" type="button">Reload League Data</button><button id="ownerHardReload" type="button">Clear App Cache + Reload</button><button id="ownerDepth" type="button">Open Depth Charts</button></div><div id="ownerResult" class="notice" style="margin-top:16px"><b>Use Reload League Data</b><br>This requests a fresh league snapshot from Fantrax and refreshes the War Room state.</div></section>`;
  document.getElementById('ownerReload')?.addEventListener('click',reloadLeague);
  document.getElementById('ownerHardReload')?.addEventListener('click',hardReload);
  document.getElementById('ownerDepth')?.addEventListener('click',()=>location.href='depth-chart.html');
  const d=await diagnostics();
  const el=document.getElementById('ownerStatus');
  if(el)el.innerHTML=statusCard('API',d.api)+statusCard('Depth feed',d.depth)+statusCard('League',d.league)+statusCard('Workspace',d.workspace);
}

async function reloadLeague(){
  const btn=document.getElementById('ownerReload'),out=document.getElementById('ownerResult');
  if(btn){btn.disabled=true;btn.textContent='Reloading Fantrax…';}
  if(out)out.innerHTML='<b>Reloading league source…</b><br>Requesting current teams, rosters, contracts, cap, picks, free agents and analysis.';
  try{
    const leagues=await ownerApi('/account/leagues');
    const remembered=localStorage.getItem(OWNER_WORKSPACE_KEY);
    const ws=(leagues.leagues||[]).find(x=>x.id===remembered)||(leagues.leagues||[])[0];
    if(!ws)throw new Error('No linked Fantrax league found');
    localStorage.setItem(OWNER_WORKSPACE_KEY,ws.id);
    const data=await ownerApi('/league-data?workspaceId='+encodeURIComponent(ws.id));
    const teamCount=data?.teams?.length||Object.keys(data?.rosters?.rosters||{}).length;
    if(!teamCount)throw new Error('Fantrax returned no teams');
    if(window.GMS?.sync) await window.GMS.sync();
    const stamp=data.syncedAt?new Date(data.syncedAt).toLocaleString():new Date().toLocaleString();
    if(out)out.innerHTML=`<b>Reload successful</b><br>${teamCount} teams loaded from ${ws.leagueName||'Fantrax'} · ${stamp}`;
    const d=await diagnostics();
    const status=document.getElementById('ownerStatus');
    if(status)status.innerHTML=statusCard('API',d.api)+statusCard('Depth feed',d.depth)+statusCard('League',d.league)+statusCard('Workspace',d.workspace);
  }catch(e){
    if(out)out.innerHTML=`<b>Reload failed</b><br>${String(e.message||e)}`;
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Reload League Data';}
  }
}

async function hardReload(){
  const out=document.getElementById('ownerResult');
  if(out)out.innerHTML='<b>Clearing local app cache…</b><br>Your league connection is preserved.';
  try{
    if('caches' in window){for(const key of await caches.keys())await caches.delete(key);}
    const regs=await navigator.serviceWorker?.getRegistrations?.()||[];
    for(const reg of regs)await reg.update().catch(()=>{});
  }catch{}
  location.reload();
}

async function initOwner(){
  const me=await ownerIdentity();
  if(me?.user?.isOwner) ownerNav();
}

window.addEventListener('load',()=>setTimeout(initOwner,400));
