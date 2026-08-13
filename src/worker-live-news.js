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

async function enhancedNews() {
  try {
    const response = await fetch(ESPN_NEWS, {
      headers: { Accept: "application/json", "User-Agent": "GMSLocker/2.2" },
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
    return baseWorker.fetch(request, env, ctx);
  }
};
