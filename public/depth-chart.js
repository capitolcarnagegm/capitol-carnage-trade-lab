const DEPTH_API="https://api.gmslocker.com";
const DEPTH_CACHE_KEY="gms_depth_history_v1";
let depthBusy=false;
let lastSignature="";

const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
function activeView(){return document.querySelector("#nav button.active")?.dataset.view||"";}
function rosterCard(){return [...document.querySelectorAll("main .card")].find(card=>card.querySelector("h3")?.textContent?.trim()==="Roster")||null;}
function playerRows(){
  const card=rosterCard();if(!card)return[];
  return [...card.querySelectorAll(".gate")].map(row=>{
    const b=row.querySelector("b"),muted=row.querySelector(".muted");
    const name=[...(b?.childNodes||[])].find(node=>node.nodeType===Node.TEXT_NODE)?.textContent?.trim()||b?.textContent?.trim()||"";
    const meta=muted?.textContent?.trim()||"";
    const parts=meta.split("·").map(x=>x.trim()).filter(Boolean);
    const team=parts.find(part=>/^[A-Z]{2,4}$/.test(part))||"";
    const fantasyPosition=parts[0]||"";
    return{name,team,fantasyPosition,row};
  }).filter(x=>x.name&&x.team);
}
function loadHistory(){try{return JSON.parse(localStorage.getItem(DEPTH_CACHE_KEY)||"{}");}catch{return{};}}
function saveHistory(value){try{localStorage.setItem(DEPTH_CACHE_KEY,JSON.stringify(value));}catch{}}
function bestMatch(entry,players){
  const exact=players.filter(p=>p.team===entry.team&&norm(p.name)===norm(entry.name));
  if(exact.length)return exact.sort((a,b)=>(a.depth??99)-(b.depth??99))[0];
  const key=norm(entry.name),last=key.slice(-7);
  return players.filter(p=>p.team===entry.team&&(norm(p.name).endsWith(last)||key.endsWith(norm(p.name).slice(-7)))).sort((a,b)=>(a.depth??99)-(b.depth??99))[0]||null;
}
function trendFor(current,previous){
  if(!previous)return{label:"NEW",cls:"new",symbol:"◆"};
  if(current===previous)return{label:"STABLE",cls:"",symbol:"→"};
  const curRank=Number(String(current).match(/(\d+)$/)?.[1]||99),prevRank=Number(String(previous).match(/(\d+)$/)?.[1]||99);
  if(curRank<prevRank)return{label:"RISING",cls:"rising",symbol:"↑"};
  if(curRank>prevRank)return{label:"FALLING",cls:"falling",symbol:"↓"};
  return{label:"CHANGED",cls:"new",symbol:"◆"};
}
function decorateRows(rows,matches,previous){
  rows.forEach(entry=>{
    entry.row.querySelectorAll(".depth-chip").forEach(el=>el.remove());
    const match=matches.get(norm(entry.name));if(!match)return;
    const prior=previous[norm(entry.name)]?.slot||null,trend=trendFor(match.slot,prior);
    const b=entry.row.querySelector("b");if(!b)return;
    const chip=document.createElement("span");chip.className=`depth-chip ${trend.cls}`.trim();
    chip.title=`NFL depth: ${match.slot}. Fantasy eligibility remains ${entry.fantasyPosition||"league-defined"}. ${match.providerGeneric?"Provider returned a generic alignment; GMS Locker did not invent left/right/slot.":"Provider-specific alignment preserved."}`;
    chip.textContent=`${match.slot} ${trend.symbol}`;b.appendChild(chip);
  });
}
function depthBoard(rows,matches,payload,previous){
  document.querySelector(".depth-intel-card")?.remove();
  const card=rosterCard();if(!card)return;
  const matched=rows.map(entry=>({entry,match:matches.get(norm(entry.name))})).filter(x=>x.match);
  const movers=matched.map(x=>{const prior=previous[norm(x.entry.name)]?.slot||null;return{...x,prior,trend:trendFor(x.match.slot,prior)};}).filter(x=>x.prior&&x.prior!==x.match.slot);
  const panel=document.createElement("section");panel.className="card depth-intel-card";
  panel.innerHTML=`<div class="sectionhead"><div><h2>Live NFL Depth Map</h2><span class="muted">Specific alignment — not generic WR1/DB1 labels</span></div><span class="pill depth-status">LIVE DEPTH</span></div><p class="muted">Fantasy eligibility stays league-specific. NFL role preserves the source alignment: LWR/RWR/SWR, LCB/RCB/NCB, MIKE/WILL/SAM, LDE/RDE/NT and other specific slots when the provider supplies them.</p>${movers.length?`<div class="depth-movers">${movers.slice(0,6).map(x=>`<div class="depth-mover"><strong class="${x.trend.cls==="rising"?"depth-rise":x.trend.cls==="falling"?"depth-fall":"depth-new"}">${safe(x.trend.symbol)} ${safe(x.entry.name)}</strong><small>${safe(x.prior)} → <b>${safe(x.match.slot)}</b></small></div>`).join("")}</div>`:""}<div class="depth-board">${matched.map(({entry,match})=>`<div class="depth-entry"><div><b>${safe(entry.name)}</b><small>Fantasy: ${safe(entry.fantasyPosition||"league-defined")} · NFL ${safe(match.team)}${match.providerGeneric?" · generic source slot":" · specific source slot"}</small></div><span class="depth-code">${safe(match.slot)}</span></div>`).join("")||'<p class="muted">No roster players matched the current depth-chart response.</p>'}</div><div class="depth-source">${safe(payload.source||"Depth source unavailable")} · ${payload.syncedAt?`updated ${safe(new Date(payload.syncedAt).toLocaleTimeString())}`:"freshness unavailable"}. GMS Locker never fabricates L/R/slot alignment when the source is generic.</div>`;
  card.parentNode.insertBefore(panel,card);
}
async function refreshDepth(){
  if(depthBusy||activeView()!=="team")return;
  const rows=playerRows();if(!rows.length)return;
  const teams=[...new Set(rows.map(x=>x.team))].sort();
  const signature=rows.map(x=>`${norm(x.name)}:${x.team}`).sort().join("|");
  if(signature===lastSignature&&document.querySelector(".depth-intel-card"))return;
  lastSignature=signature;depthBusy=true;
  try{
    const res=await fetch(`${DEPTH_API}/depth-charts?teams=${encodeURIComponent(teams.join(","))}`,{headers:{Accept:"application/json"},cache:"no-store"});
    if(!res.ok)throw new Error(`Depth chart HTTP ${res.status}`);
    const payload=await res.json(),players=payload.players||[],matches=new Map();
    rows.forEach(entry=>{const match=bestMatch(entry,players);if(match)matches.set(norm(entry.name),match);});
    const history=loadHistory(),workspace=localStorage.getItem("gms_active_workspace_v1")||"default",previous=history[workspace]||{};
    decorateRows(rows,matches,previous);depthBoard(rows,matches,payload,previous);
    const current={...previous};matches.forEach((match,key)=>{current[key]={slot:match.slot,team:match.team,seenAt:payload.syncedAt||new Date().toISOString()};});history[workspace]=current;saveHistory(history);
  }catch(error){
    const card=rosterCard();if(card&&!document.querySelector(".depth-intel-card")){const panel=document.createElement("section");panel.className="card depth-intel-card";panel.innerHTML=`<h2>Live NFL Depth Map</h2><p class="muted">Depth data could not be refreshed: ${safe(error.message||error)}. Fantrax roster data remains unaffected.</p>`;card.parentNode.insertBefore(panel,card);}
  }finally{depthBusy=false;}
}
const observer=new MutationObserver(()=>requestAnimationFrame(refreshDepth));
observer.observe(document.getElementById("main"),{childList:true,subtree:true});
window.addEventListener("load",refreshDepth);
setInterval(()=>{if(activeView()==="team"){lastSignature="";refreshDepth();}},120000);
