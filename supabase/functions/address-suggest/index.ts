import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { getGoogleMapsApiKey, logGoogleError } from "../_shared/maps.ts";

/**
 * Address suggestions while someone types (the drop-down most apps show).
 *
 * Google Places Autocomplete when the Maps key allows it ("Places API (New)"
 * in the key's API restrictions); places as well as street addresses, so
 * typing a venue's name finds it. Until then, Google Geocoding's matches for
 * what's typed, which needs a fuller address but already works.
 *
 * Each keystroke can be a call, so it's capped per user.
 */
const RATE_LIMIT = 400;
const RATE_WINDOW_SECONDS = 60 * 60;

type Suggestion = { text: string; main: string; secondary: string; place_id?: string };

/** One Places Autocomplete call; null when the key isn't allowed to use it. */
async function placesCall(body: Record<string, unknown>, apiKey: string): Promise<Suggestion[] | null> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
    body: JSON.stringify({ languageCode: "en", ...body }),
  });
  if (!res.ok) {
    console.warn("[address-suggest] Places autocomplete unavailable", res.status);
    return null;
  }
  const data = await res.json();
  return ((data.suggestions ?? []) as Array<Record<string, any>>)
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .map((p) => ({
      text: p.text?.text ?? "",
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
      place_id: typeof p.placeId === "string" ? p.placeId : undefined,
    }))
    .filter((s) => s.text);
}

/**
 * The picked suggestion's proper address ("236/240 Georges River Rd, Croydon
 * Park NSW 2133", not "Pocket Burger, Georges River Road, …"), its name if
 * it's a venue, and where it is.
 */
async function placeDetails(placeId: string, apiKey: string) {
  if (!/^[A-Za-z0-9_-]{10,300}$/.test(placeId)) return null;
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=en`, {
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "formattedAddress,displayName,location,types" },
  });
  if (!res.ok) return null;
  const p = await res.json();
  const types = (p.types ?? []) as string[];
  // A street address has no name of its own; Google repeats the address as one.
  const isVenue = types.includes("establishment") || types.includes("point_of_interest");
  return {
    address: (p.formattedAddress as string | undefined)?.replace(/, Australia$/, "") ?? null,
    name: isVenue ? (p.displayName?.text as string | undefined) ?? null : null,
    lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
    lon: typeof p.location?.longitude === "number" ? p.location.longitude : null,
  };
}

/**
 * Australian matches first, then anywhere else (overseas trips). Google's
 * own "bias" barely moves the order: "frites atelier" listed Brussels,
 * Antwerp and London ahead of the one in Sydney. So Australia is asked for
 * on its own and the rest fills what's left.
 */
async function placesAutocomplete(input: string, apiKey: string, near: { lat: number; lon: number } | null): Promise<Suggestion[] | null> {
  const bias = near
    ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } } }
    : {};
  const [local, anywhere] = await Promise.all([
    placesCall({ input, includedRegionCodes: ["au"], ...bias }, apiKey),
    placesCall({ input, ...bias }, apiKey),
  ]);
  if (local === null && anywhere === null) return null;
  const seen = new Set<string>();
  return [...(local ?? []), ...(anywhere ?? [])]
    .filter((s) => !seen.has(s.text) && seen.add(s.text))
    .slice(0, 5);
}

async function geocodeMatches(input: string, apiKey: string): Promise<Suggestion[]> {
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(input)}&region=au&language=en&key=${apiKey}`,
  );
  const data = await res.json();
  if (data.status !== "OK") {
    if (data.status !== "ZERO_RESULTS") logGoogleError("address-suggest", data);
    return [];
  }
  return ((data.results ?? []) as Array<Record<string, any>>).slice(0, 5).map((r) => {
    const text = String(r.formatted_address ?? "");
    const [main, ...rest] = text.split(", ");
    return { text, main, secondary: rest.join(", ") };
  });
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const limit = await consumeRateLimit("address-suggest", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) return json(req, { suggestions: [] }, 429, { "Retry-After": String(limit.retryAfter) });

    const { input, lat, lon, place_id } = await req.json().catch(() => ({}));
    const apiKey = await getGoogleMapsApiKey();
    if (typeof place_id === "string") {
      return json(req, { place: await placeDetails(place_id, apiKey) });
    }
    const text = typeof input === "string" ? input.trim().slice(0, 200) : "";
    if (text.length < 3) return json(req, { suggestions: [] });
    const near = typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null;

    const places = await placesAutocomplete(text, apiKey, near);
    const suggestions = places ?? await geocodeMatches(text, apiKey);
    return json(req, { suggestions, source: places ? "places" : "geocode" });
  } catch (err) {
    console.error("[address-suggest] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
