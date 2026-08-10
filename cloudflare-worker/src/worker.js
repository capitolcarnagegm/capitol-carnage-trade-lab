const ALLOWED_ORIGINS = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com",
  "https://capitolcarnagegm.github.io"
]);

const MFL_HOST = "www45.myfantasyleague.com";
const SEASON = "2026";
const LEAGUE_ID = "29218";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Cache-Control": "no-store"
  };
}

function json(data,status=200,origin="") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"Content-Type":"application/json; charset=utf-8", ...cors(origin)}
  });
}

async function getMFL(type, extra={}) {
  const url=new URL(`https://${MFL_HOST}/${SEASON}/export`);
  url.searchParams.set("TYPE",type);
  url.searchParams.set("L",LEAGUE_ID);
  url.searchParams.set("JSON","1");
  for(const [k,v] of Object.entries(extra)) if(v!==undefined&&v!==null&&v!=="") url.searchParams.set(k,String(v));

  const r=await fetch(url.toString(),{
    headers:{"Accept":"application/json,text/plain,*/*","User-Agent":"GMs-Locker/3.0"},
    cf:{cacheTtl:0,cacheEverything:false}
  });
  const text=await r.text();
  if(!r.ok) throw new Error(`${type}: MFL HTTP ${r.status}`);
  try{return JSON.parse(text)}
  catch{throw new Error(`${type}: MFL response was not JSON (${text.slice(0,100).replace(/\s+/g," ")})`)}
}

async function optionalMFL(type,extra={}) {
  try{return {value:await getMFL(type,extra),error:null}}
  catch(e){return {value:{},error:String(e?.message||e)}}
}

async function buildSyncPayload() {
  const [league,players,rosters]=await Promise.all([
    getMFL("league"),getMFL("players"),getMFL("rosters")
  ]);

  const [standings,transactions,draftResults,futureDraftPicks,schedule]=await Promise.all([
    optionalMFL("leagueStandings"),
    optionalMFL("transactions",{COUNT:1000}),
    optionalMFL("draftResults"),
    optionalMFL("futureDraftPicks"),
    optionalMFL("schedule")
  ]);

  const errors={};
  if(standings.error)errors.standings=standings.error;
  if(transactions.error)errors.transactions=transactions.error;
  if(draftResults.error)errors.draftResults=draftResults.error;
  if(futureDraftPicks.error)errors.futureDraftPicks=futureDraftPicks.error;
  if(schedule.error)errors.schedule=schedule.error;

  return {
    ok:true,
    syncedAt:new Date().toISOString(),
    season:SEASON,
    leagueId:LEAGUE_ID,
    upstream:MFL_HOST,
    data:{
      league,
      players,
      rosters,
      standings:standings.value,
      transactions:transactions.value,
      draftResults:draftResults.value,
      futureDraftPicks:futureDraftPicks.value,
      schedule:schedule.value
    },
    errors
  };
}

async function parseOneImage(env,file,prompt){
  if(!env?.AI)throw new Error("Workers AI binding is not configured.");
  if(!file||typeof file==="string")throw new Error("No image uploaded.");
  if(file.size>8*1024*1024)throw new Error("Each image must be under 8 MB.");
  const image=[...new Uint8Array(await file.arrayBuffer())];
  const result=await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct",{image,prompt});
  const text=result?.response||"";
  const match=text.match(/\{[\s\S]*\}/);
  if(!match)throw new Error("Vision model could not return structured JSON.");
  return JSON.parse(match[0]);
}

export default {
  async fetch(request,env) {
    const origin=request.headers.get("Origin")||"";
    const url=new URL(request.url);

    if(request.method==="OPTIONS"){
      if(origin&&!ALLOWED_ORIGINS.has(origin))return new Response(null,{status:403});
      return new Response(null,{status:204,headers:cors(origin)});
    }

    if(!["GET","POST"].includes(request.method))return json({ok:false,error:"Method not allowed"},405,origin);

    if(url.pathname==="/"||url.pathname==="/health"){
      return json({ok:true,service:"GM's Locker MFL Sync",season:SEASON,leagueId:LEAGUE_ID,upstream:MFL_HOST},200,origin);
    }

    if(!ALLOWED_ORIGINS.has(origin))return json({ok:false,error:"Origin not allowed"},403,origin);

    if(url.pathname==="/sync"&&request.method==="GET"){
      try{return json(await buildSyncPayload(),200,origin)}
      catch(e){return json({ok:false,error:String(e?.message||e)},500,origin)}
    }

    if(url.pathname==="/parse-trade-image"&&request.method==="POST"){
      try{
        const form=await request.formData(),file=form.get("image");
        const parsed=await parseOneImage(env,file,`Read this fantasy football trade screenshot. Return ONLY valid JSON:
{"sideA":{"team":"team name if visible","assets":["asset 1"]},"sideB":{"team":"team name if visible","assets":["asset 1"]},"confidence":0.0}
Capture player names and draft picks exactly as visible. Do not invent missing assets.`);
        return json({ok:true,trade:{sideA:parsed.sideA||{},sideB:parsed.sideB||{}},confidence:Number(parsed.confidence||.75)},200,origin);
      }catch(e){return json({ok:false,error:String(e?.message||e)},500,origin)}
    }

    if(url.pathname==="/parse-roster-images"&&request.method==="POST"){
      try{
        const form=await request.formData(),files=form.getAll("images"),teams=[];
        for(const file of files){
          const parsed=await parseOneImage(env,file,`Read this fantasy football roster screenshot. Return ONLY valid JSON:
{"team":"franchise name if visible","players":[{"name":"player name","position":"position if visible","salary":"","years":"","status":"active/taxi/IR/reserve if visible"}],"confidence":0.0}
Do not invent players, salary, years or status not visible.`);
          teams.push(parsed);
        }
        return json({ok:true,teams},200,origin);
      }catch(e){return json({ok:false,error:String(e?.message||e)},500,origin)}
    }

    if(url.pathname==="/parse-fa-images"&&request.method==="POST"){
      try{
        const form=await request.formData(),files=form.getAll("images"),players=[];
        for(const file of files){
          const parsed=await parseOneImage(env,file,`Read this fantasy football free-agent list screenshot. Return ONLY valid JSON:
{"players":[{"name":"player name","position":"position if visible","salary":"","bid":""}],"confidence":0.0}
Do not invent values not visible.`);
          if(Array.isArray(parsed.players))players.push(...parsed.players);
        }
        return json({ok:true,players},200,origin);
      }catch(e){return json({ok:false,error:String(e?.message||e)},500,origin)}
    }

    
    if(url.pathname==="/parse-transaction-images"&&request.method==="POST"){
      try{
        const form=await request.formData(),files=form.getAll("images"),transactions=[];
        for(const file of files){
          const parsed=await parseOneImage(env,file,`Read this fantasy football league transaction screenshot. Return ONLY valid JSON:
{"transactions":[{"type":"TRADE|WAIVER CLAIM|FREE AGENT SIGNING|CUT|PICK TRANSFER|ROSTER CORRECTION","teamA":"team name","teamASends":["player or pick"],"teamB":"team name","teamBSends":["player or pick"]}],"confidence":0.0}
Use exact visible team names, player names, and draft-pick descriptions. Do not invent anything not shown.`);
          if(Array.isArray(parsed.transactions))transactions.push(...parsed.transactions);
        }
        return json({ok:true,transactions},200,origin);
      }catch(e){return json({ok:false,error:String(e?.message||e)},500,origin)}
    }


    if(url.pathname==="/parse-historical-transactions"&&request.method==="POST"){
      try{
        const form=await request.formData(),files=form.getAll("images"),transactions=[];
        for(const file of files){
          const parsed=await parseOneImage(env,file,`Read this historical fantasy football transaction screenshot. Return ONLY valid JSON:
{"transactions":[{"date":"date/time exactly as visible if present","type":"TRADE|WAIVER CLAIM|FREE AGENT SIGNING|CUT|PICK TRANSFER|ROSTER CORRECTION","teamA":"team name","teamASends":["player or pick"],"teamB":"team name","teamBSends":["player or pick"],"amount":"","notes":""}],"confidence":0.0}
Preserve exact visible team names, player names, draft picks, transaction dates, and bid/price amounts. Do not invent missing values.`);
          if(Array.isArray(parsed.transactions))transactions.push(...parsed.transactions);
        }
        return json({ok:true,transactions},200,origin);
      }catch(e){return json({ok:false,error:String(e?.message||e)},500,origin)}
    }

return json({ok:false,error:"Not found"},404,origin);
  }
};
