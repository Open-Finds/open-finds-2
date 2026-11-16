/**
 * Staging controls for paid providers (OpenRouter, Google Maps/Places, page
 * metadata fetches), reconstructed from the code deployed on the staging
 * project crpkzysdtnoomzimibhe, which was never in Git.
 *
 * Source of truth for what staging does today. It reproduces the deployed
 * behaviour on purpose, including its limits (see docs/staging-reference/).
 * Phase 3 changes the policy; this file only records it.
 *
 * Production safety:
 *  - Nothing here runs unless a function calls `configureStagingProviders`.
 *    Other functions that share maps.ts/urlguard.ts are unaffected.
 *  - Even for those functions, everything is a pass-through unless staging is
 *    detected (`guarded()`): the staging project URL, a campaign name, an
 *    activation flag, or APP_ENV=staging. On the production project with none
 *    of those set, `providerFetch` is plain `fetch` and the wrapper just calls
 *    the handler.
 *  - If staging is detected anywhere other than the staging project, it fails
 *    closed (boot error, or 503 `staging_project_mismatch`).
 *
 * The deployed copies differ slightly per function, because each was deployed
 * from a different revision of this file. `StagingVariant` records each.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { requireUser, serviceClient } from "./auth.ts";
import { consumeRateLimit } from "./ratelimit.ts";

export const STAGING_URL = "https://crpkzysdtnoomzimibhe.supabase.co";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

type Flag = "STAGING_PROVIDER_ENABLED" | "STAGING_ANDROID_PROVIDERS_ENABLED" | "STAGING_RESOLVE_PLACE_ENABLED";

export type StagingVariant = {
  /** Setting this flag to "true" puts the function under staging controls (alongside the staging URL). */
  activationFlag: Flag;
  /** This flag must be "true" before a provider request is admitted; otherwise 503 staging_providers_disabled. */
  enableFlag: Flag;
  /**
   * Boot-time check on staging. "general-disabled": STAGING_PROVIDER_ENABLED must be exactly "false".
   * "android-boolean": STAGING_ANDROID_PROVIDERS_ENABLED must be "true" or "false" (default "false").
   */
  startup: "general-disabled" | "android-boolean";
  startupError: string;
  /** Mixes a random value into the request hash, so identical requests are never rejected as duplicates. */
  saltedDigest: boolean;
  /** Only `purpose: "extract"` bodies are admitted (AI Discover is closed). */
  extractPurposeOnly: boolean;
  /** How AI calls are rewritten before they leave the function. */
  ai: "gpt-4o-mini" | "gpt-5-nano-exa";
  /** A failed metadata fetch comes back as an empty 502/504 response instead of throwing. */
  metadataFailureResponse: boolean;
};

const ANDROID: Flag = "STAGING_ANDROID_PROVIDERS_ENABLED";
const GENERAL: Flag = "STAGING_PROVIDER_ENABLED";

export const RESOLVE_PLACE: StagingVariant = {
  activationFlag: GENERAL, enableFlag: "STAGING_RESOLVE_PLACE_ENABLED", startup: "general-disabled",
  startupError: "Staging providers must remain disabled", saltedDigest: false, extractPurposeOnly: false,
  ai: "gpt-4o-mini", metadataFailureResponse: false,
};
export const AI_PROXY: StagingVariant = {
  activationFlag: ANDROID, enableFlag: ANDROID, startup: "general-disabled",
  startupError: "General staging providers must remain disabled", saltedDigest: true, extractPurposeOnly: true,
  ai: "gpt-5-nano-exa", metadataFailureResponse: false,
};
export const EXTRACT_VENUE_META: StagingVariant = {
  activationFlag: ANDROID, enableFlag: ANDROID, startup: "android-boolean",
  startupError: "Invalid Android staging activation", saltedDigest: true, extractPurposeOnly: false,
  ai: "gpt-4o-mini", metadataFailureResponse: true,
};
export const GEOCODE: StagingVariant = {
  activationFlag: ANDROID, enableFlag: ANDROID, startup: "general-disabled",
  startupError: "General staging providers must remain disabled", saltedDigest: false, extractPurposeOnly: false,
  ai: "gpt-4o-mini", metadataFailureResponse: false,
};
/** Deployed discover-venues can never be enabled: its boot check requires the flag it needs to be "true" to be "false". */
export const DISCOVER_VENUES: StagingVariant = {
  activationFlag: GENERAL, enableFlag: GENERAL, startup: "general-disabled",
  startupError: "Staging providers must remain disabled", saltedDigest: false, extractPurposeOnly: false,
  ai: "gpt-4o-mini", metadataFailureResponse: false,
};

type Handler = (req: Request) => Response | Promise<Response>;
type Context = {
  campaign: string;
  requestId: string;
  user: string;
  deadline: number;
  calls: number;
  failed: boolean;
  uncertain: boolean;
  queue: Promise<unknown>;
  signal: AbortSignal;
  dailyAI: number;
  dailyGoogle: number;
};

const scope = new AsyncLocalStorage<Context>();
const env = (key: string): string => Deno.env.get(key) ?? "";
let variant: StagingVariant | null = null;

export const isStagingProviderTarget = (): boolean => env("SUPABASE_URL") === STAGING_URL;

/** Staging is detected. Anything else means pass-through. */
const guarded = (): boolean =>
  env("SUPABASE_URL").includes("crpkzysdtnoomzimibhe") || !!env("STAGING_PROVIDER_CAMPAIGN") ||
  (variant !== null && env(variant.activationFlag) === "true") || env("APP_ENV") === "staging";

/** True only for a function that opted in, on staging. Used to keep other behaviour unchanged. */
export const isStagingControlled = (): boolean => variant !== null && guarded();

/**
 * Opt a function in. Call once at start-up, before serving. On staging it
 * refuses to boot unless the deployment target and activation flags are sane;
 * elsewhere it does nothing.
 */
export function configureStagingProviders(next: StagingVariant): void {
  variant = next;
  if (!guarded()) return;
  if (!isStagingProviderTarget()) throw new Error("Staging deployment target mismatch");
  if (next.startup === "general-disabled") {
    if (env("STAGING_PROVIDER_ENABLED") !== "false") throw new Error(next.startupError);
  } else if (!["false", "true"].includes(Deno.env.get("STAGING_ANDROID_PROVIDERS_ENABLED") ?? "false")) {
    throw new Error(next.startupError);
  }
}

/** Stable JSON so the same request body always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonical(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

class ControlError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}
const failure = (status: number, code: string) => new ControlError(status, code);

function abortable<T>(promise: Promise<T> | T, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(failure(504, "provider_timeout"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function boundedBody(body: ReadableStream<Uint8Array> | null, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const reader = body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw failure(413, "body_too_large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

function setting(name: string, fallback: number, maximum: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw failure(503, "staging_configuration_invalid");
  return value;
}

/** Reserves, counts and releases provider use in the staging_provider_control RPC. */
async function ledger(args: Record<string, unknown>): Promise<void> {
  try {
    const { data, error } = await abortable(serviceClient().rpc("staging_provider_control", args), AbortSignal.timeout(10_000));
    if (error || !data || typeof data.allowed !== "boolean") throw failure(503, "usage_control_unavailable");
    if (!data.allowed) {
      const code = typeof data.code === "string" ? data.code : "";
      if (!["duplicate_request", "campaign_busy", "budget_exhausted", "daily_limit", "invalid_reservation"].includes(code)) {
        throw failure(503, "usage_control_unavailable");
      }
      throw failure(code === "duplicate_request" || code === "campaign_busy" ? 409 : 429, code);
    }
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw failure(503, "usage_control_unavailable");
  }
}

const ledgerArgs = (ctx: Context, action: "start" | "call" | "finish") =>
  ({ p_campaign: ctx.campaign, p_request: ctx.requestId, p_user: ctx.user, p_action: action });

// The wrapper's own error responses use their own CORS copy, which also allows the conversation header.
const stagingHeaders = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Staging-Conversation-Id",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

function corsHeadersFor(req: Request): Record<string, string> {
  const configured = env("ALLOWED_ORIGINS").split(",").map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  if (configured.length === 0) return { ...stagingHeaders, "Access-Control-Allow-Origin": "*" };
  if (origin && configured.includes(origin)) return { ...stagingHeaders, "Access-Control-Allow-Origin": origin };
  return { ...stagingHeaders, "Access-Control-Allow-Origin": configured[0] };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json" },
  });
}

const safeResponse = (req: Request, error: unknown): Response => {
  const known = error instanceof ControlError ? error : failure(502, "provider_unavailable");
  return json(req, { error: "Staging request could not complete. Do not automatically retry.", code: known.code }, known.status);
};

/** Wraps a handler so staging requests pass the access, budget and ledger checks. Elsewhere: the handler, unchanged. */
export function withStagingProviderControls(operation: string, handler: Handler): Handler {
  return async (req: Request): Promise<Response> => {
    const v = variant;
    if (!v || !guarded()) return handler(req);
    let ctx: Context | undefined;
    let reserved = false;
    let response: Response;
    try {
      if (!isStagingProviderTarget()) throw failure(503, "staging_project_mismatch");
      const origins = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
      if (!origins.length || origins.includes("*") || !origins.includes(req.headers.get("origin") ?? "")) {
        throw failure(403, "origin_not_allowed");
      }
      if (req.method === "OPTIONS") return handler(req);
      if (req.method !== "POST") throw failure(405, "method_not_allowed");
      if (operation === "travel-times") throw failure(503, "routing_budget_not_approved");
      const auth = await requireUser(req);
      if (!auth.ok) return json(req, { error: auth.error }, auth.status);
      const users = env("STAGING_PROVIDER_USERS").split(",").map((s) => s.trim()).filter(Boolean);
      if (!users.length || users.some((s) => !UUID.test(s)) || !users.includes(auth.user.id)) {
        throw failure(403, "synthetic_user_required");
      }
      if (env(v.enableFlag) !== "true") throw failure(503, "staging_providers_disabled");
      const campaign = env("STAGING_PROVIDER_CAMPAIGN");
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(campaign)) throw failure(503, "staging_configuration_invalid");
      const minute = await consumeRateLimit(
        "staging-provider-entry", auth.user.id, setting("STAGING_REQUESTS_PER_MINUTE", 6, 6), 60, { failClosed: true },
      );
      if (!minute.available) throw failure(503, "usage_control_unavailable");
      if (!minute.allowed) throw failure(429, "user_rate_limit");
      const bytes = await boundedBody(req.clone().body, 65536, AbortSignal.timeout(5_000));
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw failure(400, "invalid_json");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw failure(400, "invalid_json");
      if (operation === "ai-proxy" && body.use_credit === true) throw failure(400, "staging_credit_spending_disabled");
      if (v.extractPurposeOnly && body.purpose !== "extract") throw failure(403, "staging_extraction_only");
      const hashInput = operation + "\n" + canonical(body) + (v.saltedDigest ? "\n" + crypto.randomUUID() : "");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput))))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      const conversation = operation === "ai-proxy" && body.purpose === "discover" ? req.headers.get("x-staging-conversation-id") : null;
      if (operation === "ai-proxy" && body.purpose === "discover" && (!conversation || !UUID.test(conversation))) {
        throw failure(400, "conversation_id_required");
      }
      ctx = {
        campaign,
        requestId: crypto.randomUUID(),
        user: auth.user.id,
        deadline: Date.now() + 90_000,
        calls: 0,
        failed: false,
        uncertain: false,
        queue: Promise.resolve(),
        signal: AbortSignal.timeout(90_000),
        dailyAI: setting("STAGING_DAILY_AI_PER_USER", 10, 15),
        dailyGoogle: setting("STAGING_DAILY_GOOGLE_PER_USER", 20, 30),
      };
      const active = ctx;
      await ledger({ ...ledgerArgs(active, "start"), p_hash: digest, p_operation: operation, p_conversation: conversation });
      reserved = true;
      response = await scope.run(active, () => abortable(Promise.resolve(handler(req)), active.signal));
      await active.queue;
      if (active.failed) throw failure(502, "provider_unavailable");
    } catch (error) {
      if (ctx) {
        ctx.failed = true;
        if (ctx.signal.aborted && ctx.calls) ctx.uncertain = true;
        await ctx.queue;
      }
      response = safeResponse(req, error);
    }
    if (ctx?.uncertain) return safeResponse(req, failure(503, "campaign_reconciliation_required"));
    if (ctx && reserved) {
      try {
        await ledger({ ...ledgerArgs(ctx, "finish") });
      } catch {
        return safeResponse(req, failure(503, "usage_control_unavailable"));
      }
    }
    return response;
  };
}

type Kind = "ai" | "places" | "geocode" | "metadata";

/** Only these provider endpoints are approved; anything else on those hosts is refused. */
function classify(url: URL): Kind {
  if (url.protocol !== "https:") throw failure(400, "provider_url_not_allowed");
  if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/chat/completions") return "ai";
  if (url.hostname === "places.googleapis.com" && url.pathname === "/v1/places:searchText") return "places";
  if (url.hostname === "maps.googleapis.com" && url.pathname === "/maps/api/geocode/json") return "geocode";
  if (url.hostname === "maps.googleapis.com" || url.hostname === "places.googleapis.com" || url.hostname === "openrouter.ai" ||
    url.hostname.endsWith(".googleapis.com")) throw failure(503, "provider_endpoint_not_approved");
  return "metadata";
}

function aiBody(v: StagingVariant, init: RequestInit): string {
  let payload: { messages?: unknown; response_format?: unknown };
  try {
    payload = JSON.parse(String(init.body));
  } catch {
    throw failure(400, "invalid_ai_request");
  }
  const messages = payload.messages;
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 ||
    messages.some((m) => !m || !["user", "system", "assistant"].includes(m.role) || typeof m.content !== "string") ||
    new TextEncoder().encode(JSON.stringify(messages)).length > 8e3) throw failure(413, "ai_input_limit");
  const responseFormat = payload.response_format ? { response_format: { type: "json_object" } } : {};
  if (v.ai === "gpt-5-nano-exa") {
    return JSON.stringify({
      model: "openai/gpt-5-nano",
      messages,
      max_tokens: 1024,
      reasoning: { effort: "minimal" },
      plugins: [{ id: "web", engine: "exa", max_results: 2 }],
      provider: { allow_fallbacks: false },
      ...responseFormat,
    });
  }
  return JSON.stringify({
    model: "openai/gpt-4o-mini",
    messages,
    temperature: 0,
    max_tokens: 1024,
    provider: { allow_fallbacks: false },
    ...responseFormat,
  });
}

/**
 * `fetch` for anything that can cost money or reach a provider. On staging it
 * counts every call against the request's reservation and the daily limits,
 * caps the call count, bounds time and size, and refuses unapproved endpoints.
 * Elsewhere, and for functions that did not opt in, it is plain `fetch`.
 */
export async function providerFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const v = variant;
  if (!v || !guarded()) return fetch(input, init);
  const ctx = scope.getStore();
  if (!ctx || !isStagingProviderTarget()) throw failure(503, "provider_context_required");
  const work = ctx.queue.then(async () => {
    if (ctx.failed || ctx.signal.aborted || Date.now() >= ctx.deadline) throw failure(504, "provider_timeout");
    if (++ctx.calls > 8) throw failure(429, "request_call_limit");
    const url = new URL(input);
    const kind = classify(url);
    let options: RequestInit = { ...init };
    if (kind === "ai") options = { ...options, body: aiBody(v, init) };
    await ledger({ ...ledgerArgs(ctx, "call"), p_kind: kind, p_daily_ai: ctx.dailyAI, p_daily_google: ctx.dailyGoogle });
    const timeout = AbortSignal.timeout(kind === "ai" ? 45_000 : 10_000);
    const signal = AbortSignal.any([ctx.signal, timeout, ...(init.signal ? [init.signal] : [])]);
    options.signal = signal;
    options.redirect = "manual";
    try {
      if (signal.aborted) throw failure(504, "provider_timeout");
      const res = await abortable(fetch(input, options), signal);
      if (!res.ok && !(kind === "metadata" && res.status >= 300 && res.status < 400)) {
        void res.body?.cancel().catch(() => {});
        throw failure(502, "provider_unavailable");
      }
      const bytes = await boundedBody(res.body, kind === "metadata" ? 524288 : 262144, signal);
      if (signal.aborted) throw failure(504, "provider_timeout");
      if (kind !== "metadata") {
        let data: { error?: unknown; status?: string };
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw failure(502, "provider_response_invalid");
        }
        if (data.error || (kind === "geocode" && !["OK", "ZERO_RESULTS"].includes(data.status ?? ""))) {
          throw failure(502, "provider_unavailable");
        }
      }
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(res.status === 204 || res.status === 304 ? null : bytes, { status: res.status, headers });
    } catch (error) {
      // Metadata dispatches are counted at reservation and can fall back after a transport failure.
      if (v.metadataFailureResponse && kind === "metadata") return new Response(null, { status: signal.aborted ? 504 : 502 });
      if (!(error instanceof ControlError) || signal.aborted || error.code === "body_too_large") ctx.uncertain = true;
      throw failure(signal.aborted ? 504 : 502, signal.aborted ? "provider_timeout" : "provider_unavailable");
    }
  });
  ctx.queue = work.then(() => {}, () => {
    ctx.failed = true;
  });
  return work;
}
