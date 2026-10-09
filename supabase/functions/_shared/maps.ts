/**
 * Google Maps helpers shared by geocode, travel-times and resolve-place.
 *
 * Every call reads Google's `status`: a key with the wrong restrictions, an
 * API that isn't enabled, or billing that lapsed all come back as HTTP 200
 * with an error status, and used to look exactly like "nothing found".
 */
import { serviceClient } from "./auth.ts";

export type Coord = { lat: number; lng: number };

export async function getGoogleMapsApiKey(): Promise<string> {
  const { data, error } = await serviceClient()
    .from("app_secrets")
    .select("value")
    .eq("key", "GOOGLE_MAPS_API_KEY")
    .maybeSingle();
  if (error || !data) throw new Error("Google Maps API key not found");
  return data.value as string;
}

/** Google reports quota, key and billing problems as a status, not an HTTP error. */
export function logGoogleError(where: string, data: { status?: string; error_message?: string }) {
  console.error(`[${where}] Google returned ${data.status}: ${data.error_message ?? "(no message)"}`);
}

export type GeocodeResult = {
  coord: Coord | null;
  /** Google's status: OK, ZERO_RESULTS, REQUEST_DENIED, ... or FETCH_FAILED. */
  status: string;
  formattedAddress: string | null;
  /** What was matched: establishment, street_address, park, locality, ... */
  types?: string[];
};

const AU_POSTCODE = /^\d{4}$/;

/**
 * Geocodes what a user typed, reading it the Australian way.
 *
 * Without a country, "2000" finds no single place (Sydney, Antwerp,
 * Neuchâtel and Johannesburg all use it), so a bare 4-digit number is looked
 * up as an Australian postcode. Anything else is biased to Australia rather
 * than restricted to it, so a full overseas address still works.
 *
 * Addresses come back in English (language=en): a Japanese search otherwise
 * answers "Japan, 〒150-0013 Tokyo, Shibuya, …" in Japanese order.
 */
export async function geocodeAU(address: string, apiKey: string): Promise<GeocodeResult> {
  const text = address.trim();
  const query = AU_POSTCODE.test(text)
    ? `components=${encodeURIComponent(`postal_code:${text}|country:AU`)}`
    : `address=${encodeURIComponent(text)}&region=au`;
  const lang = '&language=en';
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${query}${lang}&key=${apiKey}`);
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
        types: Array.isArray(top.types) ? top.types : [],
      };
    }
    return { coord: null, status: data.status ?? "UNKNOWN", formattedAddress: null };
  } catch {
    return { coord: null, status: "FETCH_FAILED", formattedAddress: null };
  }
}

/** Runs `fn` over `items` with at most `limit` in flight, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
