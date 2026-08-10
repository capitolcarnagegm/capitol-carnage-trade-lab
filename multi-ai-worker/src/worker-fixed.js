import worker from "./worker.js";

const ALLOWED_ORIGINS = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com",
  "https://capitolcarnagegm.github.io",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
]);

const ALLOWED_PROVIDERS = new Set(["gemini", "llama"]);
const MAX_REQUEST_BYTES = 384 * 1024;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 12000;
const MAX_SYSTEM_CHARS = 90000;
const MAX_OUTPUT_TOKENS = 1800;
const DEFAULT_MODELS = {
  gemini: "gemini-3.5-flash-lite",
  llama: "@cf/meta/llama-4-scout-17b-16e-instruct"
};

const GM_SYSTEM_PROMPT = `You are GM's Locker, an elite NFL dynasty franchise operating system.
Your job is to maximize championship equity and long-term asset value, not to agree with the user.
League assumptions supplied in context are authoritative. Never invent roster ownership, salary, contract, draft-pick ownership, scoring rules, projections, or transaction facts.

Operating doctrine:
1. Think like an all-time great football executive and run the franchise with Moneyball discipline.
2. Every proposed move must clear a B+ minimum grade.
3. Every move must pass the four-question value test:
   A. Does this improve championship probability now or create a clearly superior future path?
   B. Are we buying below intrinsic/market value or selling above it?
   C. What is the opportunity cost, including cap, roster spot, picks, replacement value, and future flexibility?
   D. Is there a materially better alternative available or likely to become available?
4. Push back hard on weak assumptions, name uncertainty, and distinguish verified facts from user beliefs/model inference.
5. In superflex, TE premium, IDP/sack-premium formats, account for positional scarcity and scoring-specific replacement value.
6. Prefer current verified NFL information when current-news context is supplied. Never pretend stale model knowledge is current.
7. Give a verdict, grade, reasoning, major risks, and the best alternative when evaluating a move.
8. Never execute a roster-changing action merely because the user asks in chat. Return a proposed action object for the application to validate and confirm.

Truth labels:
- VERIFIED: sourced league/database fact.
- CURRENT: recent external information supplied in context.
- USER THESIS: user's opinion or forecast.
- MODEL INFERENCE: your analytical conclusion.
Keep these categories separate when they matter.`;

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
}

function json(data, status = 200, origin = "") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      ...cors(origin)
    }
  });
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function clampPositiveInt(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

async function readJsonBody(request) {
  if (!request.body) throw httpError("A JSON request body is required", 400);
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw httpError(`Request body must be ${MAX_REQUEST_BYTES} bytes or smaller`, 413);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text);
  } catch {
    throw httpError("Request body must be valid JSON", 400);
  }
}

function cleanMessages(messages = []) {
  return messages
    .filter(message => message && ["user", "assistant"].includes(message.role) && typeof message.content === "string")
    .slice(-MAX_MESSAGES)
    .map(message => ({ role: message.role, content: message.content.slice(0, MAX_MESSAGE_CHARS) }));
}

function publicGeminiContext(context) {
  return {
    asOf: context?.asOf || new Date().toISOString(),
    privacyBoundary: "No private league database, roster ownership, contracts, salaries, team identity, transactions, or draft-pick ownership is included.",
    nflLive: context?.nflLive || null
  };
}

function publicGeminiMemory(memory) {
  const personalization = typeof memory?.personalization === "string" ? memory.personalization.trim().slice(0, 2000) : "";
  return personalization ? { personalization, source: "User-approved Gemini profile" } : null;
}

function buildSystem(context, memory) {
  const blocks = [GM_SYSTEM_PROMPT];
  if (context) blocks.push(`\nCURRENT LEAGUE CONTEXT (treat structured database fields as authoritative):\n${JSON.stringify(context).slice(0, 70000)}`);
  if (memory) blocks.push(`\nPERSISTENT GM MEMORY (may contain user beliefs; preserve truth labels):\n${JSON.stringify(memory).slice(0, 18000)}`);
  return blocks.join("\n").slice(0, MAX_SYSTEM_CHARS);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function authenticate(request, env) {
  if (!env.DB) throw httpError("Private storage is not configured", 503);
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (token.length < 32 || token.length > 200) throw httpError("Sign in required", 401);
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare("SELECT token_hash, expires_at FROM app_sessions WHERE token_hash = ? AND revoked_at IS NULL").bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw httpError("Session expired. Sign in again.", 401);
  return row;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.filter(part => typeof part?.text === "string").map(part => part.text).join("\n").trim();
}

async function callGemini(env, messages, system) {
  if (!env.GEMINI_API_KEY) throw httpError("Gemini is not configured", 503);
  const rawModel = env.GEMINI_MODEL || DEFAULT_MODELS.gemini;
  const model = String(rawModel).replace(/^models\//, "");
  const maxTokens = MAX_OUTPUT_TOKENS;
  const contents = messages.map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));

  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "x-goog-api-key": env.GEMINI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.25
        }
      }),
      signal: AbortSignal.timeout(55000)
    });
  } catch (error) {
    throw httpError(`Gemini connection failed: ${String(error?.message || error).slice(0, 180)}`, 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 429) throw httpError("Gemini free-tier quota is temporarily exhausted.", 429);
    const message = data?.error?.message ? `: ${String(data.error.message).slice(0, 180)}` : "";
    throw httpError(`Gemini request failed with HTTP ${response.status}${message}`, 502);
  }

  const text = extractGeminiText(data);
  if (!text) throw httpError("Gemini returned no text", 502);
  return {
    provider: "gemini",
    model,
    text,
    usage: data.usageMetadata || null
  };
}

async function callLlama(env, messages, system) {
  if (!env.AI?.run) throw httpError("Cloudflare Llama is not configured", 503);
  const model = env.LLAMA_MODEL || DEFAULT_MODELS.llama;
  const maxTokens = clampPositiveInt(env.LLAMA_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
  let data;
  try {
    data = await env.AI.run(model, {
      messages: [{ role: "system", content: system }, ...messages],
      max_tokens: maxTokens,
      temperature: 0.25
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (/quota|limit|neuron|exceeded/i.test(message)) throw httpError("Cloudflare Llama free allocation is temporarily exhausted.", 429);
    throw httpError(`Cloudflare Llama failed: ${message.slice(0, 180)}`, 502);
  }
  const text = String(data?.response || "").trim();
  if (!text) throw httpError("Cloudflare Llama returned no text", 502);
  return { provider: "llama", model, text, usage: data.usage || null };
}

async function fixedChat(request, env, origin) {
  if (!ALLOWED_ORIGINS.has(origin)) throw httpError("Origin not allowed", 403);
  await authenticate(request, env);
  if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) throw httpError("Content-Type must be application/json", 415);

  const body = await readJsonBody(request);
  const messages = cleanMessages(body.messages);
  if (!messages.length || messages[messages.length - 1].role !== "user") throw httpError("A user message is required", 400);

  const requested = String(body.provider || "llama").toLowerCase();
  if (!ALLOWED_PROVIDERS.has(requested)) throw httpError(`Unknown provider mode: ${requested}`, 400);
  if (requested === "gemini" && body.geminiConsent !== true) {
    throw httpError("Gemini requires explicit consent because free-tier content may be used to improve Google products.", 400);
  }

  const context = requested === "gemini" ? publicGeminiContext(body.context || null) : body.context || null;
  const memory = requested === "gemini" ? publicGeminiMemory(body.memory) : body.memory || null;
  const system = buildSystem(context, memory);
  const answer = requested === "gemini"
    ? await callGemini(env, messages, system)
    : await callLlama(env, messages, system);

  return json({ ok: true, mode: requested, routedTo: requested, answer }, 200, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    if (url.pathname === "/gm-chat" && request.method === "POST") {
      try {
        return await fixedChat(request, env, origin);
      } catch (error) {
        const status = Number.isInteger(error?.status) ? error.status : 500;
        console.error(JSON.stringify({ event: "gm_chat_error", status, error: String(error?.message || error) }));
        return json({ ok: false, error: status === 500 ? "Internal service error" : String(error?.message || error) }, status, origin);
      }
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof worker.scheduled === "function") return worker.scheduled(event, env, ctx);
  }
};
