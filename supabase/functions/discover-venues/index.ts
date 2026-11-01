import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { getGoogleMapsApiKey } from "../_shared/maps.ts";
type Place = { id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; types?: string[]; businessStatus?: string; attributions?: { provider?: string; providerUri?: string }[] };
export async function handler(req: Request): Promise<Response> {
  const pre = preflight(req); if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);
    const { query, origin } = await req.json();
    if (typeof query !== "string" || !query.trim() || query.length > 400 || !origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lon) || Math.abs(origin.lat) > 90 || Math.abs(origin.lon) > 180) return json(req, { error: "A location and a search of 1–400 characters are required" }, 400);
    const limit = await consumeRateLimit("discover-venues", auth.user.id, 20, 3600, { failClosed: true });
    if (!limit.allowed) return json(req, { error: "Discovery allowance unavailable. Try again later." }, limit.available ? 429 : 503);
    const key = await getGoogleMapsApiKey();
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.businessStatus,places.attributions" },
      body: JSON.stringify({ textQuery: query.trim(), pageSize: 20, languageCode: "en", locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lon }, radius: 50000 } } }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return json(req, { error: "Verified venue discovery is unavailable" }, 502);
    const data = await response.json();
    const seen = new Set<string>();
    const venues = (Array.isArray(data.places) ? data.places : []).slice(0, 20).filter((v: Place) => {
      if (typeof v.id !== "string" || !/^[\w-]{1,200}$/.test(v.id) || seen.has(v.id) || !v.displayName?.text || !v.formattedAddress || !Number.isFinite(v.location?.latitude) || !Number.isFinite(v.location?.longitude) || Math.abs(v.location!.latitude!) > 90 || Math.abs(v.location!.longitude!) > 180 || v.businessStatus === "CLOSED_PERMANENTLY") return false;
      seen.add(v.id); return true;
    }).map((v: Place) => ({ id: v.id, name: v.displayName!.text, address: v.formattedAddress, lat: v.location!.latitude, lon: v.location!.longitude,
      types: Array.isArray(v.types) ? v.types.filter((t: unknown) => typeof t === "string") : [], attributions: v.attributions ?? [] }));
    return json(req, { venues, provider: "Google Maps" });
  } catch { return json(req, { error: "Verified venue discovery is unavailable" }, 503); }
}
Deno.serve(handler);
