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
  suggestTradeOffers(myTeam,targetTeam,targetPlayer,targetPick,context={}){
    const leagueTeams=context.leagueTeams||[myTeam,targetTeam],targetScore=this._score(targetPlayer),targetPos=this._pos(targetPlayer),pickRound=this._n(targetPick?.round??targetPick?.draftRound),pickYear=this._n(targetPick?.year??targetPick?.season??targetPick?.draftYear);
    const leagueYear=prideLeagueYear(this.now),yearsOut=pickYear==null?null:Math.max(0,pickYear-leagueYear),pickBase=pickRound==null?null:({1:24,2:14,3:8,4:5,5:3}[pickRound]??2),pickValue=pickBase==null?null:pickBase*Math.pow(.88,yearsOut??0);
    const playerValue=p=>{const score=this._score(p),age=this._n(p.age),salary=this._n(p.salary),contract=this._n(p.contract??p.years);if(score==null)return null;const ageValue=age==null?0:age<=23?10:age<=26?7:age<=29?3:age>=32?-5:0,control=contract==null?0:Math.min(6,contract*2),efficiency=salary==null?0:Math.min(6,score/Math.max(1,salary)*5);return score*2+ageValue+control+efficiency;};
    const targetPlayerValue=playerValue(targetPlayer),targetValue=targetPlayerValue==null?null:targetPlayerValue+(pickValue??0);
    const targetReport=this.teamPillars(targetTeam),myReport=this.teamPillars(myTeam),targetGroups=targetReport.pillars.positionalBalance.byPos||{};
    const targetSalary=this._n(targetPlayer.salary),targetDead=this._n(targetTeam.deadCap),myDead=this._n(myTeam.deadCap),mySalary=this._completeSum(myTeam.players||[],p=>this._capSalary(p));
    const currentRoom=mySalary==null||myDead==null?null:this.cap-mySalary-myDead;
    const nextYear=leagueYear+1,nextCap=prideCapForLeagueYear(nextYear),myNextDead=this._n(myTeam.nextYearDeadCap),nextCommitted=this._completeSum(myTeam.players||[],p=>{const salary=this._n(p.salary),years=this._n(p.contract??p.years);if(salary==null||years==null)return null;return years>=2?salary*(1+this.contractAnnualIncrease):0;});
    const targetNextSalary=targetSalary==null||this._n(targetPlayer.contract??targetPlayer.years)==null?null:(this._n(targetPlayer.contract??targetPlayer.years)>=2?targetSalary*(1+this.contractAnnualIncrease):0);
    const nextRoom=nextCommitted==null||myNextDead==null?null:nextCap-nextCommitted-myNextDead;
    return(myTeam.players||[]).filter(p=>!this._ir(p)&&this._score(p)!=null).map(player=>{
      const offerValue=playerValue(player),gap=targetValue==null||offerValue==null?null:offerValue-targetValue,pos=this._pos(player),recipientStrength=targetGroups[pos],salary=this._n(player.salary),contract=this._n(player.contract??player.years);
      const afterPlayers=[...(myTeam.players||[]).filter(p=>String(p.id)!==String(player.id)),targetPlayer],after={...myTeam,players:afterPlayers},afterLineup=this.optimalLineup(afterPlayers),beforeLineup=this.optimalLineup(myTeam.players||[]),lineupDelta=afterLineup.total==null||beforeLineup.total==null?null:afterLineup.total-beforeLineup.total;
      const postRoom=currentRoom==null||salary==null||targetSalary==null?null:currentRoom+salary-targetSalary;
      const outgoingNext=salary==null||contract==null?null:(contract>=2?salary*(1+this.contractAnnualIncrease):0),postNext=nextRoom==null||outgoingNext==null||targetNextSalary==null?null:nextRoom+outgoingNext-targetNextSalary;
      const targetNeed=recipientStrength==null?null:100-recipientStrength,acceptanceFit=(targetNeed??0)+(gap==null?0:-Math.abs(gap))+Math.max(0,offerValue??0)/10;
      const overpay=gap==null?null:gap>8,verdict=gap==null?"VALUE UNAVAILABLE":Math.abs(gap)<=6?"START HERE":gap<-6?"ADD TO OFFER":overpay?"OVERPAY":"FAIR RANGE";
      const reasons=[
        gap==null?`Value gap is unavailable because the target player, pick, or offer asset lacks scoring/round data.`:`${player.name} carries an evidence value ${gap>=0?"+":""}${gap.toFixed(1)} from the requested ${targetPlayer.name} plus ${pickYear??"unknown year"} Round ${pickRound??"unknown"} pick package.`,
        recipientStrength==null?`${targetTeam.name}'s ${pos} strength is unavailable.`:`${targetTeam.name}'s measured ${pos} group scores ${recipientStrength.toFixed(1)} FP/G, so this offer is ranked against that roster's actual need.`,
        lineupDelta==null?`${myTeam.name}'s legal-lineup change is unavailable.`:`The swap changes ${myTeam.name}'s best legal lineup by ${lineupDelta>=0?"+":""}${lineupDelta.toFixed(1)} FP/G.`,
        postRoom==null?`Current post-trade cap room is unavailable.`:`Known post-trade room would be $${postRoom.toFixed(2)} after exchanging the listed salaries.`
      ];
      return{verdict,offer:[player],offerValue,targetValue,valueGap:gap,acceptanceFit,lineupDelta,postTradeRoom:postRoom,postNextYearRoom:postNext,targetNeedScore:targetNeed,reasons,warning:overpay?`This offer projects as an overpay by ${gap.toFixed(1)} evidence points.`:null,evidence:{targetPlayerValue,pickValue,pickRound,pickYear,yearsOut,currentRoom,nextYearRoom:nextRoom,targetPosition:targetPos,myWindow:myReport.pillars.competitiveWindow.mode,targetWindow:targetReport.pillars.competitiveWindow.mode,outgoingSalary:salary,incomingSalary:targetSalary}};
    }).sort((a,b)=>{const rank={"START HERE":4,"FAIR RANGE":3,"ADD TO OFFER":2,"VALUE UNAVAILABLE":1,"OVERPAY":0};return rank[b.verdict]-rank[a.verdict]||b.acceptanceFit-a.acceptanceFit;}).slice(0,8);
  }

  recommendFreeAgents(team,freeAgents,limit=10,context={}){
    const players=team.players||[],leagueTeams=context.leagueTeams||[team],base=this.optimalLineup(players),teamReport=this.teamPillars(team);
    const window=teamReport.pillars.competitiveWindow.mode,dead=this._n(team.deadCap),salary=this._completeSum(players,p=>this._capSalary(p)),capRoom=salary==null||dead==null?null:this.cap-salary-dead;
    const nextYear=prideLeagueYear(this.now)+1,nextCap=prideCapForLeagueYear(nextYear);
    const nextCommitted=this._completeSum(players,p=>{const amount=this._n(p.salary),years=this._n(p.contract??p.years);if(amount==null||years==null)return null;return years>=2?amount*(1+this.contractAnnualIncrease):0;});
    const nextDead=this._n(team.nextYearDeadCap),nextRoom=nextCommitted==null||nextDead==null?null:nextCap-nextCommitted-nextDead;
    const active=players.filter(p=>!this._ir(p)&&!this._taxi(p)),posCounts={};
    active.forEach(p=>{const pos=this._pos(p);posCounts[pos]=(posCounts[pos]||0)+1;});
    const startersByPos={};this.starters.forEach(slot=>slot.accept.forEach(pos=>{startersByPos[pos]=(startersByPos[pos]||0)+slot.count/slot.accept.length;}));
    const aboveReplacement={};
    const positionStrength={};
    ["QB","RB","WR","TE","DL","LB","DB"].forEach(pos=>{
      const vals=players.filter(p=>this._pos(p)===pos&&!this._unavailable(p)).map(p=>this._score(p)).filter(v=>v!=null).sort((a,b)=>b-a);
      const replacementIndex=Math.max(0,Math.ceil(startersByPos[pos]||1));
      const replacement=vals[replacementIndex]??vals[vals.length-1]??null;
      aboveReplacement[pos]=replacement==null?null:vals.filter(v=>v>replacement).length;
      positionStrength[pos]=vals.length?vals.slice(0,Math.min(vals.length,Math.max(1,replacementIndex))).reduce((a,b)=>a+b,0)/Math.min(vals.length,Math.max(1,replacementIndex)):null;
    });
    const leagueSalariesByPos={};
    leagueTeams.flatMap(t=>t.players||[]).forEach(p=>{const pos=this._pos(p),amount=this._n(p.salary);if(amount!=null)(leagueSalariesByPos[pos]||(leagueSalariesByPos[pos]=[])).push(amount);});
    const percentile=(values,p)=>{const sorted=[...(values||[])].sort((a,b)=>a-b);if(!sorted.length)return null;return sorted[Math.min(sorted.length-1,Math.max(0,Math.floor((sorted.length-1)*p)))];};
    const teamNeed=(candidateTeam,pos)=>{
      const report=this.teamPillars(candidateTeam),strength=report.pillars.positionalBalance.byPos?.[pos],count=(candidateTeam.players||[]).filter(p=>this._pos(p)===pos&&!this._unavailable(p)&&this._score(p)!=null).length,required=Math.ceil(startersByPos[pos]||1);
      return{score:strength==null?null:(required-count)*20-strength,count,required};
    };
    const results=(freeAgents||[]).map(fa=>{
      const projection=this._score(fa);if(projection==null||this._unavailable(fa))return null;
      const pos=this._pos(fa),age=this._n(fa.age),listedSalary=this._n(fa.salary),contract=this._n(fa.contract),rosteredPct=this._n(fa.rosteredPct),trend=this._n(fa.rosterTrend);
      if(pos==="QB"&&(posCounts.QB||0)>=4)return null;
      const next=this.optimalLineup([...players,fa]),lineupGain=base.total!=null&&next.total!=null?Math.max(0,next.total-base.total):null;
      const same=players.filter(p=>this._pos(p)===pos&&this._score(p)!=null&&!this._unavailable(p)).sort((a,b)=>this._score(b)-this._score(a));
      const required=Math.ceil(startersByPos[pos]||1),worstStarter=same[Math.min(same.length-1,Math.max(0,required-1))]||null,topBench=same[required]||null;
      const comparison=worstStarter||topBench,gap=comparison?projection-this._score(comparison):null,missingStarters=Math.max(0,required-same.length);
      const ownNeed=teamNeed(team,pos),otherNeeds=leagueTeams.filter(t=>String(t.id)!==String(team.id)).map(t=>teamNeed(t,pos));
      const strongerNeed=ownNeed.score==null?null:otherNeeds.filter(n=>n.score!=null&&n.score>=ownNeed.score).length;
      const comparableCap=percentile(leagueSalariesByPos[pos],.75),roomCap=capRoom==null?null:Math.max(0,capRoom),futureCap=nextRoom==null?null:Math.max(0,nextRoom/(1+this.contractAnnualIncrease));
      const bidCaps=[roomCap,comparableCap,futureCap].filter(v=>v!=null),maxBid=roomCap==null||comparableCap==null?null:Math.max(0,Math.floor(Math.min(...bidCaps)*100)/100);
      const nextSalary=contract!=null&&contract>=2&&maxBid!=null?maxBid*(1+this.contractAnnualIncrease):null;
      const postCurrent=maxBid==null||capRoom==null?null:capRoom-maxBid,postNext=nextSalary==null||nextRoom==null?null:nextRoom-nextSalary;
      let score=0;
      if(missingStarters>0)score+=24+Math.min(10,missingStarters*4);
      else if(aboveReplacement[pos]!=null&&aboveReplacement[pos]<=required+1)score+=14;
      if(lineupGain!=null)score+=Math.min(28,lineupGain*4);
      if(gap!=null&&gap>0)score+=Math.min(18,gap*2);
      if(window==="rebuilding"&&age!=null)score+=age<=25?18:age<=27?8:-8;
      else if(window==="contending"&&projection!=null)score+=Math.min(14,projection/2)+(age!=null&&age>31?-4:0);
      else if(age!=null)score+=age<=27?10:4;
      if(contract!=null)score+=contract>=2?7:2;
      if(maxBid!=null&&maxBid>0)score+=8;else if(roomCap===0)score-=35;
      if(trend!=null)score+=Math.max(-4,Math.min(8,trend*2));
      if(fa.injury)score-=10;
      if(strongerNeed!=null)score-=Math.min(8,strongerNeed);
      const verdict=score>=52&&((lineupGain!=null&&lineupGain>0)||(missingStarters>0))&&maxBid!==0?"PICK UP":score>=28?"MONITOR":"PASS";
      const teamName=team.name||"This team",reasons=[];
      reasons.push(missingStarters>0?`${teamName} is ${missingStarters.toFixed(1)} legal ${pos} starter slot(s) short; ${same.length} scored ${pos} players currently cover ${required} estimated league-specific slots.`:`${teamName} has ${aboveReplacement[pos]??"unavailable"} ${pos} players projected above its current replacement point for ${required} estimated league-specific slots.`);
      reasons.push(gap==null?`${teamName}'s exact ${pos} projection gap is unavailable because the comparable starter/bench score is missing.`:`${fa.name} projects ${gap>=0?"+":""}${gap.toFixed(1)} FP/G against ${comparison?.name||"the current comparison"} (${this._score(comparison).toFixed(1)} FP/G) in Fantrax's Pride scoring.`);
      reasons.push(maxBid==null?`${teamName}'s maximum blind bid is unavailable because ${capRoom==null?"current cap room":"same-position salary comparables"} is unavailable.`:`${teamName} can bid at most $${maxBid.toFixed(2)} under known current room and the ${pos} comparable-salary ceiling; that would leave $${postCurrent.toFixed(2)} current room.`);
      reasons.push(age==null?`${fa.name}'s age/window alignment for ${teamName}'s ${window} plan is unavailable.`:`${fa.name} is age ${age} for ${teamName}'s ${window} window; ${contract==null?"contract length is unavailable":`the known contract is ${contract} year(s)`}.`);
      const market=`Rostered percentage: ${rosteredPct==null?"unavailable":rosteredPct.toFixed(1)+"%"}; roster trend: ${trend==null?"unavailable":(trend>=0?"+":"")+trend.toFixed(1)+" points"}; other teams with similar or stronger measured ${pos} need: ${strongerNeed==null?"unavailable":strongerNeed}.`;
      const future=nextSalary==null?`Next-year salary impact is unavailable because contract length or a defensible bid is unavailable.`:postNext==null?`At the maximum bid, the 20% raise makes next-year salary `+"$"+nextSalary.toFixed(2)+`; projected next-year room is unavailable because future dead money or committed salary is unavailable.`:`At the maximum bid, the 20% raise makes next-year salary `+"$"+nextSalary.toFixed(2)+` and leaves `+"$"+postNext.toFixed(2)+` based on known commitments and dead money.`;
      return{action:verdict,verdict,player:fa,fit:Math.round(score*10)/10,maxBlindBid:maxBid,lineupGain,upgradeGap:gap,missingStarters,aboveReplacement:aboveReplacement[pos],teamEvidence:{team:teamName,position:pos,window,currentCapRoom:capRoom,currentDeadCap:dead,nextYear,nextYearCap:nextCap,nextYearCommitted:nextCommitted,nextYearDeadCap:nextDead,nextYearRoom:nextRoom,nextYearSalary:nextSalary,postCurrentRoom:postCurrent,postNextYearRoom:postNext,comparableSalaryCeiling:comparableCap,rosteredPct,rosterTrend:trend,strongerNeedTeams:strongerNeed,leagueScoring:`Live Fantrax Pride FP/G with ${this.starters.some(s=>s.slot==="SFX")?"Superflex":""} and ${this.starters.some(s=>["DL","LB","DB","ID"].includes(s.slot))?"IDP":""} lineup rules`},reasons:reasons.slice(0,4),details:[market,future,`Injury status: ${fa.injury||fa.status||"no current Fantrax flag"}.`],explanation:reasons.join(" ")+" "+market+" "+future};
    }).filter(Boolean).sort((a,b)=>{const order={"PICK UP":3,"MONITOR":2,"PASS":1};return order[b.verdict]-order[a.verdict]||b.fit-a.fit;});
    return results.slice(0,limit);
  }
}
