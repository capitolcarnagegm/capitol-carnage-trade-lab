import baseWorker from "./worker.js";

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

async function enhancedNews() {
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    Referer: "https://www.espn.com/"
  };
  const urls = [
    "https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50",
    "https://cdn.espn.com/core/nfl/news?xhr=1&limit=50"
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers, cf: { cacheTtl: 60, cacheEverything: true } });
      if (!response.ok) continue;
      const data = await response.json();
      const raw = data.articles || data.content?.articles || data.news?.articles || [];
      const seen = new Set();
      const articles = [];
      for (const article of raw) {
        const headline = clean(article?.headline || article?.title);
        if (!headline) continue;
        const link = article?.links?.web?.href || article?.link || article?.url || null;
        const key = (link || headline).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        articles.push({
          headline,
          description: clean(article?.description || article?.summary) || null,
          link,
          published: article?.published || article?.lastModified || null,
          entities: []
        });
      }
      if (articles.length) {
        return json({ articles, source: "ESPN NFL", syncedAt: new Date().toISOString(), count: articles.length });
      }
    } catch (_) {}
  }
  return json({ articles: [], error: "ESPN news unavailable", syncedAt: new Date().toISOString() });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/news") return enhancedNews();
    return baseWorker.fetch(request, env, ctx);
  }
};
