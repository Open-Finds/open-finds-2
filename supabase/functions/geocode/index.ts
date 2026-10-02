import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { geocodeAU, getGoogleMapsApiKey } from "../_shared/maps.ts";

const RATE_LIMIT = 120;
const RATE_WINDOW_SECONDS = 60 * 60;

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  try {
    // This endpoint spends Google Maps quota, so it requires a real signed-in
    // user rather than the public anon key, and is capped per user.
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const limit = await consumeRateLimit("geocode", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return json(
        req,
        { error: "Rate limit reached. Try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    const { address } = await req.json();
    if (typeof address !== "string" || !address.trim()) {
      return json(req, { error: "address is required" }, 400);
    }

    const apiKey = await getGoogleMapsApiKey();
    const result = await geocodeAU(address, apiKey);
    if (result.status === "FETCH_FAILED") {
      return json(req, { error: "Geocoding request failed" }, 502);
    }
    if (result.coord) {
      return json(req, { lat: result.coord.lat, lon: result.coord.lng, address: result.formattedAddress });
    }
    return json(req, { lat: null, lon: null });
  } catch (err) {
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[geocode] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
