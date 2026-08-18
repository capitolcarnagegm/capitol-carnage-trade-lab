import baseWorker from "./worker-live-news.js";

const TEAM_IDS={ATL:1,BUF:2,CHI:3,CIN:4,CLE:5,DAL:6,DEN:7,DET:8,GB:9,TEN:10,IND:11,KC:12,LV:13,LAR:14,MIA:15,MIN:16,NE:17,NO:18,NYG:19,NYJ:20,PHI:21,ARI:22,PIT:23,LAC:24,SF:25,SEA:26,TB:27,WAS:28,WSH:28,CAR:29,JAX:30,BAL:33,HOU:34};
const YEAR=()=>new Date().getUTCFullYear();
const DEPTH_URL=id=>`https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${YEAR()}/teams/${id}/depthcharts`;
const ROSTER_URL=id=>`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`;

function cors(){return{"Access-Control-Allow-Origin":"https://gmslocker.com","Access-Control-Allow-Methods":"GET, POST, DELETE, OPTIONS","Access-Control-Allow-Headers":"Accept, Content-Type, Authorization","Cache-Control":"no-store",Vary:"Origin"};}
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8",...cors()}});}
function clean(value){return String(value||"").replace(/\s+/g," ").trim();}
function teamCode(value){return clean(value).toUpperCase().replace(/[^A-Z]/g,"").replace(/^WSH$/,"WAS").slice(0,4);}
function athleteId(value){const text=String(value||"");return text.match(/\/athletes\/(\d+)/)?.[1]||text.match(/^(\d+)$/)?.[1]||null;}
function athleteName(row){return clean(row?.athlete?.displayName||row?.athlete?.fullName||row?.displayName||row?.fullName||row?.name||row?.player?.displayName||row?.player?.fullName);}
function slotBase(key,position){
  const raw=clean(key||position?.abbreviation||position?.name).toUpperCase().replace(/[^A-Z0-9]/g,"");
  const aliases={LEFTWIDERECEIVER:"LWR",RIGHTWIDERECEIVER:"RWR",SLOTWIDERECEIVER:"SWR",SLOTRECEIVER:"SWR",LEFTCORNERBACK:"LCB",RIGHTCORNERBACK:"RCB",NICKELCORNERBACK:"NCB",NICKELBACK:"NCB",FREESAFETY:"FS",STRONGSAFETY:"SS",MIDDLELINEBACKER:"MIKE",WEAKSIDELINEBACKER:"WILL",STRONGSIDELINEBACKER:"SAM",LEFTDEFENSIVEEND:"LDE",RIGHTDEFENSIVEEND:"RDE",NOSETACKLE:"NT"};
  if(aliases[raw])return aliases[raw];
  if(/^(LWR|RWR|SWR|XWR|ZWR|LCB|RCB|NCB|SCB|FS|SS|MIKE|WILL|SAM|LOLB|ROLB|LDE|RDE|NT|DT|RB|QB|TE|FB|WR|CB|LB|DE|KR|PR|LS|P|K)$/.test(raw))return raw;
  return raw.slice(0,10)||"DEPTH";
}
function collectRosterNames(node,map){
  if(!node)return;
  if(Array.isArray(node)){node.forEach(item=>collectRosterNames(item,map));return;}
  if(typeof node!=="object")return;
  const id=String(node.id||node.athlete?.id||"");
  const name=athleteName(node)||athleteName(node.athlete);
  if(id&&name)map.set(id,name);
  Object.values(node).forEach(value=>collectRosterNames(value,map));
}
function parseDepth(depth,team,nameMap){
  const rows=[],seen=new Set();
  for(const chart of depth?.items||[]){
    const formation=clean(chart?.name)||null;
    for(const [key,group] of Object.entries(chart?.positions||{})){
      const base=slotBase(key,group?.position),generic=/^(WR|CB|LB|DB|DL|DE|DT)$/.test(base);
      const athletes=Array.isArray(group?.athletes)?group.athletes:Array.isArray(group?.players)?group.players:[];
      athletes.forEach((row,index)=>{
        const ref=row?.athlete?.$ref||row?.$ref||row?.athlete?.ref||"";
        const id=String(row?.athlete?.id||row?.id||athleteId(ref)||"");
        const name=athleteName(row)||athleteName(row?.athlete)||nameMap.get(id)||"";
        if(!name)return;
        const rank=Number(row?.rank??row?.depth??row?.order) || index+1;
        const slot=`${base}${rank}`;
        const unique=`${team}|${name.toLowerCase()}|${slot}`;
        if(seen.has(unique))return;seen.add(unique);
        rows.push({name,athleteId:id||null,team,slot,baseSlot:base,depth:rank,providerPosition:clean(group?.position?.name||group?.position?.displayName||key)||null,providerGeneric:generic,formation});
      });
    }
  }
  return rows;
}
async function fetchJson(url){const response=await fetch(url,{headers:{Accept:"application/json","User-Agent":"GMSLocker/2.5"},cf:{cacheTtl:120,cacheEverything:true}});if(!response.ok)throw new Error(`HTTP ${response.status}`);return response.json();}
async function oneTeam(team){
  const id=TEAM_IDS[team];if(!id)return{team,rows:[],error:"Unknown ESPN team mapping"};
  try{
    const [depth,roster]=await Promise.all([fetchJson(DEPTH_URL(id)),fetchJson(ROSTER_URL(id))]);
    const names=new Map();collectRosterNames(roster,names);
    return{team,rows:parseDepth(depth,team,names),error:null};
  }catch(error){return{team,rows:[],error:String(error?.message||error)};}
}
async function depthCharts(url){
  const teams=[...new Set(String(url.searchParams.get("teams")||"").split(",").map(teamCode).filter(Boolean))].slice(0,20);
  if(!teams.length)return json({teams:{},players:[],source:"ESPN NFL depth charts",syncedAt:new Date().toISOString(),warning:"No NFL teams requested"});
  const results=await Promise.all(teams.map(oneTeam)),byTeam={},players=[],errors=[];
  for(const result of results){byTeam[result.team]=result.rows;players.push(...result.rows);if(result.error)errors.push(`${result.team}: ${result.error}`);}
  return json({teams:byTeam,players,source:"ESPN NFL depth charts",syncedAt:new Date().toISOString(),season:YEAR(),errors,method:"GMS Locker preserves provider-specific depth slots such as LWR/RWR/SWR and LCB/RCB/NCB. If ESPN supplies only a generic slot, GMS Locker labels it generic rather than inventing alignment."});
}

export default{
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/depth-charts")return depthCharts(url);
    return baseWorker.fetch(request,env,ctx);
  }
};
