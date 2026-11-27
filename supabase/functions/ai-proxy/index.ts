import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { stageLog } from "../_shared/stagelog.ts";
import { usageRow } from "../_shared/aiUsage.ts";
import { AI_PROXY, configureStagingProviders, providerFetch, withStagingProviderControls } from "../_shared/stagingProviders.ts";

// Staging only: extraction requests pass the access/budget/ledger controls.
// Everywhere else this is a pass-through. See _shared/stagingProviders.ts.
configureStagingProviders(AI_PROXY);

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

/**
 * AI Save's slide reading sends an Instagram carousel's pictures. Only Instagram's own picture links are accepted
 * (never an arbitrary URL for OpenRouter to fetch), only for link extraction, and at most MAX_IMAGES per request.
 */
const MAX_IMAGES = 6;
const IMAGE_HOSTS = [".cdninstagram.com", ".fbcdn.net"];

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" | "high" | "auto" } };
type ChatMessage = { role: string; content: string | ContentPart[] };

function imagePart(value: Record<string, unknown>): ContentPart | null {
  const image = value.image_url as Record<string, unknown> | undefined;
  if (!image || typeof image.url !== "string" || image.url.length > 2000) return null;
  let url: URL;
  try { url = new URL(image.url); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || !IMAGE_HOSTS.some((host) => url.hostname.endsWith(host))) return null;
  const detail = image.detail === "low" || image.detail === "high" ? image.detail : "auto";
  return { type: "image_url", image_url: { url: url.href, detail } };
}

export function validateMessages(raw: unknown, allowImages = false):
  { ok: true; messages: ChatMessage[]; images: number } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "messages array is required" };
  if (raw.length === 0) return { ok: false, error: "messages array is empty" };
  if (raw.length > MAX_MESSAGES) return { ok: false, error: `messages exceeds ${MAX_MESSAGES} entries` };

  let total = 0;
  let images = 0;
  const messages: ChatMessage[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") return { ok: false, error: "each message must be an object" };
    const { role, content } = m as Record<string, unknown>;
    if (role !== "system" && role !== "user" && role !== "assistant") {
      return { ok: false, error: "message role must be system, user or assistant" };
    }
    if (typeof content === "string") {
      total += content.length;
      if (total > MAX_TOTAL_CHARS) return { ok: false, error: "messages exceed the size limit" };
      messages.push({ role, content });
      continue;
    }
    // Text and pictures together: only a user message, only where pictures are allowed.
    if (!Array.isArray(content) || role !== "user" || !allowImages) return { ok: false, error: "message content must be a string" };
    const parts: ContentPart[] = [];
    for (const part of content) {
      if (!part || typeof part !== "object") return { ok: false, error: "each content part must be an object" };
      const value = part as Record<string, unknown>;
      if (value.type === "text" && typeof value.text === "string") {
        total += value.text.length;
        parts.push({ type: "text", text: value.text });
      } else if (value.type === "image_url") {
        const image = imagePart(value);
        if (!image) return { ok: false, error: "pictures must be Instagram picture links" };
        if (++images > MAX_IMAGES) return { ok: false, error: `at most ${MAX_IMAGES} pictures` };
        parts.push(image);
      } else {
        return { ok: false, error: "content parts must be text or a picture" };
      }
      if (total > MAX_TOTAL_CHARS) return { ok: false, error: "messages exceed the size limit" };
    }
    if (!parts.length) return { ok: false, error: "message content is empty" };
    messages.push({ role, content: parts });
  }
  return { ok: true, messages, images };
}

Deno.serve(withStagingProviderControls("ai-proxy", async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  // Gives back a credit spent on a request that then failed.
  let refundCredit = async () => {};
  const started = Date.now();

  try {
    // 1. Prove a real signed-in user, not just possession of the public anon key.
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    if (!OPENROUTER_API_KEY) {
      return json(req, { error: "OpenRouter API key not configured" }, 503);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json(req, { error: "A JSON body is required" }, 400);
    }
    const { messages, model, temperature, response_format, purpose, use_credit } = body as Record<string, unknown>;
    if (purpose !== "extract" && purpose !== "discover") {
      return json(req, { error: "purpose must be extract or discover" }, 400);
    }

    const validated = validateMessages(messages, purpose === "extract");
    if (!validated.ok) return json(req, { error: validated.error }, 400);

    // Free accounts: 3 link extractions and 3 "Something New" discoveries a day,
    // then one more for each credit they choose to spend (earned by reviewing
    // sponsored venues). Paid accounts keep a high hourly ceiling so a loop
    // cannot run the bill up.
    const purposeName = purpose;
    // A shared ceiling cannot be bypassed by switching purpose or spending credits.
    const hourly = await consumeRateLimit("ai-total", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS, { failClosed: true });
    if (!hourly.available) return json(req, { error: "AI usage checks are temporarily unavailable" }, 503);
    if (!hourly.allowed) return json(req, { error: "Rate limit reached. Try again shortly.", code: "rate_limit" }, 429,
      { "Retry-After": String(hourly.retryAfter) });
    let tier = "free";
    if (purposeName) {
      const db = serviceClient();
      const [{ data: profile }, { data: unlock }] = await Promise.all([
        db.from("profiles").select("subscription_tier").eq("id", auth.user.id).maybeSingle(),
        // Open testing: app_settings.premium_unlocked gives everyone the
        // paid limits (see 20260927140000_premium_unlock_switch).
        db.from("app_settings").select("value").eq("key", "premium_unlocked").maybeSingle(),
      ]);
      tier = unlock?.value === true
        ? "premium_monthly"
        : (profile?.subscription_tier as string | undefined) ?? "free";
    }
    const dailyFree = tier === "free" && purposeName;
    const limit = await consumeRateLimit(
      dailyFree ? `ai-${purposeName}` : "ai-proxy",
      auth.user.id,
      dailyFree ? 3 : RATE_LIMIT,
      dailyFree ? 60 * 60 * 24 : RATE_WINDOW_SECONDS,
      { failClosed: true },
    );
    if (!limit.available) return json(req, { error: "AI usage checks are temporarily unavailable" }, 503);
    let spentCredit = false;
    if (!limit.allowed && dailyFree && use_credit === true) {
      const { data: left, error: spendError } = await serviceClient().rpc("spend_credit", {
        p_user: auth.user.id,
        p_reason: purposeName,
      });
      if (spendError) console.warn("[ai-proxy] spend_credit failed", spendError.message);
      spentCredit = !spendError && typeof left === "number";
    }
    if (spentCredit) {
      refundCredit = async () => {
        refundCredit = async () => {};
        const { error: refundError } = await serviceClient().rpc("refund_credit", { p_user: auth.user.id });
        if (refundError) console.error("[ai-proxy] refund_credit failed", refundError.message);
      };
    }
    if (!limit.allowed && !spentCredit) {
      return json(
        req,
        {
          error: dailyFree
            ? "Free includes 3 of these a day. It resets tomorrow."
            : "Rate limit reached. Try again shortly.",
          code: dailyFree ? "daily_limit" : "rate_limit",
        },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    // 3. Only models we have chosen to pay for.
    const requestedModel = typeof model === "string" && model.trim() ? model.trim() : DEFAULT_MODEL;
    if (!ALLOWED_MODELS.has(requestedModel)) {
      await refundCredit();
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

    // A plain model answers in a few seconds; one with web search needs longer. Neither should hang for minutes.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestedModel.endsWith(":online") ? 30_000 : 20_000);

    try {
      const res = await providerFetch("https://openrouter.ai/api/v1/chat/completions", {
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
        stageLog("ai-proxy", "ai", started, "upstream_error", { status: res.status, model: requestedModel, purpose: purpose as string });
        await refundCredit();
        // Upstream detail can echo account information, so it is logged but not returned.
        return json(req, { error: `AI request failed (${res.status})` }, res.status);
      }

      const data = await res.json();
      // Records what OpenRouter says the call used. Service role: the caller is verified above,
      // and the row only holds OpenRouter's usage figures. A failed write never fails the request.
      const { error: usageError } = await serviceClient()
        .from("ai_usage")
        // Slide reading is logged on its own line ("extract-slides"): pictures cost more than text.
        .insert({ user_id: auth.user.id, ...usageRow(data, validated.images ? `${purposeName}-slides` : purposeName, requestedModel) });
      if (usageError) console.error("[ai-proxy] usage log failed", usageError.message);
      stageLog("ai-proxy", "ai", started, "ok", { model: requestedModel, purpose: purpose as string, online: requestedModel.endsWith(":online") });
      return json(req, data, 200, {
        "X-RateLimit-Remaining": String(limit.remaining),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    stageLog("ai-proxy", "ai", started, err instanceof Error && err.name === "AbortError" ? "timeout" : "internal_error");
    console.error("[ai-proxy] internal error", String(err));
    await refundCredit();
    return json(req, { error: "Internal error" }, 500);
  }
}));
