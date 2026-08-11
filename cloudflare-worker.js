// GM's Locker API: Fantrax proxy and server-side Cloudflare Workers AI chat.
const ALLOWED_ENDPOINTS = new Set(["getTeamRosters","getPlayerIds","getStandings","getDraftPicks","getMatchupScores","getLeagueInfo"]);
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null,{status:204,headers:corsHeaders()});
  if (url.pathname === "/chat") return handleChat(request,env);
  return handleFantrax(request,url);
}};
async function handleFantrax(request,url) {
  if (request.method !== "GET") return json({error:"Method not allowed"},405);
  const endpoint=url.searchParams.get("endpoint")||"";
  if (!ALLOWED_ENDPOINTS.has(endpoint)) return json({error:"Unsupported Fantrax endpoint"},400);
  const upstream=new URL("https://www.fantrax.com/fxea/general/"+endpoint);
  url.searchParams.forEach((value,key)=>{if(key!=="endpoint")upstream.searchParams.append(key,value);});
  try {
    const response=await fetch(upstream.toString(),{headers:{"Accept":"application/json","User-Agent":"GMSLocker/1.1"},cf:{cacheTtl:15,cacheEverything:false}});
    const headers=corsHeaders();
    headers.set("Content-Type",response.headers.get("Content-Type")||"application/json; charset=utf-8");
    headers.set("Cache-Control","public, max-age=15");
    return new Response(await response.arrayBuffer(),{status:response.status,headers});
  } catch(error) { return json({error:"Fantrax upstream failed",detail:String(error&&error.message||error)},502); }
}
async function handleChat(request,env) {
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  if(!env.AI)return json({error:"Cloudflare Workers AI is not connected to the Worker"},503);
  let input;
  try{input=await request.json();}catch(_){return json({error:"Invalid JSON"},400);}
  const message=String(input.message||"").trim();
  if(!message)return json({error:"Message is required"},400);
  const system=["You are GM's Locker, the user's full conversational personal assistant and fantasy-football general manager partner, not a scripted demo.","Help with everyday questions, restaurants, local recommendations, travel, planning, writing, and general knowledge in addition to fantasy football.","You do not have live web or maps access. For local or time-sensitive recommendations, say when current details should be verified; if the user's location is unclear, ask for a city, ZIP code, or neighborhood.","Hold natural multi-turn conversations, answer follow-ups, and ask a useful question when it helps clarify the user's goals.","Learn stable preferences such as location, food tastes, budget, accessibility needs, strategy, risk tolerance, favorite or disliked players, roster-building philosophy, and preferred communication style from the supplied conversation and saved preferences, then apply them consistently.","For fantasy football, give specific practical dynasty and weekly-lineup advice grounded in all supplied league rosters, free agents, picks, standings, projections, current production, injuries, matchups, contracts, salary cap, and league rules.","Distinguish supplied facts from estimates and clearly state uncertainty.","Never claim you executed an external action.","Return only valid JSON with two strings: reply (the answer shown to the user) and preferences (a concise cumulative memory of stable user preferences only; preserve useful prior preferences and never invent any)."].join(" ");
  const history=Array.isArray(input.history)?input.history.slice(-60):[];
  const messages=[{role:"system",content:system}].concat(history.map(m=>({role:m.role==="ai"?"assistant":"user",content:String(m.text||"").slice(0,2500)})));
  const context={coach:input.coach||{},league:input.league||{},team:input.team||{},leagueRosters:input.leagueRosters||[],freeAgents:input.freeAgents||[],draftPicks:input.draftPicks||[],standings:input.standings||[],matchups:input.matchups||{},leagueInfo:input.leagueInfo||{},savedPreferences:String(input.preferences||"").slice(0,12000)};
  messages.push({role:"user",content:message+"\n\nCurrent league context:\n"+JSON.stringify(context).slice(0,65000)});
  try {
    const data=await env.AI.run("@cf/meta/llama-3.2-3b-instruct",{messages,temperature:0.65,max_tokens:2400});
    const raw=String(data&&data.response||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"");
    let parsed;
    try{parsed=JSON.parse(raw);}catch(_){parsed={reply:raw,preferences:String(input.preferences||"")};}
    let reply=String(parsed.reply||"").trim();
    if(!reply)return json({error:"Llama returned no answer"},502);
    return json({reply,preferences:String(parsed.preferences||input.preferences||"").slice(0,12000)});
  } catch(error) { return json({error:"Workers AI request failed",detail:String(error&&error.message||error)},502); }
}
function corsHeaders(){return new Headers({"Access-Control-Allow-Origin":"https://gmslocker.com","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Accept, Content-Type","Vary":"Origin","X-Content-Type-Options":"nosniff"});}
function json(value,status=200){const headers=corsHeaders();headers.set("Content-Type","application/json; charset=utf-8");headers.set("Cache-Control","no-store");return new Response(JSON.stringify(value),{status,headers});}
