import baseWorker from "./worker.js";

const ESPN_NEWS = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100";

function cors() {
  return {
    "Access-Control-Allow-Origin": "https://gmslocker.com",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
    "Cache-Control": "no-store",
    Vary: "Origin"
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors() }
  });
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function categoryNames(article) {
  const names = [];
  for (const category of article?.categories || []) {
    const candidates = [
      category?.athlete?.displayName,
      category?.athlete?.fullName,
      category?.team?.displayName,
      category?.team?.shortDisplayName,
      category?.name,
      category?.description
    ];
    for (const value of candidates) {
      const label = clean(value);
      if (label && !names.some((item) => item.toLowerCase() === label.toLowerCase())) names.push(label);
    }
  }
  return names.slice(0, 12);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreOf(player) {
  const weekly = number(player?.weeklyProjection ?? player?.weekly);
  if (weekly != null && weekly > 0) return weekly;
  const season = number(player?.seasonProjection ?? player?.season);
  if (season != null && season > 0) return season / 17;
  const ppg = number(player?.performancePpg ?? player?.ppg);
  return ppg != null && ppg > 0 ? ppg : null;
}

function positionBucket(player) {
  const raw = String(player?.position || player?.pos || "").toUpperCase();
  if (/\bQB\b/.test(raw)) return "QB";
  if (/\bRB\b/.test(raw)) return "RB";
  if (/\bWR\b/.test(raw)) return "WR";
  if (/\bTE\b/.test(raw)) return "TE";
  if (/\b(CB|CORNER)\b/.test(raw)) return "CB";
  if (/\b(FS|SS|S|SAFETY)\b/.test(raw)) return "S";
  if (/\b(LB|ILB|OLB)\b/.test(raw)) return "LB";
  if (/\b(DL|DE|DT|NT|EDGE)\b/.test(raw)) return "DL";
  if (/\bDB\b/.test(raw)) return "DB";
  return raw.split(/[\/,]/)[0] || "?";
}

function unavailable(player) {
  return /OUT|IR|INJURED RESERVE|PUP|NFI|SUSPEND/i.test(String(player?.status || "") + " " + String(player?.injury || "") + " " + String(player?.rosterSlot || ""));
}

function taxi(player) {
  return /TAXI|MINOR/i.test(String(player?.status || "") + " " + String(player?.rosterSlot || ""));
}

function sameDecisionPool(faBucket, rosterPlayer) {
  const rosterBucket = positionBucket(rosterPlayer);
  if (faBucket === "CB" || faBucket === "S") return rosterBucket === faBucket;
  if (faBucket === "DB") return ["CB", "S", "DB"].includes(rosterBucket);
  return rosterBucket === faBucket;
}

function gradeFor(score) {
  if (score >= 92) return "A";
  if (score >= 88) return "A-";
  if (score >= 83) return "B+";
  if (score >= 78) return "B";
  if (score >= 73) return "B-";
  return "PASS";
}

function enhanceRecommendations(payload) {
  const teamId = payload?.workspace?.teamId;
  const teamName = payload?.workspace?.teamName;
  const team = (payload?.teams || []).find((item) => String(item.id) === String(teamId)) ||
    (payload?.teams || []).find((item) => item.name === teamName);
  if (!team) return payload;

  const activeRoster = (team.players || []).filter((player) => !unavailable(player) && !taxi(player));
  const capRoom = number(payload?.myAnalysis?.pillars?.capHealth?.room);

  const enhanced = (payload.recommendations || []).map((rec) => {
    const fa = rec.player || {};
    const faScore = scoreOf(fa);
    const bucket = positionBucket(fa);
    const samePool = activeRoster
      .filter((player) => sameDecisionPool(bucket, player) && scoreOf(player) != null)
      .sort((a, b) => scoreOf(a) - scoreOf(b));
    const replace = samePool[0] || null;
    const replaceScore = replace ? scoreOf(replace) : null;
    const directGain = faScore != null && replaceScore != null ? faScore - replaceScore : null;
    const salary = number(fa.salary);
    const affordable = capRoom == null || salary == null ? null : salary <= capRoom;
    const hasRealUpgrade = directGain == null ? Boolean(rec.lineupGain && rec.lineupGain > 0) : directGain >= 0.5;
    const starterGain = number(rec.lineupGain) || 0;
    const young = number(fa.age) == null ? null : number(fa.age) <= 27;
    const efficient = salary == null || faScore == null ? null : faScore / Math.max(1, salary) >= 0.18;

    let decisionScore = 70;
    if (hasRealUpgrade) decisionScore += 10;
    if (directGain != null) decisionScore += Math.max(-12, Math.min(12, directGain * 2.5));
    if (starterGain > 0) decisionScore += Math.min(8, starterGain * 3);
    if (young === true) decisionScore += 3;
    if (efficient === true) decisionScore += 3;
    if (affordable === false) decisionScore -= 25;
    if (fa.injury || unavailable(fa)) decisionScore -= 10;
    if (!replace && activeRoster.length) decisionScore -= 2;

    const grade = gradeFor(decisionScore);
    const passesThreshold = ["A", "A-", "B+"].includes(grade);
    const verdict = passesThreshold && affordable !== false && hasRealUpgrade ? "PICK UP" : decisionScore >= 76 ? "MONITOR" : "PASS";

    const exactMove = replace
      ? `Roster move: ${verdict === "PICK UP" ? "ADD" : "compare"} ${fa.name} (${faScore == null ? "score unavailable" : faScore.toFixed(1) + " FP/G"}) against ${replace.name} (${replaceScore == null ? "score unavailable" : replaceScore.toFixed(1) + " FP/G"}) — ${directGain == null ? "direct gain unavailable" : (directGain >= 0 ? "+" : "") + directGain.toFixed(1) + " FP/G"}.`
      : `Roster move: ${fa.name} has no scored active ${bucket} counterpart to replace; treat this as depth/optionality, not an automatic add.`;
    const specificity = (bucket === "CB" || bucket === "S")
      ? `Eligibility check: ${fa.name} is evaluated as ${bucket}, so ${bucket === "CB" ? "safeties are not used as the cut comparison" : "cornerbacks are not used as the cut comparison"}.`
      : `Eligibility check: recommendation is evaluated against active ${bucket} players on ${team.name}, not a generic league need.`;
    const threshold = `4-question value test: roster upgrade ${hasRealUpgrade ? "PASS" : "FAIL"}; affordable ${affordable === false ? "FAIL" : affordable === true ? "PASS" : "UNCONFIRMED"}; starter impact ${starterGain > 0 ? "PASS" : "DEPTH ONLY"}; B+ threshold ${passesThreshold ? "PASS" : "FAIL"}.`;
    const capLine = capRoom == null
      ? "Current cap room is unavailable, so the page will not pretend a bid is affordable."
      : `Current live cap room is $${capRoom.toFixed(2)}; any bid still must obey the league's actual waiver/bid rules.`;

    return {
      ...rec,
      verdict,
      action: verdict,
      fit: Math.round(decisionScore * 10) / 10,
      rosterGrade: grade,
      replacementCandidate: replace ? {
        id: replace.id,
        name: replace.name,
        position: replace.position,
        score: replaceScore,
        salary: number(replace.salary),
        rosterSlot: replace.rosterSlot || null
      } : null,
      directRosterGain: directGain,
      fourQuestionTest: {
        rosterUpgrade: hasRealUpgrade,
        affordable,
        starterImpact: starterGain > 0,
        bPlusOrBetter: passesThreshold
      },
      reasons: [exactMove, specificity, threshold, capLine, ...(rec.reasons || [])].slice(0, 5),
      details: [
        `Team-specific grade: ${grade} (${decisionScore.toFixed(1)}/100).`,
        replace ? `First cut/replace comparison: ${replace.name}. This is a comparison target, not an automatic cut.` : `No same-eligibility active replacement candidate was found.`,
        ...(rec.details || [])
      ]
    };
  }).sort((a, b) => {
    const verdictRank = { "PICK UP": 3, "MONITOR": 2, "PASS": 1 };
    return (verdictRank[b.verdict] || 0) - (verdictRank[a.verdict] || 0) || (b.fit || 0) - (a.fit || 0);
  });

  return { ...payload, recommendations: enhanced };
}

async function enhancedNews() {
  try {
    const response = await fetch(ESPN_NEWS, {
      headers: { Accept: "application/json", "User-Agent": "GMSLocker/2.3" },
      cf: { cacheTtl: 60, cacheEverything: true }
    });
    if (!response.ok) return json({ articles: [], error: "ESPN HTTP " + response.status, syncedAt: new Date().toISOString() });

    const data = await response.json();
    const seen = new Set();
    const articles = [];

    for (const article of data.articles || []) {
      const headline = clean(article?.headline);
      if (!headline) continue;
      const link = article?.links?.web?.href || null;
      const key = (link || headline).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const entities = categoryNames(article);
      const baseDescription = clean(article?.description);
      const entitySuffix = entities.length ? " Related: " + entities.join(", ") + "." : "";

      articles.push({
        headline,
        description: (baseDescription + entitySuffix).trim() || null,
        link,
        published: article?.published || article?.lastModified || null,
        entities
      });
    }

    return json({
      articles,
      source: "ESPN NFL",
      syncedAt: new Date().toISOString(),
      count: articles.length
    });
  } catch (error) {
    return json({ articles: [], error: String(error?.message || error), syncedAt: new Date().toISOString() });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/news") return enhancedNews();
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === "GET" && url.pathname === "/league-data" && response.ok) {
      try {
        const payload = await response.clone().json();
        return json(enhanceRecommendations(payload), response.status);
      } catch (_) {
        return response;
      }
    }
    return response;
  }
};
