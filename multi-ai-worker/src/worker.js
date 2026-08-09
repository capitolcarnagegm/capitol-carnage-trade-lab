const ALLOWED_ORIGINS = new Set([
  "https://gmslocker.com",
  "https://www.gmslocker.com",
  "https://capitolcarnagegm.github.io"
]);

const ALLOWED_PROVIDERS = new Set(["auto", "openai", "claude", "grok", "consensus"]);
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 12000;
const MAX_OUTPUT_TOKENS = 6000;

const DEFAULT_MODELS = {
  openai: "gpt-5.6-terra",
  claude: "claude-sonnet-5",
  grok: "grok-4.5"
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
    "Access-Control-Allow-Headers": "Content-Type",
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
      ...cors(origin)
    }
  });
}

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
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
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) }));
}

function buildSystem(context, memory) {
  const blocks = [GM_SYSTEM_PROMPT];
  if (context) blocks.push(`\nCURRENT LEAGUE CONTEXT (treat structured database fields as authoritative):\n${JSON.stringify(context).slice(0, 120000)}`);
  if (memory) blocks.push(`\nPERSISTENT GM MEMORY (may contain user beliefs; preserve truth labels):\n${JSON.stringify(memory).slice(0, 50000)}`);
  return blocks.join("\n");
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === "string") return data.output_text;
  const out = [];
  for (const item of data?.output || []) {
    for (const c of item?.content || []) if (typeof c?.text === "string") out.push(c.text);
  }
  return out.join("\n").trim();
}

async function callOpenAI(env, messages, system, model) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const input = [{ role: "system", content: system }, ...messages];
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.openai,
      input,
      reasoning: { effort: "high" },
      max_output_tokens: MAX_OUTPUT_TOKENS
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${data?.error?.message || "request failed"}`);
  return { provider: "openai", model: data.model || model || DEFAULT_MODELS.openai, text: extractOpenAIText(data), usage: data.usage || null };
}

async function callGrok(env, messages, system, model, conversationKey) {
  if (!env.XAI_API_KEY) throw new Error("XAI_API_KEY is not configured");
  const input = [{ role: "system", content: system }, ...messages];
  const body = {
    model: model || DEFAULT_MODELS.grok,
    input,
    reasoning: { effort: "high" },
    max_output_tokens: MAX_OUTPUT_TOKENS
  };
  if (conversationKey) body.prompt_cache_key = String(conversationKey).slice(0, 128);
  const r = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Grok ${r.status}: ${data?.error?.message || "request failed"}`);
  return { provider: "grok", model: data.model || model || DEFAULT_MODELS.grok, text: extractOpenAIText(data), usage: data.usage || null };
}

async function callClaude(env, messages, system, model) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: model || DEFAULT_MODELS.claude,
      system,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Claude ${r.status}: ${data?.error?.message || "request failed"}`);
  const text = (data.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
  return { provider: "claude", model: data.model || model || DEFAULT_MODELS.claude, text, usage: data.usage || null };
}

async function askProvider(provider, env, messages, system, models, conversationKey) {
  if (provider === "openai") return callOpenAI(env, messages, system, models?.openai);
  if (provider === "claude") return callClaude(env, messages, system, models?.claude);
  if (provider === "grok") return callGrok(env, messages, system, models?.grok, conversationKey);
  throw new Error(`Unknown provider: ${provider}`);
}

function chooseAutoProvider(task = "") {
  const t = task.toLowerCase();
  if (/code|bug|worker|javascript|typescript|deploy|github|cloudflare/.test(t)) return "grok";
  if (/write|rewrite|summar|document|explain/.test(t)) return "claude";
  return "openai";
}

async function consensus(env, messages, system, models, conversationKey) {
  const providers = ["openai", "claude", "grok"];
  const settled = await Promise.allSettled(providers.map(p => askProvider(p, env, messages, system, models, conversationKey)));
  const answers = settled.filter(x => x.status === "fulfilled").map(x => x.value);
  const errors = settled.map((x, i) => x.status === "rejected" ? { provider: providers[i], error: String(x.reason?.message || x.reason) } : null).filter(Boolean);
  if (!answers.length) throw new Error(`All providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join(" | ")}`);
  if (answers.length === 1) return { mode: "consensus", answer: answers[0], panel: answers, errors };

  const judgePrompt = [{
    role: "user",
    content: `You are the final GM decision judge. Compare the candidate analyses below. Resolve disagreements using the supplied league context and GM doctrine. Do not vote by majority. Choose the argument with the strongest evidence/value logic. Return one decisive answer with: VERDICT, GRADE, 4-QUESTION VALUE TEST, WHY, RISKS, BEST ALTERNATIVE, and what evidence would change the decision.\n\nCANDIDATES:\n${answers.map(a => `--- ${a.provider.toUpperCase()} (${a.model}) ---\n${a.text}`).join("\n\n")}`
  }];

  let judge;
  try {
    judge = await callOpenAI(env, judgePrompt, system, models?.judge || models?.openai || DEFAULT_MODELS.openai);
  } catch {
    judge = answers[0];
  }
  return { mode: "consensus", answer: judge, panel: answers, errors };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({
        ok: true,
        service: "GM's Locker Multi-AI Gateway",
        providers: {
          openai: Boolean(env.OPENAI_API_KEY),
          claude: Boolean(env.ANTHROPIC_API_KEY),
          grok: Boolean(env.XAI_API_KEY)
        },
        persistentMemory: Boolean(env.DB),
        defaultModels: DEFAULT_MODELS
      }, 200, origin);
    }

    if (!ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "Origin not allowed" }, 403, origin);
    if (request.method !== "POST" || url.pathname !== "/gm-chat") return json({ ok: false, error: "Not found" }, 404, origin);
    if (!request.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      return json({ ok: false, error: "Content-Type must be application/json" }, 415, origin);
    }

    try {
      const body = await readJsonBody(request);
      const messages = cleanMessages(body.messages);
      if (!messages.length || messages[messages.length - 1].role !== "user") return json({ ok: false, error: "A user message is required" }, 400, origin);

      const system = buildSystem(body.context || null, body.memory || null);
      const requested = String(body.provider || "auto").toLowerCase();
      if (!ALLOWED_PROVIDERS.has(requested)) {
        return json({ ok: false, error: `Unknown provider mode: ${requested}` }, 400, origin);
      }
      const conversationKey = body.conversationId || body.franchiseId || "gms-locker";

      if (requested === "consensus") {
        const result = await consensus(env, messages, system, DEFAULT_MODELS, conversationKey);
        return json({ ok: true, ...result }, 200, origin);
      }

      const provider = requested === "auto" ? chooseAutoProvider(messages[messages.length - 1].content) : requested;
      const answer = await askProvider(provider, env, messages, system, DEFAULT_MODELS, conversationKey);
      return json({ ok: true, mode: requested, routedTo: provider, answer }, 200, origin);
    } catch (e) {
      const status = Number.isInteger(e?.status) ? e.status : 500;
      console.error(JSON.stringify({ event: "gm_chat_error", status, error: String(e?.message || e) }));
      return json({ ok: false, error: String(e?.message || e) }, status, origin);
    }
  }
};
