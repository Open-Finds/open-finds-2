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

type PlaceResult = {
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
};

// Extract coordinates from a Google Maps URL.
// Handles patterns like:
//   @-33.8688,151.2093
//   !3d-33.8688!4d151.2093
//   /place/-33.8688,151.2093
//   ?q=-33.8688,151.2093
//   ll=-33.8688,151.2093
function extractCoords(url: string): { lat: number; lon: number } | null {
  // @lat,lon pattern (most common in share links)
  let m = url.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // !3dlat!4dlon pattern (directions/place URLs)
  m = url.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // ll=lat,lon pattern
  m = url.match(/[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // q=lat,lon or q="lat,lon" pattern
  m = url.match(/[?&]q=(-?\d{1,3}\.\d+%2C|-?\d{1,3}\.\d+,)(-?\d{1,3}\.\d+)/);
  if (m) {
    const latMatch = url.match(/[?&]q=(-?\d{1,3}\.\d+)/);
    const lonMatch = url.match(/[?&]q=-?\d{1,3}\.\d+%2C(-?\d{1,3}\.\d+)/);
    if (latMatch && lonMatch) return { lat: parseFloat(latMatch[1]), lon: parseFloat(lonMatch[1]) };
  }

  // q=lat,lon without encoding
  m = url.match(/[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  // center=lat,lon pattern
  m = url.match(/[?&]center=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };

  return null;
}

// Extract a place query string from the URL (e.g. /place/Restaurant+Name or q=Restaurant Name)
function extractPlaceQuery(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);

    // /place/Place+Name/ pattern
    const placeIdx = parts.indexOf("place");
    if (placeIdx >= 0 && placeIdx + 1 < parts.length) {
      return decodeURIComponent(parts[placeIdx + 1].replace(/\+/g, " "));
    }

    // q= parameter (could be a place name or coords)
    const q = u.searchParams.get("q");
    if (q && !/^-?\d+\.\d+/.test(q)) {
      return q;
    }

    return null;
  } catch {
    return null;
  }
}

// Reverse geocode coordinates to get a human-readable address and place name
async function reverseGeocode(
  lat: number,
  lon: number,
  apiKey: string
): Promise<PlaceResult> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lon}&result_type=street_address|premise|point_of_interest|establishment&key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { name: null, address: null, lat, lon };

    const data = await res.json();
    const results = data?.results;
    if (!Array.isArray(results) || results.length === 0) {
      return { name: null, address: null, lat, lon };
    }

    const top = results[0];
    const address = top?.formatted_address ?? null;

    // Try to extract a place name from address components
    let name: string | null = null;
    const components = top?.address_components ?? [];
    for (const c of components) {
      const types: string[] = c.types ?? [];
      if (
        types.includes("point_of_interest") ||
        types.includes("establishment") ||
        types.includes("premise")
      ) {
        name = c.long_name;
        break;
      }
    }

    return { name, address, lat, lon };
  } catch {
    return { name: null, address: null, lat, lon };
  }
}

// Forward geocode a place name + optional area to get coordinates and formatted address
async function forwardGeocode(
  query: string,
  apiKey: string
): Promise<PlaceResult> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${apiKey}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return { name: null, address: null, lat: null, lon: null };

    const data = await res.json();
    const result = data?.results?.[0];
    if (!result) return { name: null, address: null, lat: null, lon: null };

    const loc = result.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
      return { name: null, address: null, lat: null, lon: null };
    }

    const address = result.formatted_address ?? null;

    // Try to extract a place name from address components
    let name: string | null = null;
    const components = result.address_components ?? [];
    for (const c of components) {
      const types: string[] = c.types ?? [];
      if (
        types.includes("point_of_interest") ||
        types.includes("establishment") ||
        types.includes("premise")
      ) {
        name = c.long_name;
        break;
      }
    }

    // If no POI name found, use the query itself as the name
    if (!name) name = query;

    return { name, address, lat: loc.lat, lon: loc.lng };
  } catch {
    return { name: null, address: null, lat: null, lon: null };
  }
}

const RATE_LIMIT = 60;
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

    const limit = await consumeRateLimit("resolve-place", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return json(
        req,
        { error: "Rate limit reached. Try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    const { url } = await req.json();
    if (typeof url !== "string" || !url.trim()) {
      return json(req, { error: "url is required" }, 400);
    }

    const lower = url.toLowerCase();
    if (!lower.includes("google.com/maps") && !lower.includes("maps.google.com") && !lower.includes("maps.app.goo.gl")) {
      return json(req, { name: null, address: null, lat: null, lon: null });
    }

    const apiKey = await getGoogleMapsApiKey();

    // Strategy 1: Extract coordinates directly from the URL
    const coords = extractCoords(url);
    if (coords) {
      const result = await reverseGeocode(coords.lat, coords.lon, apiKey);
      if (result.address) {
        return json(req, result);
      }
      // Coords found but reverse geocode failed — return coords only
      return json(req, { name: null, address: null, lat: coords.lat, lon: coords.lon });
    }

    // Strategy 2: Extract a place name from the URL and forward geocode it
    const placeQuery = extractPlaceQuery(url);
    if (placeQuery) {
      const result = await forwardGeocode(placeQuery, apiKey);
      if (result.address) {
        return json(req, result);
      }
    }

    // Could not resolve
    return json(req, { name: null, address: null, lat: null, lon: null });
  } catch (err) {
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[resolve-place] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
