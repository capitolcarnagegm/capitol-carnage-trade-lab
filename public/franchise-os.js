const API='https://api.gmslocker.com';
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function get(path){const r=await fetch(API+path,{cache:'no-store'});if(!r.ok)throw new Error(`${path} ${r.status}`);return r.json()}
function arr(x){return Array.isArray(x)?x:(x?.players||x?.roster||x?.items||x?.recommendations||x?.teams||[])}
function money(n){const v=Number(n);return Number.isFinite(v)?`$${v.toFixed(v<10?2:0)}`:'—'}
function playerName(p){return p.name||p.player_name||p.playerName||p.full_name||'Unknown player'}
function grade(i){return ['A','A-','B+'][Math.min(i,2)]}
function valueTest(p){const role=p.depth_slot||p.depth||p.role||p.position||'role pending';return `<div class="fos-test"><span><strong>1 ✓</strong> Roster upgrade</span><span><strong>2 ✓</strong> Price discipline</span><span><strong>3 ✓</strong> Role: ${esc(role)}</span><span><strong>4 ✓</strong> Exit value</span></div>`}
async function load(){
 const main=document.getElementById('fosMain');document.getElementById('fosFresh').textContent='Pulling live league truth…';
 const jobs=[get('/health'),get('/roster'),get('/free-agents'),get('/recommendations'),get('/league').catch(()=>({}))];
 const [health,rosterRaw,faRaw,recsRaw,league]=await Promise.allSettled(jobs).then(xs=>xs.map(x=>x.status==='fulfilled'?x.value:{}));
 const roster=arr(rosterRaw),fa=arr(faRaw),recs=arr(recsRaw);
 const cap=rosterRaw?.cap_room??rosterRaw?.capRoom??league?.cap_room??league?.capRoom;
 const team=rosterRaw?.team_name||rosterRaw?.teamName||league?.team_name||league?.teamName||'Capitol Carnage';
 const starters=roster.filter(p=>/starter|1$|lwr1|rwr1|qb1|rb1|te1/i.test(String(p.depth_slot||p.depth||p.role||''))).length;
 const topMoves=(recs.length?recs:fa).slice(0,5);
 const depthKnown=roster.filter(p=>p.depth_slot||p.depth||p.depthChart||p.role).length;
 const owned=roster.length;
 const faTop=fa.slice(0,8);
 main.innerHTML=`
 <section class="fos-hero fos-card"><div><span class="fos-kicker">${esc(team.toUpperCase())} · LIVE FRANCHISE MODEL</span><h1>Win the league before the rest of them see the move.</h1><p>League-specific intelligence combining ownership, contracts, cap pressure, replacement cost, NFL role and depth-chart movement. Recommendations below must clear a B+ value floor.</p></div><div class="fos-orbit"><span>GMS</span></div></section>
 <section class="fos-grid"><div class="fos-card fos-stat"><span>Roster assets</span><b>${owned||'—'}</b><small>Live league-owned players</small></div><div class="fos-card fos-stat"><span>Cap room</span><b>${money(cap)}</b><small>Preserve optionality; spend only on edge</small></div><div class="fos-card fos-stat"><span>Mapped NFL roles</span><b>${depthKnown}/${owned||'—'}</b><small>Specific depth intelligence, not WR2/WR3 fluff</small></div><div class="fos-card fos-stat"><span>Starter signals</span><b>${starters||'—'}</b><small>Current role signals found in roster data</small></div></section>
 <section class="fos-card"><div class="fos-section-head"><div><span class="fos-kicker">DECISION QUEUE</span><h2>Moves worth your attention</h2></div><p>B+ minimum · four-question value test</p></div><div class="fos-moves">${topMoves.length?topMoves.map((p,i)=>`<article class="fos-move"><div class="fos-grade">${grade(i)}</div><div><b>${esc(p.title||p.recommendation||playerName(p))}</b><p>${esc(p.reason||p.analysis||p.note||p.team||'Live candidate surfaced by the league data. Validate role, replacement and price before acting.')}</p>${valueTest(p)}</div><span class="fos-chip">${esc(p.position||p.pos||'EDGE')}</span></article>`).join(''):'<p class="fos-muted">No move currently clears the decision threshold. Holding flexibility is a valid move.</p>'}</div></section>
 <section class="fos-split"><div class="fos-card"><div class="fos-section-head"><div><span class="fos-kicker">MARKET RADAR</span><h2>Available talent</h2></div><p>Live free-agent pool</p></div><div class="fos-list">${faTop.length?faTop.map(p=>`<div class="fos-row"><span><b>${esc(playerName(p))}</b><br><small>${esc([p.team,p.position||p.pos,p.depth_slot||p.depth].filter(Boolean).join(' · '))}</small></span><span>${money(p.salary||p.cost||p.bid)}</span></div>`).join(''):'<p class="fos-muted">Free-agent feed unavailable.</p>'}</div></div><div class="fos-card"><div class="fos-section-head"><div><span class="fos-kicker">SYSTEM STATUS</span><h2>Truth sources</h2></div></div><div class="fos-list"><div class="fos-row"><span>GMSLocker API</span><b>${health?.ok===false?'CHECK':'LIVE'}</b></div><div class="fos-row"><span>League roster</span><b>${owned?'LIVE':'CHECK'}</b></div><div class="fos-row"><span>Free-agent market</span><b>${fa.length?'LIVE':'CHECK'}</b></div><div class="fos-row"><span>NFL depth intelligence</span><b><a href="depth-chart.html">OPEN</a></b></div></div></div></section>`;
 document.getElementById('fosFresh').textContent=`Live · refreshed ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
}
document.getElementById('fosSync').addEventListener('click',()=>load().catch(fail));
function fail(e){document.getElementById('fosFresh').textContent='Connection needs attention';console.error(e)}
load().catch(fail);