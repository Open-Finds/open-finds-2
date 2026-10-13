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

type Suggestion = { text: string; main: string; secondary: string };

async function placesAutocomplete(input: string, apiKey: string, near: { lat: number; lon: number } | null): Promise<Suggestion[] | null> {
  const body: Record<string, unknown> = { input, languageCode: "en" };
  // Nearby first, but anywhere is allowed (overseas trips).
  body.locationBias = near
    ? { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 50000 } }
    : { rectangle: { low: { latitude: -44, longitude: 112 }, high: { latitude: -10, longitude: 154 } } };
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Not allowed on this key yet: fall back, quietly after the first time.
    console.warn("[address-suggest] Places autocomplete unavailable", res.status);
    return null;
  }
  const data = await res.json();
  return ((data.suggestions ?? []) as Array<Record<string, any>>)
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .slice(0, 5)
    .map((p) => ({
      text: p.text?.text ?? "",
      main: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondary: p.structuredFormat?.secondaryText?.text ?? "",
    }))
    .filter((s) => s.text);
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

    const { input, lat, lon } = await req.json().catch(() => ({}));
    const text = typeof input === "string" ? input.trim().slice(0, 200) : "";
    if (text.length < 3) return json(req, { suggestions: [] });
    const near = typeof lat === "number" && typeof lon === "number" ? { lat, lon } : null;

    const apiKey = await getGoogleMapsApiKey();
    const places = await placesAutocomplete(text, apiKey, near);
    const suggestions = places ?? await geocodeMatches(text, apiKey);
    return json(req, { suggestions, source: places ? "places" : "geocode" });
  } catch (err) {
    console.error("[address-suggest] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
