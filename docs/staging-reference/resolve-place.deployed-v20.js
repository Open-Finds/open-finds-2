// deployed:resolve-place
import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "npm:@supabase/supabase-js@2";
if (Deno.env.get("SUPABASE_URL") !== "https://crpkzysdtnoomzimibhe.supabase.co") throw new Error("Staging deployment target mismatch");
if (Deno.env.get("STAGING_PROVIDER_ENABLED") !== "false") throw new Error("Staging providers must remain disabled");
async function requireUser(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKey = req.headers.get("apikey") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (token === anonKey || apiKey && token === apiKey) {
    return { ok: false, status: 401, error: "A signed-in user session is required" };
  }
  const client = createClient(
    Deno.env.get("SUPABASE_URL"),
    anonKey,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Invalid or expired session" };
  }
  return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
}
function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
}
async function consumeRateLimit(bucket, subject, limit, windowSeconds, options = {}) {
  const unavailable = () => ({
    allowed: !options.failClosed,
    remaining: options.failClosed ? 0 : limit,
    retryAfter: options.failClosed ? 60 : 0,
    available: false
  });
  try {
    const { data, error } = await serviceClient().rpc("consume_rate_limit", {
      p_key: `${bucket}:${subject}`,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });
    if (error || !data) {
      console.warn("[ratelimit] check failed", error?.message);
      return unavailable();
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") return unavailable();
    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      retryAfter: Number(row.retry_after ?? windowSeconds),
      available: true
    };
  } catch (err) {
    console.warn("[ratelimit] threw", String(err));
    return unavailable();
  }
}
var configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
var BASE_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Staging-Conversation-Id",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin"
};
function corsHeadersFor(req) {
  const origin = req.headers.get("Origin") ?? "";
  if (configured.length === 0) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": "*" };
  }
  if (origin && configured.includes(origin)) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": configured[0] };
}
function json(req, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json", ...extra }
  });
}
var STAGING_URL = "https://crpkzysdtnoomzimibhe.supabase.co";
var UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
var scope = new AsyncLocalStorage();
var env = (key) => Deno.env.get(key) ?? "";
var isStagingProviderTarget = () => env("SUPABASE_URL") === STAGING_URL;
var guarded = () => env("SUPABASE_URL").includes("crpkzysdtnoomzimibhe") || !!env("STAGING_PROVIDER_CAMPAIGN") || env("STAGING_PROVIDER_ENABLED") === "true" || env("APP_ENV") === "staging";
function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  return JSON.stringify(value);
}
var ControlError = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
var failure = (status, code) => new ControlError(status, code);
function abortable(promise, signal) {
  return new Promise((resolve2, reject) => {
    const abort = () => reject(failure(504, "provider_timeout"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise).then(resolve2, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
async function boundedBody(body, maximum, signal) {
  const reader = body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  try {
    for (; ; ) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > maximum) throw failure(413, "body_too_large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {
    });
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
function setting(name, fallback, maximum) {
  const raw = env(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw failure(503, "staging_configuration_invalid");
  return value;
}
async function ledger(args2) {
  try {
    const { data, error } = await abortable(serviceClient().rpc("staging_provider_control", args2), AbortSignal.timeout(1e4));
    if (error || !data || typeof data.allowed !== "boolean") throw failure(503, "usage_control_unavailable");
    if (!data.allowed) {
      const code = typeof data.code === "string" ? data.code : "";
      if (!["duplicate_request", "campaign_busy", "budget_exhausted", "daily_limit", "invalid_reservation"].includes(code)) throw failure(503, "usage_control_unavailable");
      throw failure(code === "duplicate_request" || code === "campaign_busy" ? 409 : 429, code);
    }
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw failure(503, "usage_control_unavailable");
  }
}
var args = (ctx, action) => ({ p_campaign: ctx.campaign, p_request: ctx.requestId, p_user: ctx.user, p_action: action });
var safeResponse = (req, error) => {
  const known = error instanceof ControlError ? error : failure(502, "provider_unavailable");
  return json(req, { error: "Staging request could not complete. Do not automatically retry.", code: known.code }, known.status);
};
function withStagingProviderControls(operation, handler) {
  return async (req) => {
    if (!guarded()) return handler(req);
    let ctx;
    let reserved = false;
    let response;
    try {
      if (!isStagingProviderTarget()) throw failure(503, "staging_project_mismatch");
      const origins = env("ALLOWED_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
      if (!origins.length || origins.includes("*") || !origins.includes(req.headers.get("origin") ?? "")) throw failure(403, "origin_not_allowed");
      if (req.method === "OPTIONS") return handler(req);
      if (req.method !== "POST") throw failure(405, "method_not_allowed");
      if (operation === "travel-times") throw failure(503, "routing_budget_not_approved");
      const auth = await requireUser(req);
      if (!auth.ok) return json(req, { error: auth.error }, auth.status);
      const users = env("STAGING_PROVIDER_USERS").split(",").map((s) => s.trim()).filter(Boolean);
      if (!users.length || users.some((s) => !UUID.test(s)) || !users.includes(auth.user.id)) throw failure(403, "synthetic_user_required");
      if (env("STAGING_RESOLVE_PLACE_ENABLED") !== "true") throw failure(503, "staging_providers_disabled");
      const campaign = env("STAGING_PROVIDER_CAMPAIGN");
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(campaign)) throw failure(503, "staging_configuration_invalid");
      const minute = await consumeRateLimit(
        "staging-provider-entry",
        auth.user.id,
        setting("STAGING_REQUESTS_PER_MINUTE", 6, 6),
        60,
        { failClosed: true }
      );
      if (!minute.available) throw failure(503, "usage_control_unavailable");
      if (!minute.allowed) throw failure(429, "user_rate_limit");
      const bytes = await boundedBody(req.clone().body, 65536, AbortSignal.timeout(5e3));
      let body;
      try {
        body = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw failure(400, "invalid_json");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) throw failure(400, "invalid_json");
      if (operation === "ai-proxy" && body.use_credit === true) throw failure(400, "staging_credit_spending_disabled");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operation + "\n" + canonical(body))))).map((b) => b.toString(16).padStart(2, "0")).join("");
      const conversation = operation === "ai-proxy" && body.purpose === "discover" ? req.headers.get("x-staging-conversation-id") : null;
      if (operation === "ai-proxy" && body.purpose === "discover" && (!conversation || !UUID.test(conversation))) throw failure(400, "conversation_id_required");
      ctx = {
        campaign,
        requestId: crypto.randomUUID(),
        user: auth.user.id,
        deadline: Date.now() + 9e4,
        calls: 0,
        failed: false,
        uncertain: false,
        queue: Promise.resolve(),
        signal: AbortSignal.timeout(9e4),
        dailyAI: setting("STAGING_DAILY_AI_PER_USER", 10, 15),
        dailyGoogle: setting("STAGING_DAILY_GOOGLE_PER_USER", 20, 30)
      };
      await ledger({ ...args(ctx, "start"), p_hash: digest, p_operation: operation, p_conversation: conversation });
      reserved = true;
      response = await scope.run(ctx, () => abortable(handler(req), ctx.signal));
      await ctx.queue;
      if (ctx.failed) throw failure(502, "provider_unavailable");
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
        await ledger({ ...args(ctx, "finish") });
      } catch {
        return safeResponse(req, failure(503, "usage_control_unavailable"));
      }
    }
    return response;
  };
}
function classify(url) {
  if (url.protocol !== "https:") throw failure(400, "provider_url_not_allowed");
  if (url.hostname === "openrouter.ai" && url.pathname === "/api/v1/chat/completions") return "ai";
  if (url.hostname === "places.googleapis.com" && url.pathname === "/v1/places:searchText") return "places";
  if (url.hostname === "maps.googleapis.com" && url.pathname === "/maps/api/geocode/json") return "geocode";
  if (url.hostname === "maps.googleapis.com" || url.hostname === "places.googleapis.com" || url.hostname === "openrouter.ai" || url.hostname.endsWith(".googleapis.com")) throw failure(503, "provider_endpoint_not_approved");
  return "metadata";
}
async function providerFetch(input, init = {}) {
  if (!guarded()) return fetch(input, init);
  const ctx = scope.getStore();
  if (!ctx || !isStagingProviderTarget()) throw failure(503, "provider_context_required");
  const work = ctx.queue.then(async () => {
    if (ctx.failed || ctx.signal.aborted || Date.now() >= ctx.deadline) throw failure(504, "provider_timeout");
    if (++ctx.calls > 8) throw failure(429, "request_call_limit");
    const url = new URL(input);
    const kind = classify(url);
    let options = { ...init };
    if (kind === "ai") {
      let payload;
      try {
        payload = JSON.parse(String(init.body));
      } catch {
        throw failure(400, "invalid_ai_request");
      }
      const messages = payload.messages;
      if (!Array.isArray(messages) || messages.length < 1 || messages.length > 20 || messages.some((m) => !m || !["user", "system", "assistant"].includes(m.role) || typeof m.content !== "string") || new TextEncoder().encode(JSON.stringify(messages)).length > 8e3) throw failure(413, "ai_input_limit");
      options = { ...options, body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        messages,
        temperature: 0,
        max_tokens: 1024,
        provider: { allow_fallbacks: false },
        ...payload.response_format ? { response_format: { type: "json_object" } } : {}
      }) };
    }
    await ledger({ ...args(ctx, "call"), p_kind: kind, p_daily_ai: ctx.dailyAI, p_daily_google: ctx.dailyGoogle });
    const timeout = AbortSignal.timeout(kind === "ai" ? 45e3 : 1e4);
    options.signal = AbortSignal.any([ctx.signal, timeout, ...init.signal ? [init.signal] : []]);
    options.redirect = "manual";
    try {
      if (options.signal.aborted) throw failure(504, "provider_timeout");
      const res = await abortable(fetch(input, options), options.signal);
      if (!res.ok && !(kind === "metadata" && res.status >= 300 && res.status < 400)) {
        void res.body?.cancel().catch(() => {
        });
        throw failure(502, "provider_unavailable");
      }
      const bytes = await boundedBody(res.body, kind === "metadata" ? 524288 : 262144, options.signal);
      if (options.signal.aborted) throw failure(504, "provider_timeout");
      if (kind !== "metadata") {
        let data;
        try {
          data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          throw failure(502, "provider_response_invalid");
        }
        if (data.error || kind === "geocode" && !["OK", "ZERO_RESULTS"].includes(data.status)) throw failure(502, "provider_unavailable");
      }
      const headers = new Headers(res.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(res.status === 204 || res.status === 304 ? null : bytes, { status: res.status, headers });
    } catch (error) {
      if (!(error instanceof ControlError) || options.signal.aborted || error.code === "body_too_large") ctx.uncertain = true;
      throw failure(options.signal.aborted ? 504 : 502, options.signal.aborted ? "provider_timeout" : "provider_unavailable");
    }
  });
  ctx.queue = work.then(() => {
  }, () => {
    ctx.failed = true;
  });
  return work;
}

// supabase/functions/_shared/cors.ts
var configured2 = (Deno.env.get("ALLOWED_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
var BASE_HEADERS2 = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin"
};
function corsHeadersFor2(req) {
  const origin = req.headers.get("Origin") ?? "";
  if (configured2.length === 0) {
    return { ...BASE_HEADERS2, "Access-Control-Allow-Origin": "*" };
  }
  if (origin && configured2.includes(origin)) {
    return { ...BASE_HEADERS2, "Access-Control-Allow-Origin": origin };
  }
  return { ...BASE_HEADERS2, "Access-Control-Allow-Origin": configured2[0] };
}
function preflight(req) {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeadersFor2(req) });
}
function json2(req, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor2(req), "Content-Type": "application/json", ...extra }
  });
}

// supabase/functions/_shared/auth.ts
import { createClient as createClient2 } from "npm:@supabase/supabase-js@2";
async function requireUser2(req) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const apiKey = req.headers.get("apikey") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false, status: 401, error: "Authentication required" };
  }
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (token === anonKey || apiKey && token === apiKey) {
    return { ok: false, status: 401, error: "A signed-in user session is required" };
  }
  const client = createClient2(
    Deno.env.get("SUPABASE_URL"),
    anonKey,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    return { ok: false, status: 401, error: "Invalid or expired session" };
  }
  return { ok: true, user: { id: data.user.id, email: data.user.email ?? null } };
}
function serviceClient2() {
  return createClient2(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
}

// supabase/functions/_shared/ratelimit.ts
async function consumeRateLimit2(bucket, subject, limit, windowSeconds, options = {}) {
  const unavailable = () => ({
    allowed: !options.failClosed,
    remaining: options.failClosed ? 0 : limit,
    retryAfter: options.failClosed ? 60 : 0,
    available: false
  });
  try {
    const { data, error } = await serviceClient2().rpc("consume_rate_limit", {
      p_key: `${bucket}:${subject}`,
      p_limit: limit,
      p_window_seconds: windowSeconds
    });
    if (error || !data) {
      console.warn("[ratelimit] check failed", error?.message);
      return unavailable();
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.allowed !== "boolean") return unavailable();
    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      retryAfter: Number(row.retry_after ?? windowSeconds),
      available: true
    };
  } catch (err) {
    console.warn("[ratelimit] threw", String(err));
    return unavailable();
  }
}

// supabase/functions/_shared/maps.ts
async function getGoogleMapsApiKey() {
  const { data, error } = await serviceClient2().from("app_secrets").select("value").eq("key", "GOOGLE_MAPS_API_KEY").maybeSingle();
  if (error || !data) throw new Error("Google Maps API key not found");
  return data.value;
}
function logGoogleError(where, data) {
  console.error(`[${where}] Google returned ${data.status}: ${data.error_message ?? "(no message)"}`);
}
var AU_POSTCODE = /^\d{4}$/;
async function geocodeAU(address, apiKey) {
  const text = address.trim();
  const query = AU_POSTCODE.test(text) ? `components=${encodeURIComponent(`postal_code:${text}|country:AU`)}` : `address=${encodeURIComponent(text)}&region=au`;
  const lang = "&language=en";
  try {
    const res = await providerFetch(`https://maps.googleapis.com/maps/api/geocode/json?${query}${lang}&key=${apiKey}`);
    if (!res.ok) return { coord: null, status: "FETCH_FAILED", formattedAddress: null };
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") logGoogleError("geocode", data);
    const top = data?.results?.[0];
    const loc = top?.geometry?.location;
    if (data.status === "OK" && typeof loc?.lat === "number" && typeof loc?.lng === "number") {
      return {
        coord: { lat: loc.lat, lng: loc.lng },
        status: "OK",
        formattedAddress: top.formatted_address ?? null,
        types: Array.isArray(top.types) ? top.types : []
      };
    }
    return { coord: null, status: data.status ?? "UNKNOWN", formattedAddress: null };
  } catch {
    return { coord: null, status: "FETCH_FAILED", formattedAddress: null };
  }
}

// supabase/functions/resolve-place/index.ts
var EMPTY = { name: null, address: null, lat: null, lon: null };
function isGoogleDomain(host) {
  return /^(?:[a-z0-9-]+\.)*google\.(?:com|co)(?:\.[a-z]{2})?$/.test(host) || /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}$/.test(host);
}
var SHORT_HOSTS = /* @__PURE__ */ new Set(["maps.app.goo.gl", "goo.gl", "g.co", "share.google"]);
function isMapsUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === "maps.app.goo.gl" || host === "share.google") return true;
    if (host === "goo.gl") return u.pathname.startsWith("/maps");
    if (host === "g.co") return u.pathname.startsWith("/kgs");
    if (!isGoogleDomain(host)) return false;
    if (u.pathname === "/search" && u.searchParams.has("kgmid")) return true;
    return host.startsWith("maps.") || u.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}
function shareGoogleTarget(u) {
  const id = u.hostname === "share.google" ? u.pathname.replace(/^\/+/, "").split("/")[0] : u.pathname === "/share.google" ? u.searchParams.get("q") : null;
  return id && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? `https://www.google.com.au/share.google?q=${id}` : null;
}
async function expandShortLink(raw, strict = false) {
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    let u;
    try {
      u = new URL(current);
    } catch {
      return current;
    }
    if (strict && (u.protocol !== "https:" || u.username || u.password || u.port)) return "";
    const host = u.hostname.toLowerCase();
    if (!SHORT_HOSTS.has(host) && !isGoogleDomain(host)) return current;
    if (host.startsWith("consent.")) {
      const target = u.searchParams.get("continue");
      if (!target) return current;
      current = target;
      continue;
    }
    if (u.pathname === "/url" && u.searchParams.get("q")?.startsWith("https://")) {
      current = u.searchParams.get("q");
      continue;
    }
    const share = shareGoogleTarget(u);
    if (share && share !== current) {
      current = share;
      continue;
    }
    if (!SHORT_HOSTS.has(host) && !share) return current;
    try {
      const res = await providerFetch(current, {
        redirect: "manual",
        signal: strict ? AbortSignal.timeout(5e3) : void 0,
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1" }
      });
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (strict && (res.status === 429 || res.status >= 500)) throw new Error("Maps link could not be reached");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
    } catch (err) {
      if (strict) throw err;
      console.error("[resolve-place] could not follow short link", String(err));
    }
    return current;
  }
  return current;
}
function extractCoords(url) {
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query)=(-?\d{1,3}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /[?&]center=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}
function extractPlaceName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    for (const marker of ["place", "search"]) {
      const idx = parts.indexOf(marker);
      if (idx >= 0 && idx + 1 < parts.length && !parts[idx + 1].startsWith("@")) {
        const name = decodeURIComponent(parts[idx + 1].replace(/\+/g, " ")).trim();
        if (name && !/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(name)) return name;
      }
    }
    for (const key of ["q", "query"]) {
      const q = u.searchParams.get(key)?.trim();
      if (q && !/^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test(q)) return q;
    }
    return null;
  } catch {
    return null;
  }
}
function extractPlaceId(url) {
  try {
    const id = new URL(url).searchParams.get("query_place_id");
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
function displayName(query) {
  return query.split(",")[0].trim() || query;
}
var BAR_TYPES = /* @__PURE__ */ new Set(["bar", "pub", "wine_bar", "cocktail_bar", "night_club", "brewery", "brewpub", "beer_garden", "lounge_bar", "sports_bar", "irish_pub", "winery"]);
var DESSERT_TYPES = /* @__PURE__ */ new Set(["dessert_shop", "dessert_restaurant", "ice_cream_shop", "bakery", "confectionery", "chocolate_shop", "cake_shop", "donut_shop", "candy_store", "pastry_shop"]);
var ACTIVITY_TYPES = /* @__PURE__ */ new Set([
  "amusement_center",
  "amusement_park",
  "bowling_alley",
  "escape_room",
  "video_arcade",
  "karaoke",
  "miniature_golf_course",
  "golf_course",
  "tourist_attraction",
  "museum",
  "art_gallery",
  "movie_theater",
  "zoo",
  "aquarium",
  "park",
  "national_park",
  "casino",
  "event_venue",
  "performing_arts_theater",
  "concert_hall",
  "sports_complex",
  "stadium",
  "spa",
  "water_park",
  "botanical_garden",
  "hiking_area",
  "ice_skating_rink",
  "go_karting_venue",
  "paintball_center",
  "skateboard_park"
]);
function venueTypeFrom(types) {
  for (const t of types) {
    if (!t) continue;
    if (DESSERT_TYPES.has(t) || /gelato|ice_cream|dessert/.test(t)) return "dessert";
    if (BAR_TYPES.has(t)) return "bar";
    if (ACTIVITY_TYPES.has(t)) return "activity";
    if (t === "restaurant" || t === "cafe" || t === "coffee_shop" || t === "bar_and_grill" || t.endsWith("_restaurant") || t === "meal_takeaway" || t === "meal_delivery" || t === "food" || t === "sandwich_shop" || t === "diner") return "food";
  }
  return null;
}
async function searchPlaces(query, near, apiKey, pageSize) {
  const body = { textQuery: query, languageCode: "en", regionCode: "AU", pageSize };
  if (near) {
    body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 500 } };
  }
  const res = await providerFetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1e4)
  });
  if (!res.ok) throw new Error(`Places search returned ${res.status}`);
  const data = await res.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  return places.map((p) => ({
    id: p.id ?? null,
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
    lon: typeof p.location?.longitude === "number" ? p.location.longitude : null,
    type: venueTypeFrom([p.primaryType, ...Array.isArray(p.types) ? p.types : []]),
    outdoor: [p.primaryType, ...Array.isArray(p.types) ? p.types : []].some((type) => ["hiking_area", "park", "national_park", "beach"].includes(type))
  }));
}
async function placesTextSearch(query, near, apiKey) {
  try {
    const [place] = await searchPlaces(query, near, apiKey, 1);
    return place ? { name: place.name, address: place.address, lat: place.lat, lon: place.lon, type: place.type } : null;
  } catch (err) {
    console.error("[resolve-place] Places API failed", String(err));
    return null;
  }
}
function addressKey(address) {
  return address.toLowerCase().replace(/,\s*australia\s*$/, "").replace(/[.,]/g, " ").replace(/\b(street|road|avenue|highway|drive)\b/g, (suffix) => ({
    street: "st",
    road: "rd",
    avenue: "ave",
    highway: "hwy",
    drive: "dr"
  })[suffix] ?? suffix).replace(/\s+/g, " ").trim();
}
var australianStreetTypes = {
  street: "st",
  road: "rd",
  avenue: "ave",
  highway: "hwy",
  drive: "dr",
  place: "pl",
  lane: "ln",
  terrace: "tce",
  parade: "pde",
  crescent: "cres",
  court: "ct",
  close: "cl",
  circuit: "cct",
  boulevard: "bvd",
  square: "sq"
};
function australianStreetAddress(value) {
  const parts = value.trim().match(/^((?:(?:(?:shop|unit|suite)\s+)?\d+\s*[a-z]?\s*\/\s*)?\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s+[^,]+),\s*([^,]+?),?\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)(?:\s+(\d{4}))?(?:,?\s+Australia)?$/i);
  if (!parts) return null;
  const [, street, suburb, state, postcode] = parts;
  const componentKey = (part) => part.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const unitPrefix = street.match(/^(?:(?:shop|unit|suite)\s+)?(\d+\s*[a-z]?)\s*\/\s*/i);
  const unit = unitPrefix?.[1].replace(/\s/g, "").toLowerCase();
  const streetKey = componentKey(street.slice(unitPrefix?.[0].length ?? 0)).replace(/(\d[a-z]?)\s*([-\/])\s*(?=\d)/g, "$1$2").replace(/\b[a-z]+$/, (suffix) => australianStreetTypes[suffix] ?? suffix);
  return { street: streetKey, unit, suburb: componentKey(suburb), state: state.toUpperCase(), postcode };
}
function matchesStreetAddress(source, found, sourceBacked) {
  const expected = australianStreetAddress(source);
  const actual = australianStreetAddress(found);
  if (!expected || !actual) return addressKey(source) === addressKey(found);
  return expected.street === actual.street && expected.suburb === actual.suburb && expected.state === actual.state && expected.unit === actual.unit && (expected.postcode === actual.postcode || sourceBacked && !expected.postcode);
}
function nameKey(name) {
  const normal = name.normalize("NFKC");
  const alias = normal.match(/^(.+?)\s*\(([A-Za-z][A-Za-z .-]*)\)$/);
  const base = alias && /[^\p{Script=Latin}\p{P}\p{Z}\p{N}]/u.test(alias[1]) ? alias[1] : normal;
  return base.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
async function resolverMapsKey() {
  if (Deno.env.get("SUPABASE_URL") === "https://crpkzysdtnoomzimibhe.supabase.co") {
    const stagingKey = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
    if (stagingKey) return stagingKey;
  }
  return getGoogleMapsApiKey();
}
async function verifyPlace(input, apiKey, diagnostics) {
  let { name } = input;
  const { address } = input;
  let pin = null;
  let placeId = null;
  if (input.url) {
    const fullUrl = await expandShortLink(input.url, true);
    if (!isMapsUrl(fullUrl)) return null;
    const url = new URL(fullUrl);
    const exactPin = fullUrl.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    placeId = extractPlaceId(fullUrl);
    if (url.pathname.startsWith("/maps/place/") && exactPin) {
      pin = { lat: Number(exactPin[1]), lng: Number(exactPin[2]) };
      if (Math.abs(pin.lat) > 90 || Math.abs(pin.lng) > 180) return null;
    }
    if (!placeId && !pin) return null;
    name = extractPlaceName(fullUrl) ?? void 0;
  }
  if (!name || !placeId && !pin && !address) return null;
  const expectedName = nameKey(name);
  if (!expectedName) return null;
  const fullStreet = !!address && (!!australianStreetAddress(address) || /^\s*(?:[^,]{0,30},\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?\s+[^,]+,\s*\S/i.test(address));
  const outdoorArea = input.outdoor && !!address && address.replace(/,\s*Australia\s*$/i, "").includes(",");
  if (!placeId && !pin && !fullStreet && !outdoorArea) return null;
  const query = address ? `${name}, ${address}` : name;
  if (diagnostics) diagnostics.query = query;
  const places = await searchPlaces(query, pin, apiKey, 5);
  const ambiguousName = !placeId && !pin && !input.addressFromSource && places.filter((place2) => place2.name && nameKey(place2.name) === expectedName).length > 1;
  const compare = (place2) => {
    if (!place2.name || !place2.address || place2.lat == null || place2.lon == null || !Number.isFinite(place2.lat) || !Number.isFinite(place2.lon) || Math.abs(place2.lat) > 90 || Math.abs(place2.lon) > 180) return "missing_or_invalid_place_data";
    if (placeId) return place2.id === placeId ? "match" : "place_id_mismatch";
    if (nameKey(place2.name) !== expectedName) return "name_mismatch";
    if (pin) return kmBetween(pin, { lat: place2.lat, lng: place2.lon }) <= 0.1 ? "match" : "pin_mismatch";
    if (!address) return "missing_source_address";
    if (fullStreet) return matchesStreetAddress(address, place2.address, input.addressFromSource === true) ? "match" : "street_address_mismatch";
    if (!outdoorArea || !place2.outdoor) return "not_an_outdoor_listing";
    const expected = addressKey(address);
    const actual = addressKey(place2.address);
    const sameLocality = expected === actual || input.addressFromSource && /\b(?:act|nsw|nt|qld|sa|tas|vic|wa)$/.test(expected) && expected === actual.replace(/ \d{4}$/, "");
    return sameLocality ? "match" : "outdoor_locality_mismatch";
  };
  const evaluated = places.map((place2) => ({ place: place2, outcome: compare(place2) }));
  const matches = evaluated.filter((candidate) => candidate.outcome === "match").map((candidate) => candidate.place);
  if (diagnostics) {
    diagnostics.candidateCount = places.length;
    diagnostics.outcome = !places.length ? "no_candidates" : ambiguousName || matches.length > 1 ? "ambiguous" : matches.length === 1 ? "verified" : "no_matching_candidate";
    diagnostics.candidates = evaluated.map(({ place: place2, outcome }) => ({
      id: place2.id,
      name: place2.name,
      address: place2.address,
      outcome
    }));
  }
  if (ambiguousName || matches.length !== 1) return null;
  const [place] = matches;
  return { name: place.name, address: place.address, lat: place.lat, lon: place.lon, type: place.type, verified: true };
}
function kmBetween(a, b) {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dLat, dLng);
}
async function geocodeNear(name, near, apiKey) {
  const d = 0.02;
  const bounds = `${near.lat - d},${near.lng - d}|${near.lat + d},${near.lng + d}`;
  try {
    const res = await providerFetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&bounds=${encodeURIComponent(bounds)}&region=au&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK") {
      if (data.status !== "ZERO_RESULTS") logGoogleError("resolve-place", data);
      return null;
    }
    const top = data.results?.[0];
    const loc = top?.geometry?.location;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
    const found = { lat: loc.lat, lng: loc.lng };
    if (kmBetween(found, near) > 1.5) return null;
    return { name, address: top.formatted_address ?? null, lat: found.lat, lon: found.lng, type: null };
  } catch {
    return null;
  }
}
async function geocodePlaceId(placeId, apiKey) {
  try {
    const res = await providerFetch(`https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${apiKey}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK") {
      if (data.status !== "ZERO_RESULTS" && data.status !== "NOT_FOUND") logGoogleError("resolve-place", data);
      return null;
    }
    const top = data.results?.[0];
    const loc = top?.geometry?.location;
    if (typeof loc?.lat !== "number" || typeof loc?.lng !== "number") return null;
    return { coord: { lat: loc.lat, lng: loc.lng }, address: top.formatted_address ?? null };
  } catch {
    return null;
  }
}
async function reverseGeocode(c, apiKey) {
  try {
    const res = await providerFetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${c.lat},${c.lng}&result_type=street_address|premise|point_of_interest|establishment&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") logGoogleError("resolve-place", data);
    return data?.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}
async function resolve(url, apiKey) {
  const fullUrl = await expandShortLink(url);
  try {
    if (new URL(fullUrl).pathname.startsWith("/maps/reviews")) return { ...EMPTY, hint: "review" };
  } catch {
  }
  const coords = extractCoords(fullUrl);
  const query = extractPlaceName(fullUrl);
  const name = query ? displayName(query) : null;
  if (query) {
    const place = await placesTextSearch(query, coords, apiKey);
    if (place?.address) return place;
  }
  const placeId = extractPlaceId(fullUrl);
  if (placeId) {
    const exact = await geocodePlaceId(placeId, apiKey);
    if (exact) return { name, address: exact.address, lat: exact.coord.lat, lon: exact.coord.lng, type: null };
  }
  if (coords) {
    if (query) {
      const near = await geocodeNear(query, coords, apiKey);
      if (near?.address) return { ...near, name };
    }
    const address = await reverseGeocode(coords, apiKey);
    return { name, address, lat: coords.lat, lon: coords.lng, type: null };
  }
  if (query) {
    const found = await geocodeAU(query, apiKey);
    if (found.coord) {
      return { name, address: found.formattedAddress, lat: found.coord.lat, lon: found.coord.lng, type: null };
    }
  }
  return name ? { ...EMPTY, name } : EMPTY;
}
var RATE_LIMIT = 60;
var RATE_WINDOW_SECONDS = 60 * 60;
Deno.serve(withStagingProviderControls("resolve-place", async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") {
    return json2(req, { error: "Method not allowed" }, 405);
  }
  try {
    const auth = await requireUser2(req);
    if (!auth.ok) return json2(req, { error: auth.error }, auth.status);
    const { url, verify, name, address, outdoor, addressFromSource, verificationDiagnostics } = await req.json();
    const limit = await consumeRateLimit2(
      "resolve-place",
      auth.user.id,
      RATE_LIMIT,
      RATE_WINDOW_SECONDS,
      verify === true ? { failClosed: true } : void 0
    );
    if (!limit.available && verify === true) return json2(req, { error: "Place verification is temporarily unavailable" }, 503);
    if (!limit.allowed) {
      return json2(
        req,
        { error: "Rate limit reached. Try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfter) }
      );
    }
    if (verify === true) {
      const canDiagnose = verificationDiagnostics === true && Deno.env.get("SUPABASE_URL") === "https://crpkzysdtnoomzimibhe.supabase.co" && (Deno.env.get("STAGING_PROVIDER_USERS") ?? "").split(",").some((id) => id.trim() === auth.user.id);
      const diagnostics = canDiagnose ? { outcome: "insufficient_source_evidence" } : void 0;
      const verificationResponse = (place) => diagnostics ? json2(req, { ...place ?? EMPTY, verificationDiagnostics: diagnostics }, 200, { "Cache-Control": "no-store" }) : json2(req, place ?? EMPTY);
      if (typeof url === "string" && url.length <= 2048 && isMapsUrl(url)) {
        return verificationResponse(await verifyPlace({ url }, await resolverMapsKey(), diagnostics));
      }
      if (typeof name !== "string" || typeof address !== "string" || !name.trim() || name.length > 200 || !address.trim() || address.length > 500) {
        return json2(req, { error: "A Maps link or venue name and address are required" }, 400);
      }
      return verificationResponse(await verifyPlace({
        name: name.trim(),
        address: address.trim(),
        outdoor: outdoor === true,
        addressFromSource: addressFromSource === true
      }, await resolverMapsKey(), diagnostics));
    }
    if (typeof url !== "string" || !url.trim()) {
      return json2(req, { error: "url is required" }, 400);
    }
    if (!isMapsUrl(url.trim())) {
      return json2(req, EMPTY);
    }
    const apiKey = await resolverMapsKey();
    return json2(req, await resolve(url.trim(), apiKey));
  } catch (err) {
    console.error("[resolve-place] internal error", String(err));
    return json2(req, { error: "Internal error" }, 500);
  }
}));
