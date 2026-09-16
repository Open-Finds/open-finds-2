/**
 * CORS handling for all edge functions.
 *
 * Origin is driven by the ALLOWED_ORIGINS secret (comma-separated). When it is
 * unset we fall back to "*" so an existing deployment keeps working, but that
 * is a deployment gap rather than a design choice — set ALLOWED_ORIGINS to the
 * app's real origins in production.
 *
 * Note that CORS is not the security boundary for these functions. It only
 * constrains browsers; anything server-side ignores it entirely. Authorisation
 * is enforced in requireUser() (see auth.ts).
 */
const configured = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const BASE_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";

  if (configured.length === 0) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": "*" };
  }
  if (origin && configured.includes(origin)) {
    return { ...BASE_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  // Unknown origin: echo the first configured origin so the browser blocks it.
  return { ...BASE_HEADERS, "Access-Control-Allow-Origin": configured[0] };
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeadersFor(req) });
}

export function json(
  req: Request,
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeadersFor(req), "Content-Type": "application/json", ...extra },
  });
}
