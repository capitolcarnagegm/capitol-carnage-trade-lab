import fullWorker from "./worker-full.js";
import publicWorker from "./worker-public.js";

const LEAGUE_ID = "astbqxhwmk4b6bg9";
const WORKSPACE_ID = "pride-live";
const TEAM_NAME = "Capitol Carnage";
const OWNER_EMAIL = "gmslocker@gmail.com";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "https://gmslocker.com",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
      "Cache-Control": "no-store",
      Vary: "Origin"
    }
  });
}

function workspace(userId = "public-live") {
  return {
    id: WORKSPACE_ID,
    user_id: userId,
    fantrax_league_id: LEAGUE_ID,
    leagueId: LEAGUE_ID,
    league_name: "Pride Dynasty",
    leagueName: "Pride Dynasty",
    team_id: "capitol-carnage",
    teamId: "capitol-carnage",
    team_name: TEAM_NAME,
    teamName: TEAM_NAME,
    settings_json: "{}",
    settings: {}
  };
}

async function ownerRow(realDb) {
  if (!realDb) return { id: "public-live", username: "capitolcarnage", email: OWNER_EMAIL, display_name: TEAM_NAME };
  try {
    const row = await realDb.prepare("SELECT id,username,email,display_name FROM users WHERE lower(email)=? LIMIT 1").bind(OWNER_EMAIL).first();
    if (row) return row;
  } catch {}
  return { id: "public-live", username: "capitolcarnage", email: OWNER_EMAIL, display_name: TEAM_NAME };
}

function virtualDb(realDb) {
  return {
    prepare(sql) {
      const text = String(sql || "");
      if (/FROM\s+user_sessions\s+s\s+JOIN\s+users/i.test(text)) {
        return {
          bind() {
            return {
              async first() {
                const owner = await ownerRow(realDb);
                return {
                  token_hash: "public-live",
                  id: owner.id,
                  username: owner.username || "capitolcarnage",
                  email: owner.email || OWNER_EMAIL,
                  display_name: owner.display_name || TEAM_NAME
                };
              }
            };
          }
        };
      }
      if (/SELECT[\s\S]+FROM\s+user_leagues/i.test(text)) {
        return {
          bind() {
            return {
              async first() {
                const owner = await ownerRow(realDb);
                return workspace(owner.id);
              },
              async all() {
                const owner = await ownerRow(realDb);
                return { results: [workspace(owner.id)] };
              }
            };
          }
        };
      }
      if (/INSERT\s+INTO\s+user_leagues|UPDATE\s+user_leagues/i.test(text)) {
        return { bind() { return { async run() { return { success: true, meta: { changes: 1 } }; } }; } };
      }
      if (!realDb) {
        return {
          bind() {
            return {
              async first() { return null; },
              async all() { return { results: [] }; },
              async run() { return { success: true, meta: { changes: 0 } }; }
            };
          }
        };
      }
      return realDb.prepare(sql);
    }
  };
}

function authenticatedRequest(request) {
  const headers = new Headers(request.headers);
  headers.set("Authorization", "Bearer gms-public-live");
  return new Request(request, { headers });
}

async function delegateFull(request, env, ctx) {
  const wrappedEnv = { ...env, DB: virtualDb(env.DB) };
  return fullWorker.fetch(authenticatedRequest(request), wrappedEnv, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: json({}).headers });

    if (url.pathname === "/auth/login" || url.pathname === "/auth/register") {
      const owner = await ownerRow(env.DB);
      return json({ token: "gms-public-live", user: { id: owner.id, username: owner.username || "capitolcarnage", email: owner.email || OWNER_EMAIL, displayName: owner.display_name || TEAM_NAME, isOwner: true } });
    }
    if (url.pathname === "/auth/logout") return json({ ok: true });
    if (url.pathname === "/auth/me") {
      const owner = await ownerRow(env.DB);
      return json({ user: { id: owner.id, username: owner.username || "capitolcarnage", email: owner.email || OWNER_EMAIL, displayName: owner.display_name || TEAM_NAME, isOwner: true } });
    }
    if (url.pathname === "/account/leagues") {
      const owner = await ownerRow(env.DB);
      return json({ leagues: [workspace(owner.id)] });
    }
    if (url.pathname === "/account/league" && request.method === "POST") {
      const owner = await ownerRow(env.DB);
      return json({ league: workspace(owner.id) });
    }

    if (url.pathname === "/depth-charts" || url.pathname === "/public/pride-league") {
      return publicWorker.fetch(request, env, ctx);
    }

    return delegateFull(request, env, ctx);
  }
};
