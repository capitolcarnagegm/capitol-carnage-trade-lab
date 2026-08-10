// Load FIRST — any call to the locked worker Fantrax/news/optimize is rewritten to public APIs
(function () {
  var LEAGUE = "astbqxhwmk4b6bg9";
  var _fetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    var u = "";
    try {
      u = typeof input === "string" ? input : (input && input.url) || "";
    } catch (e) {}

    var isWorker =
      u.indexOf("gms-locker-ai") >= 0 ||
      u.indexOf("workers.dev") >= 0;

    if (!isWorker) return _fetch(input, init);

    // NEWS
    if (u.indexOf("/sports/news") >= 0 || /\/news(\?|$)/.test(u)) {
      try {
        var teamMatch = u.match(/[?&]team(?:Id)?=([^&]+)/);
        var team = teamMatch ? decodeURIComponent(teamMatch[1]) : "";
        var espn = team
          ? "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/" + team + "/news?limit=40"
          : "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=50";
        var er = await _fetch(espn, { cache: "no-store" });
        var ed = await er.json();
        return new Response(
          JSON.stringify({ ok: true, articles: ed.articles || [], source: "ESPN direct", count: (ed.articles || []).length }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // OPTIMIZE — signal client to use local
    if (u.indexOf("/optimize") >= 0) {
      return new Response(JSON.stringify({ ok: false, error: "client-optimize" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }

    // FANTRAX live / sync / health
    if (u.indexOf("/fantrax") >= 0 || u.indexOf("/health") >= 0) {
      try {
        async function fx(ep) {
          var r = await _fetch(
            "https://www.fantrax.com/fxea/general/" + ep + "?leagueId=" + encodeURIComponent(LEAGUE),
            { cache: "no-store", headers: { Accept: "application/json" } }
          );
          if (!r.ok) throw new Error(ep + " HTTP " + r.status);
          return r.json();
        }
        if (u.indexOf("/health") >= 0) {
          return new Response(
            JSON.stringify({ ok: true, service: "GM's Locker v8.1 direct", accessConfigured: false, fantraxConfigured: true }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        var parts = await Promise.all([
          fx("getTeamRosters"),
          fx("getPlayerIds").catch(function () { return {}; }),
          fx("getStandings").catch(function () { return []; }),
          fx("getMatchupScores").catch(function () { return {}; }),
          fx("getDraftPicks").catch(function () { return {}; }),
          fx("getLeagueInfo").catch(function () { return {}; })
        ]);
        var payload = {
          ok: true,
          configured: true,
          syncedAt: new Date().toISOString(),
          source: "Fantrax public API",
          snapshots: {
            rosters: parts[0],
            players: parts[1],
            standings: parts[2],
            matchups: parts[3],
            draftPicks: parts[4],
            league: parts[5]
          },
          leagueId: LEAGUE
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // Anything else on worker (AI chat etc.) — pass through
    return _fetch(input, init);
  };

  console.log("[pride-intercept] worker Fantrax/news calls → direct public APIs");
})();
