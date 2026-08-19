(()=>{
const API='https://api.gmslocker.com';
const TREND_KEY='gms_projection_snapshot_v1';
let league=null, busy=false, tradePartner=null, giveMine=new Set(), giveTheirs=new Set();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":'&#39;'}[c]));
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null};
const money=v=>{const x=n(v);return x==null?'—':'$'+(Math.round(x*100)/100).toLocaleString()};
const fmt=v=>{const x=n(v);return x==null?'—':(Math.round(x*10)/10).toFixed(1