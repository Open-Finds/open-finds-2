import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { stageLog } from "../_shared/stagelog.ts";
import { type Coord, geocodeAU, getGoogleMapsApiKey, logGoogleError } from "../_shared/maps.ts";
import {
  configureStagingProviders, isStagingProviderTarget, providerFetch, RESOLVE_PLACE, withStagingProviderControls,
} from "../_shared/stagingProviders.ts";

// Staging only: requests pass the access/budget/ledger controls (verification is
// admitted for listed test accounts). Elsewhere a pass-through. See _shared/stagingProviders.ts.
configureStagingProviders(RESOLVE_PLACE);

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
  /** Google's place id, when the answer is one Google place. */
  placeId?: string;
};

const EMPTY: PlaceResult = { name: null, address: null, lat: null, lon: null };

/** google.com, google.com.au, google.co.uk, google.de ... with or without www./maps. */
function isGoogleDomain(host: string): boolean {
  return /^(?:[a-z0-9-]+\.)*google\.(?:com|co)(?:\.[a-z]{2})?$/.test(host) ||
    /^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}$/.test(host);
}

const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co", "share.google"]);

/**
 * Every link shape the Maps app, the website and Google search share,
 * including share.google/… (Google's newer Share button), which opens the
 * place's search result rather than a map.
 */
function isMapsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === "maps.app.goo.gl" || host === "share.google") return true;
    if (host === "goo.gl") return u.pathname.startsWith("/maps");
    if (host === "g.co") return u.pathname.startsWith("/kgs");
    if (!isGoogleDomain(host)) return false;
    // A place's search result (what share.google and g.co/kgs expand to).
    if (u.pathname === "/search" && u.searchParams.has("kgmid")) return true;
    return host.startsWith("maps.") || u.pathname.startsWith("/maps");
  } catch {
    return false;
  }
}

/**
 * share.google/<id> sends everyone through google.com, which redirects to a
 * country domain based on where the server is (google.com.hk, …) before the
 * place. Asking google.com.au directly skips that and answers with the place.
 */
function shareGoogleTarget(u: URL): string | null {
  const id = u.hostname === "share.google"
    ? u.pathname.replace(/^\/+/, "").split("/")[0]
    : u.pathname === "/share.google" ? u.searchParams.get("q") : null;
  return id && /^[A-Za-z0-9_-]{4,64}$/.test(id) ? `https://www.google.com.au/share.google?q=${id}` : null;
}

/**
 * Follows a short link (what the Maps app shares) to the full Maps URL,
 * which is where the place name and coordinates are. Only Google addresses
 * are followed, so this can't be used to reach anything else.
 *
 * `strict` (verification) refuses non-https links, credentials and ports, times
 * out after 5s, and reports an unreachable link instead of carrying on.
 */
async function expandShortLink(raw: string, strict = false): Promise<string> {
  let current = raw;
  for (let hop = 0; hop < 6; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return current;
    }
    if (strict && (u.protocol !== "https:" || u.username || u.password || u.port)) return "";
    const host = u.hostname.toLowerCase();
    if (!SHORT_HOSTS.has(host) && !isGoogleDomain(host)) return current;
    // Google's cookie-consent interstitial carries the real target.
    if (host.startsWith("consent.")) {
      const target = u.searchParams.get("continue");
      if (!target) return current;
      current = target;
      continue;
    }
    // Country redirect (google.com/url?q=https://www.google.com.hk/…).
    if (u.pathname === "/url" && u.searchParams.get("q")?.startsWith("https://")) {
      current = u.searchParams.get("q")!;
      continue;
    }
    const share = shareGoogleTarget(u);
    if (share && share !== current) {
      current = share;
      continue;
    }
    if (!SHORT_HOSTS.has(host) && !share) return current;
    try {
      const res = await providerFetch(current, {
        redirect: "manual",
        signal: strict ? AbortSignal.timeout(5000) : undefined,
        headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1" },
      });
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (strict && (res.status === 429 || res.status >= 500)) throw new Error("Maps link could not be reached");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
    } catch (err) {
      if (strict) throw err;
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

/** A Places result with its Google place id, for exact matching. */
type Place = {
  id: string | null;
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  type: VenueType | null;
  outdoor: boolean;
};

const OUTDOOR_TYPES = ["hiking_area", "park", "national_park", "beach"];

/** The fields of a Places API (New) result that searchPlaces asks for. */
type PlacesApiResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
};

/**
 * Places API (New) Text Search: up to `pageSize` candidates with the real
 * name, address, pin, kind of place and Google place id.
 */
async function searchPlaces(
  query: string, near: Coord | null, apiKey: string, pageSize: number, region: string | null = "AU",
): Promise<Place[]> {
  // The region only biases the ranking; it is left off for places outside Australia.
  const body: Record<string, unknown> = { textQuery: query, languageCode: "en", ...(region ? { regionCode: region } : {}), pageSize };
  if (near) {
    body.locationBias = { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 500 } };
  }
  const res = await providerFetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Places search returned ${res.status}`);
  const data = await res.json();
  const places = Array.isArray(data?.places) ? data.places : [];
  return places.map((p: PlacesApiResult): Place => ({
    id: p.id ?? null,
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    lat: typeof p.location?.latitude === "number" ? p.location.latitude : null,
    lon: typeof p.location?.longitude === "number" ? p.location.longitude : null,
    type: venueTypeFrom([p.primaryType, ...(Array.isArray(p.types) ? p.types : [])]),
    outdoor: [p.primaryType, ...(Array.isArray(p.types) ? p.types : [])].some((type) => OUTDOOR_TYPES.includes(type)),
  }));
}

/** The top Places result for a link's name, or null when there is none (callers fall back to geocoding). */
async function placesTextSearch(query: string, near: Coord | null, apiKey: string): Promise<PlaceResult | null> {
  try {
    const [place] = await searchPlaces(query, near, apiKey, 1);
    return place ? { name: place.name, address: place.address, lat: place.lat, lon: place.lon, type: place.type } : null;
  } catch (err) {
    console.error("[resolve-place] Places API failed", String(err));
    return null;
  }
}

/** An address compared loosely: case, punctuation, street suffix and a trailing country do not matter. */
function addressKey(address: string): string {
  return address.toLowerCase().replace(/,\s*australia\s*$/, "").replace(/[.,]/g, " ")
    .replace(/\b(street|road|avenue|highway|drive)\b/g, (suffix) => ({
      street: "st", road: "rd", avenue: "ave", highway: "hwy", drive: "dr",
    } as Record<string, string>)[suffix] ?? suffix)
    .replace(/\s+/g, " ").trim();
}

const australianStreetTypes: Record<string, string> = {
  street: "st", road: "rd", avenue: "ave", highway: "hwy", drive: "dr", place: "pl", lane: "ln", terrace: "tce",
  parade: "pde", crescent: "cres", court: "ct", close: "cl", circuit: "cct", boulevard: "bvd", square: "sq",
};

/** "2/10 George St, Sydney NSW 2000" as comparable parts, or null if it is not a full Australian street address. */
function australianStreetAddress(value: string) {
  const parts = value.trim().match(/^((?:(?:(?:shop|unit|suite)\s+)?\d+\s*[a-z]?\s*\/\s*)?\d+[a-z]?(?:\s*[-–]\s*\d+[a-z]?)?\s+[^,]+),\s*([^,]+?),?\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)(?:\s+(\d{4}))?(?:,?\s+Australia)?$/i);
  if (!parts) return null;
  const [, street, suburb, state, postcode] = parts;
  const componentKey = (part: string) => part.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const unitPrefix = street.match(/^(?:(?:shop|unit|suite)\s+)?(\d+\s*[a-z]?)\s*\/\s*/i);
  const unit = unitPrefix?.[1].replace(/\s/g, "").toLowerCase();
  const streetKey = componentKey(street.slice(unitPrefix?.[0].length ?? 0))
    .replace(/(\d[a-z]?)\s*([-/])\s*(?=\d)/g, "$1$2")
    .replace(/\b[a-z]+$/, (suffix) => australianStreetTypes[suffix] ?? suffix);
  return { street: streetKey, unit, suburb: componentKey(suburb), state: state.toUpperCase(), postcode };
}

/** Same street, suburb, state and unit; the postcode may be missing from the source when it is source-backed. */
function matchesStreetAddress(source: string, found: string, sourceBacked: boolean): boolean {
  const expected = australianStreetAddress(source);
  const actual = australianStreetAddress(found);
  if (!expected || !actual) return addressKey(source) === addressKey(found);
  return expected.street === actual.street && expected.suburb === actual.suburb && expected.state === actual.state &&
    expected.unit === actual.unit && (expected.postcode === actual.postcode || (sourceBacked && !expected.postcode));
}

/** A venue name compared loosely: case, punctuation and a Latin alias in brackets after a non-Latin name do not matter. */
function nameKey(name: string): string {
  const normal = name.normalize("NFKC");
  const alias = normal.match(/^(.+?)\s*\(([A-Za-z][A-Za-z .-]*)\)$/);
  const base = alias && /[^\p{Script=Latin}\p{P}\p{Z}\p{N}]/u.test(alias[1]) ? alias[1] : normal;
  return foldLatin(base).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Latin letters without accents ("Trần" is "Tran", "Đồng" is "Dong"); other scripts are left exactly as they are. */
function foldLatin(value: string): string {
  return value.replace(/[đĐ]/g, (letter) => (letter === "đ" ? "d" : "D"))
    .normalize("NFD").replace(/(\p{Script=Latin})\p{M}+/gu, "$1").normalize("NFC");
}

/** The venue's own name: no brackets, and no descriptor after a dash or bar ("Pour - Matcha cafe" is "Pour"). */
function coreName(name: string): string {
  const core = name.replace(/\([^)]*\)/g, " ").split(/\s+[-–—|]\s+/)[0].trim();
  return core || name;
}

/** Words that say what kind of address part it is, not where: they do not count as evidence of place. */
const ADDRESS_FILLER = new Set([
  "street", "st", "road", "rd", "avenue", "ave", "highway", "hwy", "drive", "dr", "place", "pl", "lane", "ln", "terrace", "tce",
  "parade", "pde", "crescent", "cres", "court", "ct", "close", "cl", "boulevard", "bvd", "square", "sq", "shop", "unit", "suite",
  "level", "floor", "ward", "district", "city", "province", "phuong", "quan", "huyen", "tinh", "thanh", "pho", "duong", "dist",
  "australia", "vietnam", "viet", "nam", "nsw", "vic", "qld", "sa", "wa", "tas", "act", "nt", "the", "of", "and", "at", "near",
]);

/**
 * A state written out in full at the end of an address ("Chatswood, New South Wales, Australia") never appears that way
 * in Google's address ("NSW"), so it is not evidence of place on either side. Taken off, it cannot make a good match
 * look bad. Only at the end, so a venue called "Victoria Park" keeps its name.
 */
const TRAILING_STATE = /(?:^|,)\s*(new south wales|australian capital territory|northern territory|south australia|western australia|queensland|tasmania|victoria)\s*(?:,\s*australia)?\s*$/;
const STATE_ABBREVIATION: Record<string, string> = {
  "new south wales": "NSW", "australian capital territory": "ACT", "northern territory": "NT", "south australia": "SA",
  "western australia": "WA", queensland: "QLD", tasmania: "TAS", victoria: "VIC",
};

/** The words of an address that say where it is, accents and punctuation ignored. */
function addressWords(address: string): string[] {
  return foldLatin(address.normalize("NFKC")).toLowerCase().replace(TRAILING_STATE, " ").split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word && !ADDRESS_FILLER.has(word));
}

/** The house number of a street address ("215B Nguyen Trai" is "215b"), or null. */
function houseNumber(address: string): string | null {
  return foldLatin(address).toLowerCase().match(/(?:^|[\s,])(\d+[a-z]?)(?:\s*[-/]\s*\d+[a-z]?)?\s+\p{L}/u)?.[1] ?? null;
}

/**
 * Any country: the same house number and most of the same place words ("120 Pham Van Dong street, Ward 3, Go Vap" is
 * "120 Phạm Văn Đồng, Phường 3, Gò Vấp"). Australian addresses keep the stricter check below.
 */
function looseStreetMatch(source: string, found: string): boolean {
  const number = houseNumber(source);
  if (!number || number !== houseNumber(found)) return false;
  return mostWordsPresent(addressWords(source).filter((word) => word !== number), new Set(addressWords(found)), 0.6);
}

/** An address with no street number, only a suburb or city: its words must be in Google's address. */
function areaMatch(source: string, found: string): boolean {
  return mostWordsPresent(addressWords(source), new Set(addressWords(found)), 0.5);
}

function mostWordsPresent(words: string[], inFound: Set<string>, share: number): boolean {
  if (!words.length) return false;
  return words.filter((word) => inFound.has(word)).length / words.length >= share;
}

/** Guesses where the place is, only to bias Google's ranking: Australia unless the address says otherwise. */
function regionFor(address: string | undefined): string | null {
  if (!address) return "AU";
  if (/vietnam|việt nam|ho chi minh|hồ chí minh|hanoi|hà nội|phường|quận|đ|ư|ơ|ă/i.test(address)) return "VN";
  if (/\b(australia|ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i.test(address)) return "AU";
  return /[^\p{ASCII}]/u.test(address) || /\b(japan|thailand|indonesia|singapore|korea|china|usa|uk|france|italy|india|malaysia)\b/i.test(address) ? null : "AU";
}

/** Staging reads the Google key from its own environment; everywhere else it is the shared secret. */
async function resolverMapsKey(): Promise<string> {
  if (isStagingProviderTarget()) {
    const stagingKey = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
    if (stagingKey) return stagingKey;
  }
  return getGoogleMapsApiKey();
}

type VerifyInput = { url?: string; name?: string; address?: string; outdoor?: boolean; addressFromSource?: boolean };
type VerifyDiagnostics = {
  outcome: string;
  query?: string;
  candidateCount?: number;
  candidates?: { id: string | null; name: string | null; address: string | null; outcome: string }[];
};

/**
 * Confirms exactly one Google place for a venue, or returns null. Never a
 * guess: with a link it needs the place id or the exact pin; otherwise a full
 * street address (or a named outdoor locality) must match exactly one result.
 * More than one match, or none, is "no match".
 */
/** A place offered to the user to choose from (never saved by itself). */
export type Candidate = { name: string; address: string; lat: number; lon: number; type: VenueType | null; placeId?: string };
/** Why a name+address check did not verify, and the Google places the user can choose from instead. */
export type VerifyOutcome = { reason?: "ambiguous" | "no_match"; candidates?: Candidate[]; weak?: boolean };

/** "Sculpture by the Sea, Bondi" is the venue "Sculpture by the Sea" in the locality "Bondi". */
function splitLocality(name: string): { base: string; locality: string | null } {
  const comma = name.indexOf(",");
  if (comma < 0) return { base: name, locality: null };
  const base = name.slice(0, comma).trim();
  const locality = name.slice(comma + 1).trim();
  return base && locality ? { base, locality } : { base: name, locality: null };
}

/** The words of `locality` appear in `address` as whole words, in order, ignoring case and punctuation. */
function hasPlaceWords(address: string, locality: string): boolean {
  const padded = (value: string) => ` ${addressKey(value)} `;
  return padded(address).includes(padded(locality));
}

/** One name inside the other as whole words: "kiddo coffee" is in "kiddo coffee redfern". For choices only, never for verifying. */
function wordsContain(a: string, b: string): boolean {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.length >= 3 && ` ${longer} `.includes(` ${shorter} `);
}

const AU_STATE = /\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i;
const AU_POSTCODE = /\b(\d{4})\b/;
/** Two addresses in different states, or with different postcodes, are different places. */
function stateAndPostcodeAgree(source: string, found: string): boolean {
  const stateOf = (text: string): string | undefined => {
    const abbreviation = text.match(AU_STATE)?.[1].toUpperCase();
    if (abbreviation) return abbreviation;
    const full = text.toLowerCase().match(TRAILING_STATE)?.[1];
    return full ? STATE_ABBREVIATION[full] : undefined;
  };
  const sourceState = stateOf(source);
  const foundState = stateOf(found);
  if (sourceState && foundState && sourceState !== foundState) return false;
  const sourcePostcode = source.match(AU_POSTCODE)?.[1];
  const foundPostcode = found.match(AU_POSTCODE)?.[1];
  return !(sourcePostcode && foundPostcode && sourcePostcode !== foundPostcode);
}

function validCoords(place: Place): place is Place & { name: string; address: string; lat: number; lon: number } {
  return !!place.name && !!place.address && place.lat != null && place.lon != null && Number.isFinite(place.lat) &&
    Number.isFinite(place.lon) && Math.abs(place.lat) <= 90 && Math.abs(place.lon) <= 180;
}

/** Up to `limit` usable Google places, in Google's order, for the user to choose from. */
function toCandidates(places: Place[], limit = 3): Candidate[] {
  return places.filter(validCoords).slice(0, limit)
    .map((place) => ({
      name: place.name, address: place.address, lat: place.lat, lon: place.lon, type: place.type,
      ...(place.id ? { placeId: place.id } : {}),
    }));
}

async function verifyPlace(
  input: VerifyInput,
  apiKey: string,
  diagnostics?: VerifyDiagnostics,
  outcome?: VerifyOutcome,
): Promise<(PlaceResult & { verified: true }) | null> {
  let { name } = input;
  const { address } = input;
  let pin: Coord | null = null;
  let placeId: string | null = null;
  if (input.url) {
    const fullUrl = await expandShortLink(input.url, true);
    if (!isMapsUrl(fullUrl)) return null;
    const url = new URL(fullUrl);
    const exactPin = fullUrl.match(/!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    placeId = extractPlaceId(fullUrl);
    if (url.pathname.startsWith("/maps/place/") && exactPin) {
      pin = { lat: Number(exactPin[1]), lng: Number(exactPin[2]) };
      if (Math.abs(pin.lat) > 90 || Math.abs(pin.lng) > 180) return null;
    }
    if (!placeId && !pin) return null;
    name = extractPlaceName(fullUrl) ?? undefined;
  }
  if (!name || (!placeId && !pin && !address)) return null;
  const expectedName = nameKey(name);
  if (!expectedName) return null;
  const fullStreet = !!address && (!!australianStreetAddress(address) ||
    /^\s*(?:[^,]{0,30},\s*)?\d+[a-z]?(?:[-/]\d+[a-z]?)?\s+[^,]+,\s*\S/i.test(address));
  // A suburb or city is enough to search Google with the name; the match still needs the name and place words to agree.
  const areaOnly = !fullStreet && !!address && addressWords(address).length > 0;
  if (!placeId && !pin && !fullStreet && !areaOnly) return null;
  const query = address ? `${name}, ${address}` : name;
  if (diagnostics) diagnostics.query = query;
  const places = await searchPlaces(query, pin, apiKey, 5, regionFor(address));
  // "Sculpture by the Sea, Bondi": the venue's own name, with the locality after the comma.
  const { base, locality } = splitLocality(name);
  const baseName = locality ? nameKey(base) : null;
  const coreKey = nameKey(coreName(locality ? base : name));
  const nameFits = (place: Place): boolean => !!place.name && (nameKey(place.name) === expectedName ||
    (baseName !== null && nameKey(place.name) === baseName));
  // Looser: Google adds a branch or a descriptor ("heytea bake lab+" is "heytea bake lab+ Chatswood Store"). Accents never matter.
  const sameWords = (a: string, b: string): boolean => !!a && !!b && Math.min(a.length, b.length) >= 4 && wordsContain(a, b);
  const looseFits = (place: Place): boolean => {
    if (!place.name) return false;
    if (nameFits(place)) return true;
    const placeKey = nameKey(place.name);
    const placeCore = nameKey(coreName(place.name));
    return [expectedName, baseName ?? "", coreKey].some((key) => !!key && (placeCore === key || sameWords(placeKey, key) || sameWords(placeCore, key)));
  };
  const streetMatches = (found: string): boolean => !!address && (australianStreetAddress(address)
    ? matchesStreetAddress(address, found, input.addressFromSource === true) : looseStreetMatch(address, found));
  const ambiguousName = !placeId && !pin && !input.addressFromSource &&
    places.filter((place) => nameFits(place)).length > 1;
  const compare = (place: Place): string => {
    if (!validCoords(place)) return "missing_or_invalid_place_data";
    if (placeId) return place.id === placeId ? "match" : "place_id_mismatch";
    // The locality part of the name must really be in Google's address, or the short name is not enough.
    if (!looseFits(place)) return "name_mismatch";
    if (locality && nameKey(place.name ?? "") !== expectedName && !hasPlaceWords(place.address, locality)) return "name_mismatch";
    if (pin) return kmBetween(pin, { lat: place.lat, lng: place.lon }) <= 0.1 ? "match" : "pin_mismatch";
    if (!address) return "missing_source_address";
    if (fullStreet) return streetMatches(place.address) ? "match" : "street_address_mismatch";
    // No street number (a suburb, a city, or an outdoor place): any Australian state or postcode must agree, then the place words.
    if (!stateAndPostcodeAgree(address, place.address)) return "area_locality_mismatch";
    if (locality) return hasPlaceWords(place.address, locality) ? "match" : "area_locality_mismatch";
    return areaMatch(address, place.address) ? "match" : "area_locality_mismatch";
  };
  const evaluated = places.map((place) => ({ place, outcome: compare(place) }));
  const matches = evaluated.filter((candidate) => candidate.outcome === "match").map((candidate) => candidate.place);
  if (diagnostics) {
    diagnostics.candidateCount = places.length;
    diagnostics.outcome = !places.length ? "no_candidates"
      : ambiguousName || matches.length > 1 ? "ambiguous"
      : matches.length === 1 ? "verified" : "no_matching_candidate";
    diagnostics.candidates = evaluated.map(({ place, outcome }) => ({
      id: place.id, name: place.name, address: place.address, outcome,
    }));
  }
  if (outcome && !placeId && !pin) {
    // Choices come from this same search: no second paid request. The user picks one; nothing is saved from here.
    // Related = the name fits, or one name sits inside the other (a branch: "Kiddo Coffee Redfern").
    const related = (place: Place): boolean => looseFits(place) || (!!place.name && (
      wordsContain(nameKey(place.name), expectedName) || (baseName !== null && wordsContain(nameKey(place.name), baseName))));
    // Best first: the exact name, then the same street address (or the same area), then Google's own order.
    const addressAgrees = (place: Place): boolean => !!address && !!place.address &&
      (fullStreet ? streetMatches(place.address) : areaMatch(address, place.address));
    const rankOf = (place: Place): number =>
      (place.name && (nameKey(place.name) === expectedName || (baseName !== null && nameKey(place.name) === baseName)) ? 0 : 2) +
      (addressAgrees(place) ? 0 : 1);
    const ranked = (list: Place[]) => [...list].sort((a, b) => rankOf(a) - rankOf(b));
    if (ambiguousName || matches.length > 1) {
      outcome.reason = "ambiguous";
      outcome.candidates = toCandidates(ranked(matches.length > 1 ? matches : places.filter(nameFits)));
    } else if (matches.length === 0) {
      outcome.reason = "no_match";
      const relatedPlaces = places.filter(related);
      if (relatedPlaces.length) outcome.candidates = toCandidates(ranked(relatedPlaces));
      else {
        // Nothing resembles the name: offer Google's closest results, labelled as weak, so the user can search or pick.
        // When the source says the place is in Australia (a state, or "Australia"), results from other countries are not offered
        // (a Las Vegas buffet for a Sydney post). Anywhere else, or when nothing Australian came back, every result stays.
        const inAustralia = (text: string): boolean => /\bAustralia\b/i.test(text) || AU_STATE.test(text);
        const here = address && inAustralia(address) ? places.filter((place) => /,\s*Australia\s*$/i.test(place.address ?? "")) : [];
        outcome.candidates = toCandidates(here.length ? here : places);
        outcome.weak = true;
      }
    }
  }
  if (ambiguousName || matches.length !== 1) return null;
  const [place] = matches;
  return {
    name: place.name, address: place.address, lat: place.lat, lon: place.lon, type: place.type, verified: true,
    ...(place.id ? { placeId: place.id } : {}),
  };
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
    const res = await providerFetch(
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
    const res = await providerFetch(`https://maps.googleapis.com/maps/api/geocode/json?place_id=${encodeURIComponent(placeId)}&key=${apiKey}`);
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
    const res = await providerFetch(
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
  // A name with no address still saves the user retyping it.
  return name ? { ...EMPTY, name } : EMPTY;
}

const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60 * 60;

Deno.serve(withStagingProviderControls("resolve-place", async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const started = Date.now();
  try {
    // This endpoint spends Google Maps quota, so it requires a real signed-in
    // user rather than the public anon key, and is capped per user.
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const { url, verify, name, address, outdoor, addressFromSource, verificationDiagnostics, search, query } = await req.json();
    // Verification and search gate what gets saved, so if the limit cannot be checked they fail closed.
    const gated = verify === true || search === true;
    const limit = await consumeRateLimit(
      "resolve-place", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS, gated ? { failClosed: true } : undefined,
    );
    if (!limit.available && gated) return json(req, { error: "Place verification is temporarily unavailable" }, 503);
    if (!limit.allowed) {
      return json(
        req,
        { error: "Rate limit reached. Try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    // verify: true answers with `verified: true` and the Google place only when
    // exactly one place matches. Anything else is the empty result: a no-match,
    // not an error. Failures to run the check are real errors (non-200).
    // search: one Text Search for what the user typed, for "Change location". Google places only; nothing is saved here.
    if (search === true) {
      if (typeof query !== "string" || !query.trim() || query.length > 200) {
        return json(req, { error: "A place search of 1–200 characters is required" }, 400);
      }
      const places = await searchPlaces(query.trim(), null, await resolverMapsKey(), 5);
      stageLog("resolve-place", "search", started, places.length ? "found" : "none", { count: places.length });
      return json(req, { candidates: toCandidates(places, 5) }, 200, { "Cache-Control": "no-store" });
    }

    if (verify === true) {
      // Candidate-by-candidate outcomes, for listed staging test accounts only.
      const canDiagnose = verificationDiagnostics === true && isStagingProviderTarget() &&
        (Deno.env.get("STAGING_PROVIDER_USERS") ?? "").split(",").some((id) => id.trim() === auth.user.id);
      const diagnostics: VerifyDiagnostics | undefined = canDiagnose ? { outcome: "insufficient_source_evidence" } : undefined;
      // A non-match carries its reason and Google's candidates only when there are some; otherwise it is the plain empty result.
      const verificationResponse = (place: PlaceResult | null, outcome: VerifyOutcome = {}, mode = "name_address") => {
        stageLog("resolve-place", "verify", started, place ? "match" : (outcome.reason ?? "empty"), {
          mode, count: outcome.candidates?.length ?? 0, weak: outcome.weak === true, outdoor: outdoor === true,
          source_address: addressFromSource === true,
        });
        const choices = outcome.candidates?.length
          ? { reason: outcome.reason, candidates: outcome.candidates, ...(outcome.weak ? { weak: true } : {}) } : {};
        const body = place ?? { ...EMPTY, ...choices };
        return diagnostics
          ? json(req, { ...body, verificationDiagnostics: diagnostics }, 200, { "Cache-Control": "no-store" })
          : json(req, body);
      };
      if (typeof url === "string" && url.length <= 2048 && isMapsUrl(url)) {
        return verificationResponse(await verifyPlace({ url }, await resolverMapsKey(), diagnostics), {}, "maps_link");
      }
      if (typeof name !== "string" || typeof address !== "string" || !name.trim() || name.length > 200 || !address.trim() || address.length > 500) {
        return json(req, { error: "A Maps link or venue name and address are required" }, 400);
      }
      const outcome: VerifyOutcome = {};
      const place = await verifyPlace({
        name: name.trim(),
        address: address.trim(),
        outdoor: outdoor === true,
        addressFromSource: addressFromSource === true,
      }, await resolverMapsKey(), diagnostics, outcome);
      return verificationResponse(place, outcome);
    }

    if (typeof url !== "string" || !url.trim()) {
      return json(req, { error: "url is required" }, 400);
    }
    if (!isMapsUrl(url.trim())) {
      return json(req, EMPTY);
    }

    const apiKey = await resolverMapsKey();
    const resolved = await resolve(url.trim(), apiKey);
    stageLog("resolve-place", "resolve_link", started, resolved.address ? "found" : resolved.name ? "name_only" : "none");
    return json(req, resolved);
  } catch (err) {
    stageLog("resolve-place", "request", started, "internal_error");
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[resolve-place] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
}));
