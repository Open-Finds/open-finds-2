import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";


async function getGoogleMapsApiKey(): Promise<string> {
  const { data, error } = await serviceClient()
    .from("app_secrets")
    .select("value")
    .eq("key", "GOOGLE_MAPS_API_KEY")
    .maybeSingle();
  if (error || !data) throw new Error("Google Maps API key not found");
  return data.value as string;
}

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
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`;

    const res = await fetch(url);
    if (!res.ok) {
      return json(req, { error: "Geocoding request failed" }, 502);
    }

    const data = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;

    if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
      return json(req, { lat: loc.lat, lon: loc.lng });
    }

    return json(req, { lat: null, lon: null });
  } catch (err) {
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[geocode] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
