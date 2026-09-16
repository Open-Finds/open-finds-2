import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY");
if (!OPENROUTER_API_KEY) {
  console.error("OPENROUTER_API_KEY secret not configured");
}

/**
 * Models this proxy is willing to bill to the account. The model used to come
 * straight from the request body, which let any caller select an arbitrarily
 * expensive model on our tab. Anything not on this list is rejected.
 */
const ALLOWED_MODELS = new Set([
  "openai/gpt-4o-mini:online",
  "openai/gpt-4o-mini",
]);
const DEFAULT_MODEL = "openai/gpt-4o-mini:online";

// Per-user ceilings. Discovery and link extraction are both single calls, so a
// normal session sits far below this; it exists to bound a runaway loop or a
// stolen session rather than to shape ordinary use.
const RATE_LIMIT = 40;
const RATE_WINDOW_SECONDS = 60 * 60;

const MAX_MESSAGES = 20;
const MAX_TOTAL_CHARS = 60_000;

type ChatMessage = { role: string; content: string };

function validateMessages(raw: unknown): { ok: true; messages: ChatMessage[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "messages array is required" };
  if (raw.length === 0) return { ok: false, error: "messages array is empty" };
  if (raw.length > MAX_MESSAGES) return { ok: false, error: `messages exceeds ${MAX_MESSAGES} entries` };

  let total = 0;
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return { ok: false, error: "each message must be an object" };
    const { role, content } = m as Record<string, unknown>;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      return { ok: false, error: "message role must be system, user or assistant" };
    }
    if (typeof content !== "string") return { ok: false, error: "message content must be a string" };
    total += content.length;
    if (total > MAX_TOTAL_CHARS) return { ok: false, error: "messages exceed the size limit" };
    messages.push({ role, content });
  }
  return { ok: true, messages };
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  try {
    // 1. Prove a real signed-in user, not just possession of the public anon key.
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    if (!OPENROUTER_API_KEY) {
      return json(req, { error: "OpenRouter API key not configured" }, 503);
    }

    // 2. Bound spend per user.
    const limit = await consumeRateLimit("ai-proxy", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return json(
        req,
        { error: "Rate limit reached. Try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(req, { error: "A JSON body is required" }, 400);
    }
    const { messages, model, temperature, response_format } = body as Record<string, unknown>;

    const validated = validateMessages(messages);
    if (!validated.ok) return json(req, { error: validated.error }, 400);

    // 3. Only models we have chosen to pay for.
    const requestedModel = typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL;
    if (!ALLOWED_MODELS.has(requestedModel)) {
      return json(req, { error: `Model '${requestedModel}' is not available` }, 400);
    }

    const temp = typeof temperature === "number" && Number.isFinite(temperature)
      ? Math.min(Math.max(temperature, 0), 2)
      : 0;

    const payload: Record<string, unknown> = {
      model: requestedModel,
      messages: validated.messages,
      temperature: temp,
    };
    if (response_format && typeof response_format === "object") {
      payload.response_format = response_format;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": Deno.env.get("SUPABASE_URL") ?? "",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.error("[ai-proxy] upstream error", res.status, text.slice(0, 300));
        // Upstream detail can echo account information, so it is logged but not returned.
        return json(req, { error: `AI request failed (${res.status})` }, res.status);
      }

      const data = await res.json();
      return json(req, data, 200, {
        "X-RateLimit-Remaining": String(limit.remaining),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error("[ai-proxy] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
