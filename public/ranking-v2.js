(() => {
  const originalFetch = window.fetch.bind(window);
  const STARTERS = [
    {slot:"QB",count:1,accept:["QB"]},
    {slot:"SFX",count:1,accept:["QB","RB","WR","TE"]},
    {slot:"RB",count:2,accept:["RB"]},
    {slot:"WR",count:3,accept:["WR"]},
    {slot:"TE",count:1,accept:["TE"]},
    {slot:"RWT",count:1,accept:["RB","WR","TE"]},
    {slot:"DL",count:3,accept:["DL"]},
    {slot:"LB",count:2,accept:["LB"]},
    {slot:"DB",count:3,accept:["DB"]},
    {slot:"ID",count:2,accept:["DL","LB","DB"]}
  ];
  const WEIGHTS = {
    legalStarters: 0.55,
    usableDepth: 0.12,
    idpEdge: 0.10,
    capHealth: 0.08,
    upside: 0.08,
    draftCapital: 0.07
  };
  const LABELS = {
    legalStarters: "Starter Strength",
    usableDepth: "Replacement Depth",
    idpEdge: "IDP Edge",
    capHealth: "Cap Flexibility",
    upside: "Developmental Upside",
    draftCapital: "Draft Capital"
  };

  const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const pos = p => {
    const s = String(p?.position || p?.pos || "").toUpperCase();
    if (s.includes("QB")) return "QB";
    if (s.includes("RB")) return "RB";
    if (s.includes("WR")) return "WR";
    if (s.includes("TE")) return "TE";
    if (/DL|DE|DT|NT|EDGE/.test(s)) return "DL";
    if (/LB/.test(s)) return "LB";
    if (/DB|CB|FS|SS|SAFETY|(^|\b)S(\b|$)/.test(s)) return "DB";
    return s.split(/[/,]/)[0] || "?";
  };
  const score = p => {
    const w = num(p?.weeklyProjection ?? p?.weekly);
    if (w != null && w > 0) return w;
    const s = num(p?.seasonProjection ?? p?.season);
    if (s != null && s > 0) return s / 17;
    const q = num(p?.performancePpg ?? p?.ppg);
    return q != null && q > 0 ? q : null;
  };
  const unavailable = p => /OUT|IR|INJURED|SUSPEND/i.test(String(p?.status || "") + " " + String(p?.injury || "") + " " + String(p?.rosterSlot || ""));
  const taxi = p => /TAXI|MINOR/i.test(String(p?.status || "") + " " + String(p?.rosterSlot || ""));
  const idOf = (p, i) => String(p?.id ?? p?.playerId ?? p?.name ?? i);

  function optimalLineup(players = []) {
    const pool = players.filter(p => !unavailable(p) && score(p) != null);
    const used = new Set();
    const lineup = [];
    const slots = [];
    STARTERS.forEach((s, i) => {
      for (let n = 0; n < s.count; n++) slots.push({slot:s.slot,accept:s.accept,order:i*100+n});
    });
    slots.sort((a,b) => a.accept.length - b.accept.length || a.order - b.order).forEach(s => {
      const pick = pool
        .map((p,i) => ({p,i}))
        .filter(x => !used.has(idOf(x.p,x.i)) && s.accept.includes(pos(x.p)))
        .sort((a,b) => score(b.p) - score(a.p))[0];
      if (pick) used.add(idOf(pick.p,pick.i));
      lineup.push({slot:s.slot,player:pick?.p || null});
    });
    const scored = lineup.filter(x => x.player);
    return {
      lineup,
      total: scored.length ? scored.reduce((n,x) => n + score(x.player), 0) : null,
      filled: scored.length,
      open: lineup.length - scored.length,
      ids: used
    };
  }

  function percentile(value, values) {
    if (value == null) return null;
    const known = values.filter(v => v != null).sort((a,b) => a-b);
    if (!known.length) return null;
    return 100 * known.filter(v => v <= value).length / known.length;
  }
  function grade(s) {
    if (s == null) return "N/A";
    if (s >= 97) return "A+";
    if (s >= 93) return "A";
    if (s >= 90) return "A-";
    if (s >= 87) return "B+";
    if (s >= 83) return "B";
    if (s >= 80) return "B-";
    if (s >= 77) return "C+";
    if (s >= 73) return "C";
    if (s >= 70) return "C-";
    if (s >= 67) return "D+";
    if (s >= 63) return "D";
    if (s >= 60) return "D-";
    return "F";
  }

  function teamMetrics(team = {}) {
    const players = team.players || team.items || [];
    const opt = optimalLineup(players);
    const starters = opt.lineup.filter(x => x.player).map(x => x.player);
    const starterIds = opt.ids;

    const depth = players
      .map((p,i) => ({p,i,s:score(p)}))
      .filter(x => x.s != null && !unavailable(x.p) && !taxi(x.p) && !starterIds.has(idOf(x.p,x.i)))
      .sort((a,b) => b.s - a.s)
      .slice(0, 6);
    const depthScore = depth.length ? depth.reduce((n,x) => n + x.s, 0) / depth.length : null;

    const idp = starters.filter(p => ["DL","LB","DB"].includes(pos(p)));
    const idpEdge = idp.length ? idp.reduce((n,p) => n + score(p), 0) : null;

    const salaries = players.map(p => num(p.salary)).filter(v => v != null);
    const used = salaries.length === players.length ? salaries.reduce((a,b) => a+b,0) + (num(team.deadCap) || 0) : null;
    const cap = num(team.cap) || 1403.90;
    const room = used == null ? null : Math.max(0, cap - used);
    const capHealth = room == null ? null : room / cap * 100;

    const young = players
      .map((p,i) => ({p,i,s:score(p),age:num(p.age),years:num(p.contract ?? p.years),salary:num(p.salary)}))
      .filter(x => !unavailable(x.p) && x.age != null && x.age <= 24 && !starterIds.has(idOf(x.p,x.i)))
      .map(x => {
        const projection = x.s || 0;
        const youth = Math.max(0, 25 - x.age) * 1.5;
        const control = Math.min(5, x.years || 0) * 0.7;
        const efficiency = x.salary != null && x.salary > 0 ? Math.min(5, projection / x.salary * 4) : 0;
        return projection + youth + control + efficiency;
      })
      .sort((a,b) => b-a)
      .slice(0, 5);
    const upside = young.length ? young.reduce((a,b) => a+b,0) : 0;

    const picks = team.picks || [];
    const draftCapital = picks.reduce((n,p) => {
      const round = Number(p.round ?? p.draftRound);
      const year = Number(p.year ?? p.season ?? p.draftYear);
      const current = new Date().getFullYear();
      const discount = Number.isFinite(year) ? Math.pow(0.92, Math.max(0, year-current)) : 1;
      const base = round===1?10:round===2?5:round===3?2.5:round===4?1.5:1;
      return n + base * discount;
    },0);

    return {
      team,
      opt,
      legalStarters: opt.total,
      usableDepth: depthScore,
      idpEdge,
      capHealth,
      upside,
      draftCapital,
      room,
      starters
    };
  }

  function currentWindow(metrics) {
    const ages = metrics.starters.map(p => num(p.age)).filter(v => v != null);
    if (!ages.length) return "unknown";
    const avg = ages.reduce((a,b) => a+b,0) / ages.length;
    if (metrics.legalStarters != null && avg >= 28.5) return "contending";
    if (avg <= 25.5 && metrics.upside > 20) return "ascending";
    return "balanced";
  }

  function rebuildRankings(data) {
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    if (teams.length < 2) return data;
    const metrics = teams.map(teamMetrics);
    const arrays = {};
    Object.keys(WEIGHTS).forEach(k => arrays[k] = metrics.map(m => m[k]));

    const rankings = metrics.map(m => {
      const components = [];
      Object.entries(WEIGHTS).forEach(([name,weight]) => {
        const value = m[name];
        const pct = percentile(value, arrays[name]);
        if (pct != null) components.push({name,label:LABELS[name],score:pct,weight,weightPercent:weight*100});
      });
      const applied = components.reduce((n,c) => n+c.weight,0);
      const overall = applied ? components.reduce((n,c) => n+c.score*c.weight,0)/applied : null;

      const currentWeights = {legalStarters:.70,usableDepth:.15,idpEdge:.15};
      const currentParts = components.filter(c => currentWeights[c.name]);
      const currentApplied = currentParts.reduce((n,c) => n+currentWeights[c.name],0);
      const currentStrength = currentApplied ? currentParts.reduce((n,c) => n+c.score*currentWeights[c.name],0)/currentApplied : null;

      const ceilingWeights = {legalStarters:.38,usableDepth:.12,idpEdge:.10,capHealth:.15,upside:.15,draftCapital:.10};
      const ceilingParts = components.filter(c => ceilingWeights[c.name]);
      const ceilingApplied = ceilingParts.reduce((n,c) => n+ceilingWeights[c.name],0);
      const championshipCeiling = ceilingApplied ? ceilingParts.reduce((n,c) => n+c.score*ceilingWeights[c.name],0)/ceilingApplied : null;

      const window = currentWindow(m);
      const strongest = [...components].sort((a,b)=>b.score-a.score)[0];
      const weakest = [...components].sort((a,b)=>a.score-b.score)[0];
      const verdict = `${m.team.name} projects from its best legal lineup first${m.idpEdge!=null?`, with IDP starter production of ${m.idpEdge.toFixed(1)} FP/G`:""}. ${strongest?`${strongest.label} is a relative strength (${strongest.score.toFixed(0)}th percentile).`:""} ${weakest&&weakest.name!==strongest?.name?`${weakest.label} is the biggest measured constraint (${weakest.score.toFixed(0)}th percentile).`:""}`;

      return {
        teamId:m.team.id,
        teamName:m.team.name,
        pillars:{
          legalStarters:{value:m.legalStarters,filled:m.opt.filled,open:m.opt.open},
          usableDepth:{value:m.usableDepth,count:Math.min(6,(m.team.players||[]).length)},
          capHealth:{value:m.capHealth,room:m.room},
          competitiveWindow:{mode:window},
          idpEdge:{value:m.idpEdge},
          upside:{value:m.upside},
          draftCapital:{value:m.draftCapital}
        },
        lineup:m.opt,
        components,
        score:overall,
        grade:grade(overall),
        confidence:Math.round(applied*100),
        currentStrength,
        currentStrengthGrade:grade(currentStrength),
        championshipCeiling,
        championshipCeilingGrade:grade(championshipCeiling),
        framework:{
          version:"starter-first-v2",
          weights:WEIGHTS,
          labels:LABELS,
          philosophy:"Best legal lineup first. Low-projection developmental players do not reduce current strength; they only contribute positively to upside. IDP is measured as a distinct weekly advantage."
        },
        verdict,
        summary: overall==null ? "Ranking unavailable." : `Overall ${grade(overall)} (${overall.toFixed(1)}/100). Current strength ${currentStrength==null?"N/A":grade(currentStrength)+" "+currentStrength.toFixed(1)}. Championship ceiling ${championshipCeiling==null?"N/A":grade(championshipCeiling)+" "+championshipCeiling.toFixed(1)}.`
      };
    }).sort((a,b)=>(b.score??-Infinity)-(a.score??-Infinity));

    data.rankings = rankings;
    const oldId = data.myAnalysis?.teamId;
    if (oldId != null) data.myAnalysis = rankings.find(r => String(r.teamId)===String(oldId)) || data.myAnalysis;
    return data;
  }

  window.fetch = async function(input, init) {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === "string" ? input : input?.url || "";
      if (!url.includes("/league-data") || !response.ok) return response;
      const type = response.headers.get("content-type") || "";
      if (!type.includes("application/json")) return response;
      const data = await response.clone().json();
      rebuildRankings(data);
      const headers = new Headers(response.headers);
      headers.set("content-type","application/json; charset=utf-8");
      headers.set("cache-control","no-store");
      return new Response(JSON.stringify(data), {status:response.status,statusText:response.statusText,headers});
    } catch (err) {
      console.warn("GMS ranking-v2 fallback", err);
      return response;
    }
  };
})();
