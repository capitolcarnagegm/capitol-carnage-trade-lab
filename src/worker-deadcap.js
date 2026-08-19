import base from './worker-public.js';

const LEAGUE_ID='astbqxhwmk4b6bg9';
const FANTRAX='https://www.fantrax.com/fxea/general/getTeamRosters';

function headers(){return {Accept:'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',Referer:'https://www.fantrax.com/'};}
function n(v){if(v==null||v==='')return null;const x=Number(String(v).replace(/[^0-9.\-]/g,''));return Number.isFinite(x)?x:null;}
function explicitDeadCap(row){
  const direct=['deadCap','dead_cap','deadMoney','dead_money','deadSalary','dead_salary','salaryPenalty','salary_penalty','capPenalty','cap_penalty','capHit','cap_hit','deadCapAmount','deadMoneyAmount','penaltySalary','contractPenalty'];
  for(const k of direct){const x=n(row?.[k]);if(x!=null)return {value:x,source:k};}
  const hits=row?.capHits||row?.capPenalties||row?.salaryPenalties||row?.deadMoneyItems||row?.deadCapItems;
  if(Array.isArray(hits)){const vals=hits.map(x=>n(x?.amount??x?.salary??x?.value??x)).filter(x=>x!=null);if(vals.length)return {value:vals.reduce((a,b)=>a+b,0),source:'penalty_items'};}
  return {value:0,source:'not_returned'};
}
async function rawDeadCaps(){
  try{
    const u=new URL(FANTRAX);u.searchParams.set('leagueId',LEAGUE_ID);
    const r=await fetch(u.toString(),{headers:headers(),cf:{cacheTtl:30,cacheEverything:true}});
    if(!r.ok)throw new Error(`Fantrax dead cap HTTP ${r.status}`);
    const d=await r.json(),out={};
    for(const [id,row] of Object.entries(d?.rosters||{})){out[id]=explicitDeadCap(row||{});}
    return out;
  }catch(e){return {_error:String(e?.message||e)};}
}
function corsFrom(response){const h=new Headers(response.headers);h.set('Cache-Control','no-store');return h;}
async function enrichPride(request,env,ctx){
  const [baseResponse,dead]=await Promise.all([base.fetch(request,env,ctx),rawDeadCaps()]);
  let data;try{data=await baseResponse.clone().json();}catch{return baseResponse;}
  if(!data?.teams)return baseResponse;
  data.teams=data.teams.map(t=>{
    const d=dead[t.id]||{value:0,source:'not_returned'};
    const deadCap=n(d.value)||0;
    const committed=(t.players||[]).reduce((s,p)=>s+(n(p.salary)||0),0);
    const ceiling=n(t.salaryCap);
    return {...t,deadCap,deadCapSource:d.source,committedSalary:committed,remainingCap:ceiling==null?null:ceiling-committed-deadCap};
  });
  data.deadCapAware=true;
  data.deadCapSourceError=dead._error||null;
  return new Response(JSON.stringify(data),{status:baseResponse.status,headers:corsFrom(baseResponse)});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/public/pride-league')return enrichPride(request,env,ctx);
    return base.fetch(request,env,ctx);
  }
};
