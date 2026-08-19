import base from './worker-public.js';

const LEAGUE_ID='astbqxhwmk4b6bg9';
const FANTRAX='https://www.fantrax.com/fxea/general/getTeamRosters';

function headers(){return {Accept:'application/json, text/plain, */*','Accept-Language':'en-US,en;q=0.9','User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',Referer:'https://www.fantrax.com/'};}
function n(v){if(v==null||v==='')return null;const x=Number(String(v).replace(/[^0-9.\-]/g,''));return Number.isFinite(x)?x:null;}
function norm(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'');}
function walk(value,path='',out=[]){
  if(value==null)return out;
  if(Array.isArray(value)){value.forEach((v,i)=>walk(v,`${path}[${i}]`,out));return out;}
  if(typeof value==='object'){
    for(const [k,v] of Object.entries(value)){
      const p=path?`${path}.${k}`:k;
      if(v!=null&&typeof v!=='object')out.push({path:p,key:k,value:v});
      walk(v,p,out);
    }
  }
  return out;
}
function pickByKeys(row,keys){
  const wanted=new Set(keys.map(norm));
  for(const item of walk(row)){
    if(wanted.has(norm(item.key))){const x=n(item.value);if(x!=null)return {value:x,source:item.path};}
  }
  return null;
}
function pickByLabel(row,labels){
  const labelTokens=labels.map(norm),objects=[];
  (function collect(v,path=''){
    if(!v||typeof v!=='object')return;
    if(Array.isArray(v)){v.forEach((x,i)=>collect(x,`${path}[${i}]`));return;}
    objects.push({v,path});for(const [k,x] of Object.entries(v))if(x&&typeof x==='object')collect(x,path?`${path}.${k}`:k);
  })(row);
  for(const {v,path} of objects){
    const label=v.label??v.name??v.title??v.text??v.description??v.displayName;
    if(label==null)continue;
    const l=norm(label);
    if(!labelTokens.some(t=>l.includes(t)))continue;
    for(const key of ['value','amount','salary','cap','total','remaining','displayValue']){const x=n(v[key]);if(x!=null)return {value:x,source:`${path}.${key}`,label:String(label)};}
  }
  return null;
}
function explicitDeadCap(row){
  return pickByKeys(row,['deadCap','dead_cap','deadMoney','dead_money','deadSalary','dead_salary','salaryPenalty','salary_penalty','capPenalty','cap_penalty','deadCapAmount','deadMoneyAmount','penaltySalary','contractPenalty'])
    ||pickByLabel(row,['dead cap','dead money','salary penalty','cap penalty'])
    ||{value:0,source:'not_returned'};
}
function actualRemainingCap(row){
  return pickByKeys(row,['remainingCap','remaining_cap','capRoom','cap_room','salaryCapRoom','salary_cap_room','availableCap','available_cap','availableSalary','available_salary','salaryRemaining','salary_remaining','remainingSalary','remaining_salary'])
    ||pickByLabel(row,['remaining cap','cap room','remaining salary','available salary','salary remaining']);
}
function actualCapCeiling(row){
  return pickByKeys(row,['salaryCap','salary_cap','capCeiling','cap_ceiling','teamSalaryCap','team_salary_cap'])
    ||pickByLabel(row,['salary cap','cap ceiling']);
}
function actualCommitted(row){
  return pickByKeys(row,['committedSalary','committed_salary','salaryUsed','salary_used','usedSalary','used_salary','totalSalary','total_salary','salaryCommitted','salary_committed'])
    ||pickByLabel(row,['committed salary','salary used','used salary','total salary']);
}
async function rawTeamFinancials(){
  try{
    const u=new URL(FANTRAX);u.searchParams.set('leagueId',LEAGUE_ID);
    const r=await fetch(u.toString(),{headers:headers(),cf:{cacheTtl:30,cacheEverything:true}});
    if(!r.ok)throw new Error(`Fantrax team financials HTTP ${r.status}`);
    const d=await r.json(),out={};
    for(const [id,row] of Object.entries(d?.rosters||{})){
      out[id]={dead:explicitDeadCap(row||{}),remaining:actualRemainingCap(row||{}),ceiling:actualCapCeiling(row||{}),committed:actualCommitted(row||{})};
    }
    return out;
  }catch(e){return {_error:String(e?.message||e)};}
}
function corsFrom(response){const h=new Headers(response.headers);h.set('Cache-Control','no-store');return h;}
async function enrichPride(request,env,ctx){
  const [baseResponse,financials]=await Promise.all([base.fetch(request,env,ctx),rawTeamFinancials()]);
  let data;try{data=await baseResponse.clone().json();}catch{return baseResponse;}
  if(!data?.teams)return baseResponse;
  data.teams=data.teams.map(t=>{
    const f=financials[t.id]||{};
    const deadCap=n(f.dead?.value)||0;
    const rosterCalculated=(t.players||[]).reduce((s,p)=>s+(n(p.salary)||0),0);
    const actualCommittedSalary=n(f.committed?.value);
    const actualSalaryCap=n(f.ceiling?.value)??n(t.salaryCap);
    const actualRemaining=n(f.remaining?.value);
    const calculatedRemaining=actualSalaryCap==null?null:actualSalaryCap-(actualCommittedSalary??rosterCalculated)-deadCap;
    return {...t,
      salaryCap:actualSalaryCap,
      salaryCapSource:f.ceiling?.source||'base_roster_payload',
      committedSalary:actualCommittedSalary??rosterCalculated,
      committedSalarySource:f.committed?.source||(actualCommittedSalary==null?'roster_salary_sum':null),
      deadCap,deadCapSource:f.dead?.source||'not_returned',
      remainingCap:actualRemaining,
      remainingCapSource:f.remaining?.source||'not_returned',
      calculatedRemainingCap:calculatedRemaining,
      capIsAuthoritative:actualRemaining!=null
    };
  });
  data.deadCapAware=true;
  data.fantraxFinancialSummaryAware=true;
  data.financialSourceError=financials._error||null;
  return new Response(JSON.stringify(data),{status:baseResponse.status,headers:corsFrom(baseResponse)});
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname==='/public/pride-league')return enrichPride(request,env,ctx);
    return base.fetch(request,env,ctx);
  }
};
