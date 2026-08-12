/** GMS Locker analysis engine. Missing data remains null; open spots are not weaknesses. */
const PRIDE_CAP_ANCHOR = 1403.90;
const PRIDE_CAP_ANCHOR_YEAR = 2026;
const PRIDE_CAP_ANNUAL_INCREASE = 0.05;
const PRIDE_CONTRACT_ANNUAL_INCREASE = 0.20;

function prideLeagueYear(now=new Date()){
  const currentYear=now.getUTCFullYear();
  const marchOnePassed=now.getUTCMonth()>1||(now.getUTCMonth()===2&&now.getUTCDate()>=1);
  return currentYear-(marchOnePassed?0:1);
}
function prideSalaryCap(now=new Date()){
  const effectiveYear=prideLeagueYear(now);
  return Math.round(PRIDE_CAP_ANCHOR*Math.pow(1+PRIDE_CAP_ANNUAL_INCREASE,Math.max(0,effectiveYear-PRIDE_CAP_ANCHOR_YEAR))*100)/100;
}
function prideCapForLeagueYear(year){
  return Math.round(PRIDE_CAP_ANCHOR*Math.pow(1+PRIDE_CAP_ANNUAL_INCREASE,Math.max(0,Number(year)-PRIDE_CAP_ANCHOR_YEAR))*100)/100;
}
export class GMSAnalysisEngine {
  constructor(leagueRules = {}) {
    this.starters = leagueRules.starters || [
      { slot:"QB",count:1,accept:["QB"]},{slot:"SFX",count:1,accept:["QB","RB","WR","TE"]},
      { slot:"RB",count:2,accept:["RB"]},{slot:"WR",count:3,accept:["WR"]},{slot:"TE",count:1,accept:["TE"]},
      { slot:"RWT",count:1,accept:["RB","WR","TE"]},{slot:"DL",count:3,accept:["DL"]},
      { slot:"LB",count:2,accept:["LB"]},{slot:"DB",count:3,accept:["DB"]},{slot:"ID",count:2,accept:["DL","LB","DB"]}
    ];
    this.now = leagueRules.now instanceof Date?leagueRules.now:new Date();
    this.capAnnualIncrease = PRIDE_CAP_ANNUAL_INCREASE;
    this.contractAnnualIncrease = PRIDE_CONTRACT_ANNUAL_INCREASE;
    this.cap = leagueRules.capOverride ?? prideSalaryCap(this.now);
  }
  _n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
  _safeSum(arr,fn){ const v=arr.map(fn).filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0):null; }
  _completeSum(arr,fn){const v=arr.map(fn);return v.some(x=>x==null)?null:v.reduce((a,b)=>a+b,0);}
  _safeAvg(arr,fn){ const v=arr.map(fn).filter(x=>x!=null); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; }
  _pos(p){ const s=String(p.position||p.pos||"").toUpperCase(); if(s.includes("QB"))return"QB";if(s.includes("RB"))return"RB";if(s.includes("WR"))return"WR";if(s.includes("TE"))return"TE";if(/DL|DE|DT|NT|EDGE/.test(s))return"DL";if(/LB/.test(s))return"LB";if(/DB|CB|S\b|FS|SS|SAFETY/.test(s))return"DB";return s.split(/[/,]/)[0]||"?"; }
  _score(p){ const w=this._n(p.weeklyProjection??p.weekly);if(w!=null&&w>0)return w;const s=this._n(p.seasonProjection??p.season);if(s!=null&&s>0)return s/17;const q=this._n(p.performancePpg??p.ppg);return q!=null&&q>0?q:null; }
  _scoreSource(p){const w=this._n(p.weeklyProjection??p.weekly);if(w!=null&&w>0)return"weekly projection";const s=this._n(p.seasonProjection??p.season);if(s!=null&&s>0)return"season projection";const q=this._n(p.performancePpg??p.ppg);if(q!=null&&q>0)return"historical PPG";return"unavailable";}
  _unavailable(p){ return /OUT|IR|INJURED|SUSPEND/i.test(String(p.status||"")+" "+String(p.injury||"")+" "+String(p.rosterSlot||"")); }
  _taxi(p){ return /TAXI|MINOR/i.test(String(p.status||"")+" "+String(p.rosterSlot||"")); }
  _ir(p){return /(^|\b)(IR|INJURED RESERVE)(\b|$)/i.test(String(p.rosterSlot||"")+" "+String(p.status||""));}
  _capSalary(p){if(this._ir(p))return 0;return this._n(p.salary);}
  financialProjection(team,seasons=5){
    const players=team.players||[],leagueYear=prideLeagueYear(this.now),count=Math.max(1,Math.min(5,Number(seasons)||5));
    return Array.from({length:count},(_,offset)=>{
      const cap=prideCapForLeagueYear(leagueYear+offset);
      const salaries=players.map(p=>{
        const salary=this._n(p.salary),years=this._n(p.contract??p.years);
        if(salary==null||years==null)return null;
        if(years<=offset)return 0;
        if(offset===0&&this._ir(p))return 0;
        return Math.round(salary*Math.pow(1+this.contractAnnualIncrease,offset)*100)/100;
      });
      const rosterSalary=salaries.some(value=>value==null)?null:salaries.reduce((sum,value)=>sum+value,0);
      const deadCap=offset===0?this._n(team.deadCap):null;
      const used=rosterSalary==null||deadCap==null?null:rosterSalary+deadCap;
      return{leagueYear:leagueYear+offset,cap,rosterSalary,deadCap,used,room:used==null?null:cap-used,contractIncrease:this.contractAnnualIncrease,capIncrease:this.capAnnualIncrease,deadCapScope:offset===0?"current Fantrax penalties":"future dead cap unavailable"};
    });
  }
  optimalLineup(players){ const pool=players.filter(p=>!this._unavailable(p)&&this._score(p)!=null),used=new Set(),lineup=[],slots=[];this.starters.forEach((s,i)=>{for(let n=0;n<s.count;n++)slots.push({slot:s.slot,accept:s.accept,order:i*100+n});});slots.sort((a,b)=>a.accept.length-b.accept.length||a.order-b.order).forEach(s=>{const pick=pool.filter(p=>!used.has(p.id)&&s.accept.includes(this._pos(p))).sort((a,b)=>this._score(b)-this._score(a))[0];if(pick)used.add(pick.id);lineup.push({slot:s.slot,player:pick||null});});return{lineup,total:this._safeSum(lineup.filter(r=>r.player),r=>this._score(r.player)),filled:lineup.filter(r=>r.player).length,open:lineup.filter(r=>!r.player).length}; }
  usableDepth(players,ids){ return players.filter(p=>!ids.has(p.id)&&!this._taxi(p)&&!this._unavailable(p)&&this._score(p)!=null); }
  teamPillars(team){
    const players=team.players||[],opt=this.optimalLineup(players),ids=new Set(opt.lineup.filter(r=>r.player).map(r=>r.player.id)),depth=this.usableDepth(players,ids),starters=opt.lineup.filter(r=>r.player).map(r=>r.player);
    const salary=this._completeSum(players,p=>this._capSalary(p)),dead=this._n(team.deadCap),used=salary==null&&dead==null?null:(salary==null||dead==null?null:salary+dead),room=used==null?null:this.cap-used,financialProjection=this.financialProjection(team,5),ages=starters.map(p=>this._n(p.age)).filter(a=>a!=null),age=ages.length?ages.reduce((a,b)=>a+b,0)/ages.length:null,picks=team.picks||[],draft=picks.reduce((s,p)=>s+(Number(p.round)===1?3:Number(p.round)===2?2:1),0);
    const positions=["QB","RB","WR","TE","DL","LB","DB"],byPos={};positions.forEach(pos=>{const demand=this.starters.filter(s=>s.accept.includes(pos)).reduce((n,s)=>n+s.count/s.accept.length,0),need=Math.max(1,Math.ceil(demand)),pool=players.filter(p=>this._pos(p)===pos&&this._score(p)!=null&&!this._unavailable(p)).sort((a,b)=>this._score(b)-this._score(a));byPos[pos]=this._safeAvg(pool.slice(0,need),p=>this._score(p));});
    const known=Object.values(byPos).filter(v=>v!=null),balance=known.length>=3?100-Math.min(100,this._std(known)*10):null;
    const mode=this._windowMode(age,draft,opt.total);
    return{teamId:team.id,teamName:team.name,pillars:{
      legalStarters:{value:opt.total,filled:opt.filled,open:opt.open,reason:opt.total==null?"No reliable scoring input exists for enough eligible starters to calculate lineup strength.":`Best legal lineup totals ${opt.total.toFixed(1)} FP/G using ${opt.filled} scored starters. ${opt.open} lineup slot(s) are open, but open spots are not scored as weaknesses.`},
      usableDepth:{value:this._safeAvg(depth,p=>this._score(p)),count:depth.length,reason:depth.length?`There are ${depth.length} non-starter players with usable scoring data who are not taxi/minor or unavailable. Their average usable score is ${this._safeAvg(depth,p=>this._score(p))?.toFixed(1)??"unavailable"} FP/G.`:"No non-starter currently has enough usable scoring data to measure depth. This is treated as unavailable evidence, not automatic bad depth."},
      capHealth:{value:room==null?null:(room/this.cap)*100,room,used,deadCap:dead,cap:this.cap,leagueYear:prideLeagueYear(this.now),annualCapIncrease:this.capAnnualIncrease,annualContractIncrease:this.contractAnnualIncrease,fiveYear:financialProjection,reason:used==null?`Cap health is unavailable because one or more required salary/dead-cap values are missing. Under the Pride bylaws, IR salary counts 0%, taxi salary counts 100%, and missing salary is never treated as $0. The active league cap is $${this.cap.toFixed(2)}, increasing 5% each March 1.`:`Known bylaw-adjusted cap usage is $${used.toFixed(2)} against the current $${this.cap.toFixed(2)} Pride cap, leaving $${room.toFixed(2)}. IR salaries count 0%; taxi salaries count 100%. The cap rises 5% each March 1 and active contracts rise 20% each league year.`},
      competitiveWindow:{starterAge:age,mode,reason:age==null?"Competitive window is uncertain because starter ages are incomplete.":`Starter age averages ${age.toFixed(1)}. Draft-capital score is ${draft}. Combined with known lineup strength, the roster currently profiles as ${mode}.`},
      positionalBalance:{value:balance,byPos,reason:balance==null?"Positional balance needs at least three position groups with reliable scoring data.":`Balance compares known scoring strength across QB, RB, WR, TE, DL, LB and DB groups. Lower spread between position groups produces a higher score.`},
      draftCapital:{value:draft,picks:picks.length,reason:picks.length?`${picks.length} known future pick(s) contribute a weighted draft-capital score of ${draft}; first-round picks carry the most weight, then seconds, then later rounds.`:"No future draft picks were returned in the synced data. This is reported as no known picks, not proof the team owns none."}
    },lineup:opt,depth};
  }
  _std(a){const m=a.reduce((x,y)=>x+y,0)/a.length;return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length);}
  _windowMode(age,draft,strength){if(age==null)return"unknown";if(age<=26&&draft>=4)return"rebuilding";if(age>=29&&strength!=null)return"contending";return"balanced";}
  _percentile(value,values){if(value==null)return null;const g=values.filter(v=>v!=null).sort((a,b)=>a-b);return g.length?100*g.filter(v=>v<=value).length/g.length:null;}
  _grade(s){if(s==null)return"N/A";if(s>=93)return"A";if(s>=88)return"A-";if(s>=83)return"B+";if(s>=78)return"B";if(s>=73)return"B-";if(s>=68)return"C+";if(s>=63)return"C";if(s>=58)return"C-";if(s>=50)return"D";return"F";}
  _teamVerdict(report){
    const p=report.pillars,groups=Object.entries(p.positionalBalance.byPos||{}).filter(([,value])=>value!=null).sort((a,b)=>a[1]-b[1]);
    const weakest=groups[0]?.[0],window=p.competitiveWindow.mode||"unknown",starter=p.legalStarters.value,dead=p.capHealth.deadCap,room=p.capHealth.room;
    const strengths=starter==null?"lineup production is unavailable":`${starter.toFixed(1)} FP/G from the best legal lineup`;
    const concern=weakest?`${weakest} is the weakest measured position group`:"no position group has enough evidence to name a weakest unit";
    const finance=room==null?"cap flexibility is unconfirmed":(dead!=null&&dead>0?"$"+dead.toFixed(2)+" in dead cap leaves ":"")+"$"+room.toFixed(2)+" of current room";
    return `${report.teamName} has a ${window} profile with ${strengths}; ${concern}, and ${finance}.`;
  }
  analyzeLeague(teams){
    const reports=teams.map(t=>this.teamPillars(t));
    const labels={legalStarters:"Starter Strength",usableDepth:"Depth / Bench",capHealth:"Cap Health",competitiveWindow:"Window / Age",positionalBalance:"Balance / Needs",draftCapital:"Draft Capital"};
    const weights={legalStarters:.36,usableDepth:.22,capHealth:.16,competitiveWindow:.10,positionalBalance:.10,draftCapital:.06};
    const keys=[["legalStarters",r=>r.pillars.legalStarters.value],["usableDepth",r=>r.pillars.usableDepth.value],["capHealth",r=>r.pillars.capHealth.value],["positionalBalance",r=>r.pillars.positionalBalance.value],["draftCapital",r=>r.pillars.draftCapital.value]],arrays={};
    keys.forEach(([k,f])=>arrays[k]=reports.map(f));
    const ages=reports.map(x=>x.pillars.competitiveWindow.starterAge),invertedAges=ages.map(a=>a==null?null:-a);
    return reports.map(r=>{
      const comps=[];
      keys.forEach(([k,f])=>{const percentile=this._percentile(f(r),arrays[k]);if(percentile!=null)comps.push({name:k,label:labels[k],score:percentile,weight:weights[k],weightPercent:weights[k]*100});});
      const age=r.pillars.competitiveWindow.starterAge,agePercentile=this._percentile(age==null?null:-age,invertedAges);
      if(agePercentile!=null)comps.push({name:"competitiveWindow",label:labels.competitiveWindow,score:agePercentile,weight:weights.competitiveWindow,weightPercent:weights.competitiveWindow*100});
      const appliedWeight=comps.reduce((sum,component)=>sum+component.weight,0);
      const score=appliedWeight?comps.reduce((sum,component)=>sum+component.score*component.weight,0)/appliedWeight:null;
      const ordered=[...comps].sort((a,b)=>(b.score*b.weight)-(a.score*a.weight));
      const strengths=ordered.slice(0,2).map(c=>`${c.label} (${c.score.toFixed(0)}th percentile)`);
      const risks=[...comps].sort((a,b)=>a.score-b.score).slice(0,2).map(c=>`${c.label} (${c.score.toFixed(0)}th percentile)`);
      const result={...r,grade:this._grade(score),score,components:comps,confidence:Math.round(appliedWeight*100),appliedWeight,framework:{weights,labels,missingData:"Known components are reweighted to 100%; missing data is never scored as zero."}};
      result.verdict=this._teamVerdict(result);
      result.summary=score==null?"Overall grade is unavailable because too few pillars have reliable data.":`Overall ${result.grade} (${score.toFixed(1)}/100). Strongest evidence: ${strengths.join(", ")||"unavailable"}. Biggest relative concerns: ${risks.join(", ")||"unavailable"}. Confidence is ${result.confidence}% before missing-data rebalancing.`;
      return result;
    });
  }
  recommendFreeAgents(team,freeAgents,limit=10){
    const players=team.players||[];
    const base=this.optimalLineup(players);
    const teamReport=this.teamPillars(team);
    const window=teamReport.pillars.competitiveWindow.mode;
    const salary=this._completeSum(players,p=>this._capSalary(p));
    const dead=this._n(team.deadCap);
    const capRoom=salary==null||dead==null?null:this.cap-salary-dead;
    const posCounts={};players.filter(p=>!this._ir(p)&&!this._taxi(p)).forEach(p=>{const pos=this._pos(p);posCounts[pos]=(posCounts[pos]||0)+1;});
    const positionStrength={};["QB","RB","WR","TE","DL","LB","DB"].forEach(pos=>{const vals=players.filter(p=>this._pos(p)===pos&&!this._unavailable(p)).map(p=>this._score(p)).filter(v=>v!=null).sort((a,b)=>b-a);positionStrength[pos]=vals.length?vals.slice(0,Math.min(vals.length,3)).reduce((a,b)=>a+b,0)/Math.min(vals.length,3):null;});
    const knownStrengths=Object.values(positionStrength).filter(v=>v!=null).sort((a,b)=>a-b);
    const weakThreshold=knownStrengths.length?knownStrengths[Math.floor((knownStrengths.length-1)*0.35)]:null;
    return(freeAgents||[]).map(fa=>{
      const ev=this._score(fa);if(ev==null||this._unavailable(fa))return null;
      const pos=this._pos(fa),age=this._n(fa.age),faSalary=this._n(fa.salary),contract=this._n(fa.contract);
      const next=this.optimalLineup([...players,fa]);
      const gain=base.total!=null&&next.total!=null?Math.max(0,next.total-base.total):null;
      const same=players.filter(p=>this._pos(p)===pos&&this._score(p)!=null).sort((a,b)=>this._score(a)-this._score(b));
      const weak=same[0],vs=weak&&ev!=null?ev-this._score(weak):null;
      const positionNeed=positionStrength[pos]==null?null:(weakThreshold!=null&&positionStrength[pos]<=weakThreshold);
      const qbLegal=pos!=="QB"||(posCounts.QB||0)<4;
      if(!qbLegal)return null;
      let nowScore=0,futureScore=0,fitScore=0,capScore=0,riskPenalty=0;
      const reasons=[],details=[];
      details.push(`Scoring input: ${this._scoreSource(fa)} at ${ev.toFixed(1)} FP/G equivalent.`);
      if(gain!=null&&gain>0){nowScore+=Math.min(35,15+gain*4);reasons.push(`improves the legal lineup by ${gain.toFixed(1)} FP/G`);details.push(`${fa.name} raises the best legal lineup from ${base.total.toFixed(1)} to ${next.total.toFixed(1)} FP/G.`);}else if(gain===0){nowScore+=4;details.push(`${fa.name} does not immediately enter the best legal lineup, so his case depends on depth, future value and roster construction rather than headline projection.`);}else details.push(`Immediate lineup gain is unavailable because comparable roster scoring data is incomplete.`);
      if(vs!=null&&vs>0){fitScore+=Math.min(18,6+vs*2);reasons.push(`upgrades ${pos} depth over ${weak.name}`);details.push(`He is ${vs.toFixed(1)} FP/G above the weakest scored ${pos} currently on the roster.`);}else if(!weak){fitScore+=5;details.push(`There is no comparable scored ${pos}; GMS treats that as an information gap, not an automatic positional weakness.`);}
      if(positionNeed===true){fitScore+=15;reasons.push(`${pos} is one of this roster's weaker known position groups`);details.push(`${pos} falls in the lower tier of this team's known position-group strength, so the roster-fit bonus is larger.`);}else if(positionNeed===false){details.push(`${pos} is not one of the roster's weakest known position groups, so GMS does not over-reward the player merely for scoring well.`);}
      if(age!=null){
        const prime={QB:28,RB:24,WR:25,TE:26,DL:26,LB:25,DB:25}[pos]??25;
        const distance=Math.abs(age-prime);
        const youthValue=Math.max(0,18-distance*3);
        if(window==="rebuilding"){futureScore+=age<=26?Math.min(24,youthValue+8):Math.max(0,youthValue-6);if(age<=26)reasons.push(`age ${age} fits a rebuilding window`);}
        else if(window==="contending"){futureScore+=age<=29?Math.min(14,youthValue):Math.max(0,8-distance);}
        else futureScore+=Math.min(18,youthValue+2);
        details.push(`Age ${age} is evaluated against a ${pos} age curve and this team's ${window} competitive window.`);
        if(age<=23){futureScore+=5;details.push(`At age ${age}, he also has taxi-squad eligibility potential under the Pride age rule if other roster conditions are met.`);}
      }else details.push(`Age is unavailable, so no future-value age bonus is awarded.`);
      if(contract!=null){if(contract>=2){futureScore+=5;reasons.push(`${contract}-year contract information adds planning value`);details.push(`Known contract length is ${contract} year(s), which helps project future roster control.`);}else details.push(`Known contract length is ${contract} year; future control is limited.`);}else details.push(`Contract length is unavailable, so GMS does not assume long-term control.`);
      if(capRoom!=null&&faSalary!=null){const post=capRoom-faSalary;if(post>=0){const efficiency=ev/Math.max(1,faSalary);capScore+=Math.min(16,5+efficiency*3);reasons.push(`produces ${ev.toFixed(1)} FP/G at a ${faSalary.toFixed(2)} salary`);details.push(`The salary is legal under the current ${this.cap.toFixed(2)} cap and would leave about ${post.toFixed(2)} of known room. Cap space is only a legality check; the positive grade comes from production per cap dollar.`);}else{riskPenalty+=25;details.push(`The listed salary would exceed known cap room by about $${Math.abs(post).toFixed(2)}, so GMS sharply lowers the recommendation despite the player's football value.`);}}
      else if(capRoom!=null)details.push(`Team cap room is known, but player salary is unavailable; affordability is not assumed.`);else details.push(`Cap fit cannot be confirmed because roster salary/dead-cap data is incomplete.`);
      if(fa.injury){riskPenalty+=8;details.push(`Availability risk: ${fa.injury}. The player is discounted rather than automatically removed unless the status makes him unavailable.`);}
      const rosterSize=players.filter(p=>!this._ir(p)&&!this._taxi(p)).length;
      if(rosterSize>=37){riskPenalty+=8;details.push(`The active roster is already at or above the 37-player bylaw maximum, so an addition would require a corresponding legal roster move.`);}else if(rosterSize<30){fitScore+=5;details.push(`The active roster is below the in-season 30-player minimum, so legal roster depth has extra value.`);}
      const total=Math.max(0,Math.round((nowScore+futureScore+fitScore+capScore-riskPenalty)*10)/10);
      const profile=window==="rebuilding"?"future-weighted":window==="contending"?"win-now with future protection":"balanced now-and-future";
      if(!reasons.length&&total<12)return null;
      return{action:"BUY",player:fa,lineupGain:gain,vsWeakest:vs,fit:total,teamEvidence:{team:team.name,window,position:pos,positionStrength:positionStrength[pos],capRoom,deadCap:dead,starterTotalBefore:base.total,starterTotalAfter:next.total,usableDepth:teamReport.pillars.usableDepth.count,playerAge:age,playerSalary:faSalary,contractYears:contract},fitBreakdown:{now:Math.round(nowScore*10)/10,future:Math.round(futureScore*10)/10,rosterFit:Math.round(fitScore*10)/10,capEfficiency:Math.round(capScore*10)/10,riskPenalty:Math.round(riskPenalty*10)/10},reasons,details,explanation:`${fa.name} is a ${profile} fit for ${team.name}, not simply a points-play. ${reasons.length?`Key reasons: ${reasons.join("; ")}. `:""}${details.join(" ")}`};
    }).filter(Boolean).sort((a,b)=>b.fit-a.fit||(b.fitBreakdown.future-a.fitBreakdown.future)||(b.lineupGain||0)-(a.lineupGain||0)).slice(0,limit);
  }
}
