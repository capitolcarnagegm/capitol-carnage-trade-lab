// GM's Locker API: Fantrax proxy and server-side Gemini chat.
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
  if(!env.GEMINI_API_KEY)return json({error:"Gemini API key is not configured on the Worker"},503);
  let input;
  try{input=await request.json();}catch(_){return json({error:"Invalid JSON"},400);}
  const message=String(input.message||"").trim();
  if(!message)return json({error:"Message is required"},400);
  const system=["You are GM's Locker, a candid fantasy-football general manager assistant.","Learn the user's preferences from the supplied conversation and coach settings, and apply them consistently.","Give specific practical dynasty advice grounded in the supplied roster, contracts, salary cap, and league rules.","Never claim you executed a Fantrax action. Keep answers concise unless asked for detail.","If data is missing or uncertain, say so clearly."].join(" ");
  const history=Array.isArray(input.history)?input.history.slice(-30):[];
  const contents=history.map(m=>({role:m.role==="ai"?"model":"user",parts:[{text:String(m.text||"").slice(0,5000)}]}));
  contents.push({role:"user",parts:[{text:message+"\n\nCurrent GM context:\n"+JSON.stringify({coach:input.coach||{},league:input.league||{},team:input.team||{}}).slice(0,50000)}]});
  try {
    const api="https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key="+encodeURIComponent(env.GEMINI_API_KEY);
    const response=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{temperature:0.55,maxOutputTokens:1200}})});
    const data=await response.json();
    if(!response.ok)return json({error:"Gemini request failed",detail:data.error&&data.error.message},502);
    const parts=data.candidates&&data.candidates[0]&&data.candidates[0].content&&data.candidates[0].content.parts;
    const reply=parts&&parts.map(p=>p.text||"").join("").trim();
    if(!reply)return json({error:"Gemini returned no answer"},502);
    return json({reply});
  } catch(error) { return json({error:"Gemini request failed",detail:String(error&&error.message||error)},502); }
}
function corsHeaders(){return new Headers({"Access-Control-Allow-Origin":"https://gmslocker.com","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Accept, Content-Type","Vary":"Origin","X-Content-Type-Options":"nosniff"});}
function json(value,status=200){const headers=corsHeaders();headers.set("Content-Type","application/json; charset=utf-8");headers.set("Cache-Control","no-store");return new Response(JSON.stringify(value),{status,headers});}
