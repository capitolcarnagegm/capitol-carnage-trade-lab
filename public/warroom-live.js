(()=>{
  const API='https://api.gmslocker.com';
  let cache=null;
  let loading=null;
  let timer=null;

  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:null;};
  const money=v=>{const n=num(v);return n==null?'Not returned':'$'+(Math.round(n*100)/100).toLocaleString();};
  const one=v=>{const n=num(v);return n==null?'—':(Math.round(n*10)/10).toLocaleString();};
  const rosterSlot=s=>{s=String(s||'').toUpperCase();if(s.includes('ACTIVE'))return'Active';if(s.includes('RESERVE')||s.includes('BENCH'))return'Reserve';if(s.includes('INJURED')||s==='IR')return'IR';if(s.includes('MINOR')||s.includes('TAXI'))return'Taxi';return'Other';};
  const projection=p=>{for(const v of [p?.seasonProjection,p?.weeklyProjection,p?.ppg]){const n=num(v);if(n!=null)return n;}return 0;};

  function isWarRoom(){return document.querySelector('#nav button[data-view="now"]')?.classList.contains('active');}

  async function data(force=false){
    if(cache&&!force)return cache;
    if(loading&&!force)return loading;
    loading=fetch(API+'/public/pride-league?warroom='+Date.now(),{cache:'no-store',headers:{Accept:'application/json'}})
      .then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.detail||d.error||`HTTP ${r.status}`);cache=d;return d;})
      .finally(()=>{loading=null;});
    return loading;
  }

  function teamProjection(t){return (t?.players||[]).reduce((s,p)=>s+projection(p),0);}

  function renderDashboard(d){
    if(!isWarRoom())return;
    const main=document.getElementById('main');
    if(!main||main.dataset.gmsWarroomLive==='1')return;
    const teams=d.teams||[];
    const t=teams.find(x=>/capitol\s+carnage/i.test(x.name||''))||teams[0];
    if(!t)return;
    const players=t.players||[];
    const slots={Active:0,Reserve:0,IR:0,Taxi:0,Other:0};
    const positions={};
    let committed=0, salaryKnown=0, projected=0, totalProjection=0, expiring=0;
    for(const p of players){
      slots[rosterSlot(p.rosterSlot)]++;
      const pk=String(p.position||'Other').toUpperCase()||'Other';positions[pk]=(positions[pk]||0)+1;
      const sal=num(p.salary);if(sal!=null){committed+=sal;salaryKnown++;}
      const pr=projection(p);if(pr>0){projected++;totalProjection+=pr;}
      const yrs=num(p.contract);if(yrs===1)expiring++;
    }
    const ranked=teams.map(x=>({name:x.name,total:teamProjection(x)})).sort((a,b)=>b.total-a.total);
    const rank=Math.max(1,ranked.findIndex(x=>x.name===t.name)+1);
    const top=players.slice().sort((a,b)=>projection(b)-projection(a)).slice(0,5);
    const posRows=Object.entries(positions).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="pill">${esc(k)} ${v}</span>`).join(' ');
    const coverage=players.length?Math.round(projected/players.length*100):0;

    main.dataset.gmsWarroomLive='1';
    main.innerHTML=`
      <section class="card warroom-pulse">
        <div class="pulse-top">
          <div>
            <div class="pulse-kicker">LIVE FRANCHISE COMMAND CENTER</div>
            <h1 class="pulse-title">${esc(t.name||'Capitol Carnage')}</h1>
            <p class="pulse-sub">Fantrax-backed roster economics, projection coverage, roster allocation and league context. No News or Game Day dependency.</p>
          </div>
          <div class="pulse-status"><strong>LIVE</strong><small>${esc(d.source||'Fantrax read-only')}</small></div>
        </div>
        <div class="pulse-grid">
          <div class="pulse-cell"><span>Fantrax salary cap</span><b>${money(t.salaryCap)}</b><small>live team cap field</small></div>
          <div class="pulse-cell"><span>Committed salary</span><b>${money(committed)}</b><small>${salaryKnown}/${players.length} salaries loaded</small></div>
          <div class="pulse-cell"><span>Roster projection rank</span><b>#${rank} of ${teams.length}</b><small>${one(totalProjection)} aggregate projected points</small></div>
          <div class="pulse-cell"><span>Projection coverage</span><b>${coverage}%</b><small>${projected}/${players.length} players with projections</small></div>
        </div>
      </section>

      <section class="grid3">
        <div class="metric"><span>Roster entries</span><b>${players.length}</b><small>${slots.Active} active · ${slots.Reserve} reserve</small></div>
        <div class="metric"><span>IR / Taxi</span><b>${slots.IR} / ${slots.Taxi}</b><small>${slots.Other} other roster slots</small></div>
        <div class="metric"><span>1-year contracts</span><b>${expiring}</b><small>potential upcoming decisions</small></div>
      </section>

      <section class="card">
        <div class="sectionhead"><h2>Roster construction</h2><span class="pill">LIVE</span></div>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px">${posRows||'<span class="muted">No position data returned.</span>'}</div>
      </section>

      <section class="card">
        <div class="sectionhead"><h2>Top projected assets</h2><span class="pill">FANTRAX</span></div>
        ${top.map((p,i)=>`<div class="player-row"><div class="player-main"><div class="player-name">${i+1}. ${esc(p.name||'Unknown')}</div><div class="player-meta"><span class="pos">${esc(p.position||'—')}</span><span class="team">${esc(p.nflTeam||'')}</span><span class="slot">${esc(rosterSlot(p.rosterSlot))}</span></div></div><div class="player-side"><div class="salary">${one(projection(p))}</div><div class="contract muted">${money(p.salary)}${p.contract!=null?' · '+esc(p.contract)+' yr':''}</div></div></div>`).join('')||'<p class="muted">No projections returned.</p>'}
      </section>

      <section class="card">
        <div class="sectionhead"><h2>League snapshot</h2><span class="pill">${teams.length} TEAMS</span></div>
        <p class="muted">Roster projection rank is a simple live comparison of aggregate Fantrax player projections. It is context, not a championship probability model.</p>
        ${ranked.slice(0,5).map((x,i)=>`<div class="team-row"><strong>${i+1}. ${esc(x.name||'Team')}</strong><span class="muted">${one(x.total)} projected</span></div>`).join('')}
      </section>

      <section class="card"><p class="muted">Last Fantrax sync: ${d.syncedAt?esc(new Date(d.syncedAt).toLocaleString()):'unknown'} · League: ${esc(d.leagueName||'Pride Dynasty')}</p></section>`;
  }

  async function hydrate(force=false){
    if(!isWarRoom())return;
    try{renderDashboard(await data(force));}
    catch(e){console.warn('War Room live dashboard unavailable',e);}
  }

  function schedule(){clearTimeout(timer);timer=setTimeout(()=>hydrate(false),80);}
  const observer=new MutationObserver(schedule);
  window.addEventListener('DOMContentLoaded',()=>{
    const main=document.getElementById('main');
    if(main)observer.observe(main,{childList:true,subtree:false});
    document.querySelector('#nav button[data-view="now"]')?.addEventListener('click',()=>setTimeout(()=>hydrate(false),50));
    document.getElementById('syncBtn')?.addEventListener('click',()=>{cache=null;setTimeout(()=>hydrate(true),1200);});
    hydrate(true);
    setInterval(()=>{cache=null;hydrate(true);},60000);
  });
})();
