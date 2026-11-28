/**
 * Venue stamps: a tamper-proof note of a Google place, issued by resolve-place
 * and accepted by save-verified-venue.
 *
 * resolve-place gets a place's details from Google; the save happens a moment
 * later from the app. The stamp carries Google's own details from server to
 * server through the app, signed so the app cannot change them, tied to the
 * person it was issued to, and short-lived. No second Google request is needed
 * at save time.
 *
 * The signing key is derived from the service-role key, which only edge
 * functions hold. With no key (local tests, misconfiguration) no stamp is
 * issued and none is accepted: saves then fall back to the normal unlinked save.
 */

export const VENUE_CATEGORIES = ["food", "dessert", "cafe", "bar", "nightlife", "activity", "outdoors"] as const;
export type VenueCategory = typeof VENUE_CATEGORIES[number];

/** Google's details for one place, as stored on the shared venue. */
export type StampedPlace = {
  google_place_id: string;
  name: string;
  address: string;
  suburb: string | null;
  lat: number;
  lon: number;
  /** Null when Google's place types say nothing usable; the saver's category is used then. */
  category: VenueCategory | null;
};

type Payload = StampedPlace & { v: 1; uid: string; exp: number };

/** Long enough to cover AI Save's kept progress (20 minutes) with room to spare. */
export const VENUE_TOKEN_TTL_SECONDS = 60 * 60;
const MAX_TOKEN_LENGTH = 4096;
const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function signingKey(): Promise<CryptoKey | null> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!secret) return null;
  // A separate key for this purpose, so a stamp is never usable as anything else.
  const material = await crypto.subtle.digest("SHA-256", encoder.encode(`the-unsaved/venue-stamp/v1:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function validPlace(place: Partial<StampedPlace> | null | undefined): place is StampedPlace {
  return !!place &&
    typeof place.google_place_id === "string" && PLACE_ID.test(place.google_place_id) &&
    typeof place.name === "string" && place.name.trim().length >= 1 && place.name.length <= 200 &&
    typeof place.address === "string" && place.address.trim().length >= 1 && place.address.length <= 500 &&
    (place.suburb === null || (typeof place.suburb === "string" && place.suburb.trim().length >= 1 && place.suburb.length <= 100)) &&
    typeof place.lat === "number" && Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
    typeof place.lon === "number" && Number.isFinite(place.lon) && Math.abs(place.lon) <= 180 &&
    (place.category === null || VENUE_CATEGORIES.includes(place.category as VenueCategory));
}

/** A stamp for `place`, issued to `userId`; null when the place is incomplete or no key is set. */
export async function signVenueToken(place: StampedPlace, userId: string, now = Date.now()): Promise<string | null> {
  if (!validPlace(place) || !userId) return null;
  const key = await signingKey();
  if (!key) return null;
  const payload: Payload = {
    v: 1, uid: userId, exp: Math.floor(now / 1000) + VENUE_TOKEN_TTL_SECONDS,
    google_place_id: place.google_place_id, name: place.name, address: place.address, suburb: place.suburb,
    lat: place.lat, lon: place.lon, category: place.category,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

/** The place in a stamp, only if it is genuine, unexpired and was issued to `userId`. */
export async function verifyVenueToken(token: unknown, userId: string, now = Date.now()): Promise<StampedPlace | null> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH || !userId) return null;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return null;
  const signatureBytes = fromBase64Url(signature);
  const bodyBytes = fromBase64Url(body);
  if (!signatureBytes || !bodyBytes) return null;
  const key = await signingKey();
  if (!key) return null;
  // crypto.subtle.verify compares in constant time.
  if (!(await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(body)))) return null;
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return null;
  }
  if (payload.v !== 1 || payload.uid !== userId || typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
  const place: Partial<StampedPlace> = {
    google_place_id: payload.google_place_id, name: payload.name, address: payload.address, suburb: payload.suburb ?? null,
    lat: payload.lat, lon: payload.lon, category: payload.category ?? null,
  };
  return validPlace(place) ? place : null;
}

/** Google place types onto the app's seven categories, most specific first; null when nothing fits. */
export function categoryFromGoogle(types: (string | null | undefined)[]): VenueCategory | null {
  const list = types.filter((type): type is string => typeof type === "string");
  const has = (...wanted: string[]) => list.some((type) => wanted.includes(type));
  if (has("night_club", "live_music_venue", "concert_hall", "dance_hall")) return "nightlife";
  if (has("bar", "pub", "wine_bar", "cocktail_bar", "brewery", "brewpub", "beer_garden", "lounge_bar", "sports_bar", "irish_pub", "winery")) return "bar";
  if (list.some((type) => /dessert|ice_cream|gelato/.test(type)) ||
    has("bakery", "confectionery", "chocolate_shop", "cake_shop", "donut_shop", "candy_store", "pastry_shop")) return "dessert";
  if (has("cafe", "coffee_shop", "tea_house", "cat_cafe", "dog_cafe", "internet_cafe")) return "cafe";
  if (has("park", "national_park", "hiking_area", "beach", "campground", "botanical_garden", "garden", "state_park")) return "outdoors";
  if (list.some((type) => type.endsWith("_restaurant")) ||
    has("restaurant", "food", "meal_takeaway", "meal_delivery", "sandwich_shop", "diner", "bar_and_grill", "food_court")) return "food";
  if (has("amusement_center", "amusement_park", "bowling_alley", "escape_room", "video_arcade", "karaoke", "miniature_golf_course",
    "golf_course", "tourist_attraction", "museum", "art_gallery", "movie_theater", "zoo", "aquarium", "casino", "event_venue",
    "performing_arts_theater", "sports_complex", "stadium", "spa", "water_park", "ice_skating_rink", "go_karting_venue",
    "paintball_center", "skateboard_park")) return "activity";
  return null;
}

type AddressComponent = { longText?: string; shortText?: string; types?: string[] };

/** The suburb (Australia) or town from Google's address parts; null when Google gave none. */
export function suburbFromGoogle(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  for (const wanted of ["locality", "postal_town", "sublocality", "administrative_area_level_2"]) {
    const part = (components as AddressComponent[]).find((component) => component?.types?.includes(wanted));
    const text = part?.longText?.trim();
    if (text && text.length <= 100) return text;
  }
  return null;
}
