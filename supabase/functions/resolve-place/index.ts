import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { type Coord, geocodeAU, getGoogleMapsApiKey, logGoogleError } from "../_shared/maps.ts";

type VenueType = "food" | "bar" | "dessert" | "activity";

type PlaceResult = {
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** Best guess from Google's place types; null when unknown. */
  type?: VenueType | null;
  /** 'review': the link is to a Google review, which names no place. */
  hint?: "review";
};

const EMPTY: PlaceResult = { name: null, address: null, lat: null, lon: null };

/** google.com, google.com.au, google.co.uk, google.de ... with or without www./maps. */
function isGoogleDomain(host: string): boolean {
  return /^(?:[a-z0-9-]+\.)*google\.(?:com|co)(?:\.[a-z]{2})?$/.test(host) ||
    /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}$/.test(host);
}

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co"]);

/** Every link shape the Maps app, the website and Google search share. */
function isMapsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === "maps.app.goo.gl") return true;
    if (host === "goo.gl") return u.pathname.startsWith("/maps");
    if (host === "g.co") return u.pathname.startsWith("/kgs");
    if (!isGoogleDomain(host)) return false;
    return host.startsWith("maps.") || u.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

/**
 * Follows a short link (what the Maps app shares) to the full Maps URL,
 * which is where the place name and coordinates are. Only Google addresses
 * are followed, so this can't be used to reach anything else.
 */
async function expandShortLink(raw: string): Promise<string> {
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return current;
    }
    const host = u.hostname.toLowerCase();
    if (!SHORT_HOSTS.has(host) && !isGoogleDomain(host)) return current;
    // Google's cookie-consent interstitial carries the real target.
    if (host.startsWith("consent.")) {
      const target = u.searchParams.get("continue");
      if (!target) return current;
      current = target;
      continue;
    }
    if (!SHORT_HOSTS.has(host)) return current;
    try {
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1" },
      });
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
    } catch (err) {
      console.error("[resolve-place] could not follow short link", String(err));
    }
    return current;
  }
  return current;
}

/**
 * Coordinates in a Maps URL. The place pin (!3d…!4d…) comes first: the
 * @lat,lng part is only where the map was centred, which can be streets away.
 */
function extractCoords(url: string): Coord | null {
  const patterns = [
    /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&]ll=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query)=(-?\d{1,3}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i,
    /[?&]center=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  }
  return null;
}

/** The place name in a Maps URL: /place/<name>/, /search/<name>/, or q= / query=. */
function extractPlaceName(url: string): string | null {
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

/** Google's own id for the place, when the link carries one (query_place_id=ChIJ…). */
function extractPlaceId(url: string): string | null {
  try {
    const id = new URL(url).searchParams.get("query_place_id");
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Search links append the area: "Malibu Sydney, Surry Hills, NSW" is "Malibu Sydney". */
function displayName(query: string): string {
  return query.split(",")[0].trim() || query;
}

const BAR_TYPES = new Set(["bar", "pub", "wine_bar", "cocktail_bar", "night_club", "brewery", "brewpub", "beer_garden", "lounge_bar", "sports_bar", "irish_pub", "winery"]);
const DESSERT_TYPES = new Set(["dessert_shop", "dessert_restaurant", "ice_cream_shop", "bakery", "confectionery", "chocolate_shop", "cake_shop", "donut_shop", "candy_store", "pastry_shop"]);
const ACTIVITY_TYPES = new Set([
  "amusement_center", "amusement_park", "bowling_alley", "escape_room", "video_arcade", "karaoke", "miniature_golf_course",
  "golf_course", "tourist_attraction", "museum", "art_gallery", "movie_theater", "zoo", "aquarium", "park", "national_park",
  "casino", "event_venue", "performing_arts_theater", "concert_hall", "sports_complex", "stadium", "spa", "water_park",
  "botanical_garden", "hiking_area", "ice_skating_rink", "go_karting_venue", "paintball_center", "skateboard_park",
]);

/** Maps Google place types onto the app's four venue types. */
function venueTypeFrom(types: (string | undefined | null)[]): VenueType | null {
  for (const t of types) {
    if (!t) continue;
    if (DESSERT_TYPES.has(t) || /gelato|ice_cream|dessert/.test(t)) return "dessert";
    if (BAR_TYPES.has(t)) return "bar";
    if (ACTIVITY_TYPES.has(t)) return "activity";
    if (t === "restaurant" || t === "cafe" || t === "coffee_shop" || t === "bar_and_grill" || t.endsWith("_restaurant") ||
        t === "meal_takeaway" || t === "meal_delivery" || t === "food" || t === "sandwich_shop" || t === "diner") return "food";
  }
  return null;
}

/**
 * Places API (New) Text Search: the real name, address, pin and kind of
 * place. Returns null when the API isn't enabled for this key, so callers
 * fall back to plain geocoding.
 */
async function placesTextSearch(query: string, near: Coord | null, apiKey: string): Promise<PlaceResult | null> {
  const body: Record<string, unknown> = { textQuery: query, languageCode: "en", regionCode: "AU", pageSize: 1 };
  if (near) {
    body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 500 } };
  }
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location,places.types,places.primaryType",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[resolve-place] Places API ${res.status}: ${data?.error?.status ?? ""} ${data?.error?.message ?? ""}`);
      return null;
    }
    const p = data?.places?.[0];
    if (!p) return null;
    return {
      name: p.displayName?.text ?? null,
      address: p.formattedAddress ?? null,
      lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
      lon: typeof p.location?.longitude === "number" ? p.location.longitude : null,
      type: venueTypeFrom([p.primaryType, ...(Array.isArray(p.types) ? p.types : [])]),
    };
  } catch (err) {
    console.error("[resolve-place] Places API failed", String(err));
    return null;
  }
}

/** Rough distance in km; enough to tell "same block" from "other suburb". */
function kmBetween(a: Coord, b: Coord): number {
  const dLat = (a.lat - b.lat) * 111;
  const dLng = (a.lng - b.lng) * 111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * The named place near a pin, using Geocoding (which knows many venues by
 * name) when the Places API isn't available. Results more than ~1.5 km from
 * the pin are some other branch or a same-named street, and are ignored.
 */
async function geocodeNear(name: string, near: Coord, apiKey: string): Promise<PlaceResult | null> {
  const d = 0.02;
  const bounds = `${near.lat - d},${near.lng - d}|${near.lat + d},${near.lng + d}`;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(name)}&bounds=${encodeURIComponent(bounds)}&region=au&key=${apiKey}`,
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

/** Exact address and pin for a Google place id; works without the Places API. */
async function geocodePlaceId(placeId: string, apiKey: string): Promise<{ coord: Coord; address: string | null } | null> {
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${apiKey}`);
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

/** Street address for a pin, when there's no name to search for. */
async function reverseGeocode(c: Coord, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${c.lat},${c.lng}&result_type=street_address|premise|point_of_interest|establishment&key=${apiKey}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") logGoogleError("resolve-place", data);
    return data?.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}

async function resolve(url: string, apiKey: string): Promise<PlaceResult> {
  const fullUrl = await expandShortLink(url);
  try {
    // "Share" on a review gives a link that names no place at all.
    if (new URL(fullUrl).pathname.startsWith("/maps/reviews")) return { ...EMPTY, hint: "review" };
  } catch { /* not a URL; the checks below find nothing */ }

  const coords = extractCoords(fullUrl);
  const query = extractPlaceName(fullUrl);
  const name = query ? displayName(query) : null;

  if (query) {
    const place = await placesTextSearch(query, coords, apiKey);
    if (place?.address) return place;
  }

  // No Places result: keep the name from the link and find the address.
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
  return EMPTY;
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
    if (!isMapsUrl(url.trim())) {
      return json(req, EMPTY);
    }

    const apiKey = await getGoogleMapsApiKey();
    return json(req, await resolve(url.trim(), apiKey));
  } catch (err) {
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[resolve-place] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
