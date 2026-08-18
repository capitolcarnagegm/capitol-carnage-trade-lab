const PREMIUM_VERSION="4.0.0";
let commandOpen=false;
let focusMode=false;

function text(root,selector,fallback="—"){const el=root.querySelector(selector);return el?.textContent?.trim()||fallback;}
function findCard(title){return [...document.querySelectorAll("main .card")].find(card=>card.querySelector("h2,h3")?.textContent?.trim()===title)||null;}
function activeView(){return document.querySelector("#nav button.active")?.dataset.view||"";}
function safe(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

function pulseData(){
  const teamCard=document.querySelector("main .card .pillar-grid")?.closest(".card");
  const grade=teamCard?text(teamCard,".metric b","—"):"—";
  const capMetric=teamCard?[...teamCard.querySelectorAll(".metric")].find(m=>/Cap Health/i.test(m.textContent)):null;
  const capRoom=capMetric?.querySelector("small")?.textContent?.split(" room")?.[0]?.trim()||"—";
  const rec=document.querySelector(".recommendation");
  const recTitle=rec?.querySelector("b")?.textContent?.trim()||"No move clears threshold";
  const recMeta=rec?.querySelector("small")?.textContent?.trim()||"Hold flexibility until live evidence improves.";
  const injuryCard=[...document.querySelectorAll("main .card")].find(card=>/Player Buzz/i.test(card.textContent||""));
  const injuryCount=injuryCard?[...injuryCard.querySelectorAll(".gate")].filter(g=>/injur|out|pup|ir|question|doubt/i.test(g.textContent||"")).length:0;
  const asof=document.getElementById("asof")?.textContent?.trim()||"Not synced";
  return{grade,capRoom,recTitle,recMeta,injuryCount,asof};
}

function injectPulse(){
  if(activeView()!=="now"||document.querySelector(".warroom-pulse")||!document.querySelector("main .card"))return;
  const d=pulseData();
  const pulse=document.createElement("section");
  pulse.className="card warroom-pulse";
  pulse.innerHTML=`<div class="pulse-top"><div><span class="pulse-kicker">GMS LOCKER · DECISION ENGINE</span><h1 class="pulse-title">Your franchise, distilled to the next move.</h1><div class="pulse-sub">Live Fantrax inputs, roster-specific replacement logic, cap consequences, and a B+ minimum decision standard. No generic rankings.</div></div><div class="pulse-status"><span class="live-chip">Live league</span><strong>${safe(d.grade)}</strong><small>current franchise grade</small></div></div><div class="pulse-grid"><div class="pulse-cell"><span>Best move now</span><b>${safe(d.recTitle)}</b><small>${safe(d.recMeta)}</small></div><div class="pulse-cell"><span>Known cap room</span><b>${safe(d.capRoom)}</b><small>Live rules-aware room, not a generic budget.</small></div><div class="pulse-cell"><span>Roster alerts</span><b>${d.injuryCount}</b><small>Current injury / availability signals matched to your roster.</small></div><div class="pulse-cell"><span>Freshness</span><b>${safe(d.asof)}</b><small>Refresh before every consequential move.</small></div></div>`;
  const main=document.getElementById("main");
  main.insertBefore(pulse,main.firstElementChild);
}

function enhanceRecommendations(){
  document.querySelectorAll(".recommendation:not([data-premium])").forEach((rec,index)=>{
    rec.dataset.premium="true";
    const title=rec.querySelector("b")?.textContent?.trim()||`recommendation ${index+1}`;
    const actions=document.createElement("div");
    actions.className="premium-reco-actions";
    actions.innerHTML=`<button type="button" data-explain>Ask GM Chat why</button><button type="button" data-copy>Copy decision</button>`;
    const body=rec.querySelector("div");
    body?.appendChild(actions);
    actions.querySelector("[data-explain]")?.addEventListener("click",()=>{
      window.GMS?.show?.("chat");
      setTimeout(()=>{const box=document.getElementById("chatInput");if(box){box.value=`Break down this recommendation with the 4-question value test and tell me exactly who it replaces on my roster: ${title}`;box.focus();}},80);
    });
    actions.querySelector("[data-copy]")?.addEventListener("click",async()=>{
      const payload=rec.innerText.replace(/Ask GM Chat why|Copy decision/g,"").trim();
      try{await navigator.clipboard.writeText(payload);actions.querySelector("[data-copy]").textContent="Copied";setTimeout(()=>actions.querySelector("[data-copy]").textContent="Copy decision",1200);}catch{}
    });
  });
}

function commands(){return[
  {label:"War Room",desc:"What matters right now",view:"now",key:"1",icon:"W"},
  {label:"My Team",desc:"Roster, cap, franchise grade",view:"team",key:"2",icon:"T"},
  {label:"Lineup",desc:"Best legal lineup and bench logic",view:"lineup",key:"3",icon:"L"},
  {label:"Trade Lab",desc:"Build and stress-test deals",view:"trade",key:"4",icon:"↔"},
  {label:"Waiver Edge",desc:"Roster-specific adds only",view:"waivers",key:"5",icon:"+"},
  {label:"GM Chat",desc:"Ask against live league context",view:"chat",key:"6",icon:"G"},
  {label:"Power Rankings",desc:"League-wide competitive map",view:"rankings",key:"7",icon:"#"},
  {label:"League Buzz",desc:"News matched to league rosters",view:"buzz",key:"8",icon:"!"},
  {label:"Refresh live league",desc:"Pull a fresh Fantrax snapshot",action:"sync",key:"R",icon:"↻"},
  {label:"Toggle decision focus",desc:"Hide secondary evidence and scan faster",action:"focus",key:"F",icon:"◎"}
];}

function closeCommand(){document.querySelector(".command-overlay")?.remove();commandOpen=false;}
function runCommand(cmd){closeCommand();if(cmd.view)window.GMS?.show?.(cmd.view);if(cmd.action==="sync")window.GMS?.sync?.();if(cmd.action==="focus"){focusMode=!focusMode;document.body.classList.toggle("focus-mode",focusMode);}}
function openCommand(){
  if(commandOpen)return;commandOpen=true;
  const overlay=document.createElement("div");overlay.className="command-overlay";
  overlay.innerHTML=`<div class="command-panel"><div class="command-search"><input autofocus placeholder="Jump anywhere, run an action…" aria-label="Command search"></div><div class="command-list"></div></div>`;
  document.body.appendChild(overlay);
  const input=overlay.querySelector("input"),list=overlay.querySelector(".command-list");
  const render=()=>{const q=input.value.trim().toLowerCase();const rows=commands().filter(c=>!q||`${c.label} ${c.desc}`.toLowerCase().includes(q));list.innerHTML=rows.map((c,i)=>`<div class="command-item ${i===0?"active":""}" data-i="${commands().indexOf(c)}"><span class="command-icon">${safe(c.icon)}</span><span><b>${safe(c.label)}</b><br><small>${safe(c.desc)}</small></span><span class="command-key">${safe(c.key)}</span></div>`).join("");list.querySelectorAll(".command-item").forEach(row=>row.addEventListener("click",()=>runCommand(commands()[Number(row.dataset.i)])));};
  input.addEventListener("input",render);overlay.addEventListener("click",e=>{if(e.target===overlay)closeCommand();});render();
}

function ensureDock(){if(document.querySelector(".action-dock")||!window.GMS)return;const dock=document.createElement("div");dock.className="action-dock";dock.innerHTML=`<button type="button" data-focus>Decision focus</button><button type="button" class="dock-main" data-command title="Command center">⌘</button>`;document.body.appendChild(dock);dock.querySelector("[data-command]").addEventListener("click",openCommand);dock.querySelector("[data-focus]").addEventListener("click",()=>{focusMode=!focusMode;document.body.classList.toggle("focus-mode",focusMode);dock.querySelector("[data-focus]").textContent=focusMode?"Exit focus":"Decision focus";});}

function enhance(){injectPulse();enhanceRecommendations();ensureDock();}
const observer=new MutationObserver(()=>requestAnimationFrame(enhance));
observer.observe(document.getElementById("main"),{childList:true,subtree:true});
window.addEventListener("keydown",e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){e.preventDefault();commandOpen?closeCommand():openCommand();return;}
  if(e.key==="Escape"&&commandOpen){closeCommand();return;}
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||""))return;
  const c=commands().find(x=>x.key.toLowerCase()===e.key.toLowerCase());if(c){e.preventDefault();runCommand(c);}
});
window.addEventListener("load",enhance);
setTimeout(enhance,400);
console.info(`GMS Locker Premium UX ${PREMIUM_VERSION}`);
