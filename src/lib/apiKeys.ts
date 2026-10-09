import { edgeAuthHeaders } from './edgeAuth';
import type { VenueType } from './supabase';

/** The starting point typed in couldn't be found. The message is for the user. */
export class LocationNotFoundError extends Error {
  constructor(place: string) {
    super(`We couldn't find "${place}". Try a suburb, a postcode like 2000, or a full address.`);
    this.name = 'LocationNotFoundError';
  }
}
export type VenueDistance = {
  venueKey: string;
  durationSeconds: number | null;
  durationText: string | null;
  error?: boolean;
  lat?: number | null;
  lon?: number | null;
};

export type DestinationInput = string | {
  address: string;
  lat?: number | null;
  lon?: number | null;
};

export type OriginInput = string | { lat: number; lon: number };

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

// Fetches driving times from one origin to multiple destinations via the
// deployed travel-times edge function. The origin can be a street address
// (geocoded server-side) or a {lat, lon} pair (e.g. from device GPS, which
// skips geocoding entirely). Destinations can also include pre-stored
// lat/lon coordinates so the edge function can skip geocoding them.
//
// Returns null when travel times can't be had, and throws
// LocationNotFoundError when the typed origin isn't a place, so the screen
// can say that rather than "nothing within 30 min".
export async function fetchDistanceMatrix(
  origin: OriginInput,
  destinations: DestinationInput[]
): Promise<VenueDistance[] | null> {
  const hasOrigin =
    typeof origin === "string"
      ? origin.trim().length > 0
      : origin.lat != null && origin.lon != null;
  if (!hasOrigin || destinations.length === 0) return null;

  const result = await requestTravelTimes(origin, destinations);
  if (result === 'origin-not-found') {
    throw new LocationNotFoundError(typeof origin === 'string' ? origin.trim() : 'your location');
  }
  return result;
}

async function requestTravelTimes(
  origin: OriginInput,
  destinations: DestinationInput[]
): Promise<VenueDistance[] | null | 'origin-not-found'> {
  try {
    const apiUrl = `${SUPABASE_URL}/functions/v1/travel-times`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: await edgeAuthHeaders(),
      body: JSON.stringify({ origin, destinations }),
    });

    if (!res.ok) {
      console.warn('[travel-times] edge function HTTP error', { status: res.status });
      return null;
    }

    const data = await res.json();
    if (data?.error) {
      console.warn('[travel-times] edge function returned error', { error: data.error });
      return null;
    }
    if (data?.originError === 'not_found') return 'origin-not-found';

    const distances = data?.distances;
    if (!Array.isArray(distances)) {
      console.warn('[travel-times] unexpected response shape', { data });
      return null;
    }

    return distances.map((d: Omit<VenueDistance, 'venueKey'>) => ({
      venueKey: '',
      durationSeconds: d.durationSeconds ?? null,
      durationText: d.durationText ?? null,
      error: d.error ?? false,
      lat: d.lat ?? null,
      lon: d.lon ?? null,
    }));
  } catch (err) {
    console.warn('[travel-times] fetch failed', { origin, error: err });
    return null;
  }
}

export type ResolvedPlace = {
  name: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  /** From Google's place types, when Google knows them. */
  type: VenueType | null;
  /** 'review': a link to a Google review, which names no place. */
  hint?: 'review';
};

const GOOGLE_DOMAIN = /^(?:[a-z0-9-]+\.)*google\.(?:com|co)(?:\.[a-z]{2})?$|^(?:[a-z0-9-]+\.)*google\.[a-z]{2,3}$/;

/**
 * Any link the Google Maps app, the Maps website or Google search shares for
 * a place: maps.app.goo.gl/…, goo.gl/maps/…, g.co/kgs/…, share.google/…
 * (Google's newer Share button), a place's search result (…/search?kgmid=),
 * and google.com/maps on any country domain (google.com.au/maps/…). Kept in
 * step with the resolve-place edge function.
 */
export function isGoogleMapsLink(url: string): boolean {
  const raw = url.trim();
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    if (host === 'maps.app.goo.gl' || host === 'share.google') return true;
    if (host === 'goo.gl') return u.pathname.startsWith('/maps');
    if (host === 'g.co') return u.pathname.startsWith('/kgs');
    if (!GOOGLE_DOMAIN.test(host)) return false;
    if (u.pathname === '/search' && u.searchParams.has('kgmid')) return true;
    return host.startsWith('maps.') || u.pathname.startsWith('/maps');
  } catch {
    return false;
  }
}

export async function resolveGoogleMapsLink(url: string): Promise<ResolvedPlace | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-place`, {
      method: 'POST',
      headers: await edgeAuthHeaders(),
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error) return null;
    if (data.hint === 'review') return { name: null, address: null, lat: null, lon: null, type: null, hint: 'review' };
    if (!data.name && !data.address && data.lat == null) return null;
    const types: VenueType[] = ['food', 'bar', 'dessert', 'activity'];
    return {
      name: data.name ?? null,
      address: typeof data.address === 'string' ? tidyAddress(data.address) : null,
      lat: data.lat ?? null,
      lon: data.lon ?? null,
      type: types.includes(data.type) ? data.type : null,
    };
  } catch {
    return null;
  }
}

const AU_ADDRESS = /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b|\bAustralia\b/i;

/** "28 Princes Hwy, Kogarah NSW 2217" yes; "1-1-3, Chuo City, Tokyo" no. */
export function isAustralianAddress(address: string): boolean {
  return AU_ADDRESS.test(address);
}

/** One comma part with its postcode (2133, 150-0013, 〒150-0013, 90210) taken off. */
function withoutPostcode(part: string): string {
  return part.replace(/〒?\s*\d{3}-\d{4}/g, '').replace(/\b\d{4,5}(-\d{4})?\s*$/, '').trim();
}

/**
 * A real address has a street number; "Croydon Park NSW 2133" or
 * "Nakameguro, Meguro City, Tokyo 153-0061" is only an area. Postcodes don't count.
 */
export function hasStreetNumber(address: string): boolean {
  return address.split(',').some((part) => /\d/.test(withoutPostcode(part)));
}

/** The area part of an address: "1-1-1, Asakusa, Taito City, Tokyo" → "Asakusa, Taito City, Tokyo". */
export function areaOf(address: string): string {
  return address.split(',').map((p) => p.trim()).filter((p) => p && !/\d/.test(withoutPostcode(p))).join(', ');
}

/**
 * Google writes some Japanese addresses big-to-small with full-width digits,
 * even in English: "Japan, 〒150-0013 Tokyo, Shibuya, Ebisu, 1-chōme−6−６ Saito
 * Bldg., １階". This turns them round to "Level 1, 1-chōme-6-6 Saito Bldg.,
 * Ebisu, Shibuya, Tokyo 150-0013, Japan". Anything else comes back as it was.
 */
export function tidyAddress(address: string): string {
  const ascii = address
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−－]/g, '-')
    .replace(/(^|[\s,])(\d+)階/g, '$1Level $2');
  const m = ascii.match(/^Japan,\s*〒\s*(\d{3}-\d{4})\s*([^,]+),\s*(.+)$/);
  if (!m) return ascii === address ? address : ascii;
  const [, postcode, prefecture, rest] = m;
  const parts = rest.split(',').map((p) => p.trim()).filter(Boolean);
  return [...parts.reverse(), `${prefecture.trim()} ${postcode}`, 'Japan'].join(', ');
}

// Matches that are a place, not a venue: the AI's area words can pull the
// search to the park or neighbourhood a café sits beside.
const AREA_TYPES = new Set([
  'park', 'locality', 'sublocality', 'neighborhood', 'political', 'colloquial_area', 'country',
  'administrative_area_level_1', 'administrative_area_level_2', 'postal_code', 'route', 'natural_feature',
  'transit_station', 'train_station', 'airport',
]);
const GENERIC_WORDS = new Set(['city', 'ward', 'district', 'prefecture', 'street', 'road', 'shop', 'level', 'floor', 'building']);

/**
 * A venue's real address, looked up on Google by its name and city. The AI
 * finds venue names well in any language but can't always find addresses
 * (it invented "1-1-1, Asakusa" for a Tokyo café), so names are checked here.
 *
 * Searched with the name and only the city, not the AI's neighbourhood, and a
 * match has to be a business in the same area, so another branch, or the
 * park next door, isn't picked. Null when nothing fits; the caller keeps what
 * it had.
 */
export async function findVenueAddress(
  name: string,
  aiAddress: string,
): Promise<{ address: string; lat: number; lon: number } | null> {
  const australian = isAustralianAddress(aiAddress);
  const area = areaOf(aiAddress).split(',').map((p) => p.trim()).filter(Boolean);
  // Australia: the suburb part ("Croydon Park NSW 2133"). Elsewhere: the city
  // and the level above it ("Shibuya City, Tokyo"), without the postcode,
  // which the AI gets wrong abroad and which then pulls the search off course.
  const tail = (australian ? area.slice(-1) : area.slice(-2).map(withoutPostcode).filter(Boolean)).join(', ');
  // "茶亭 羽當 (Chatei Hatou)": Google knows the name as written.
  const cleanName = name.replace(/[（(][^)）]*[)）]/g, '').trim() || name;
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/geocode`, {
      method: 'POST',
      headers: await edgeAuthHeaders(),
      body: JSON.stringify({ address: tail ? `${cleanName}, ${tail}` : cleanName }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const found = typeof data?.address === 'string' ? tidyAddress(data.address) : '';
    if (data?.lat == null || data?.lon == null || !hasStreetNumber(found)) return null;
    const types: string[] = Array.isArray(data.types) ? data.types : [];
    const namedLikeAPlace = /\b(park|garden|gardens|beach)\b/i.test(cleanName);
    if (types.some((t) => AREA_TYPES.has(t)) && !(namedLikeAPlace && types.includes('park'))) return null;

    const lower = found.toLowerCase();
    let sameArea: boolean;
    if (australian) {
      const suburb = area[area.length - 1] ?? '';
      const postcode = aiAddress.match(/\b\d{4}\b/)?.[0];
      const suburbName = suburb.replace(/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b|\b\d{4}\b/gi, '').trim().toLowerCase();
      sameArea = postcode ? found.includes(postcode) : !!suburbName && lower.includes(suburbName);
    } else {
      const words = tail.toLowerCase().split(/[^a-z\u00c0-\u024f]+/).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w));
      sameArea = words.length === 0 || words.some((w) => lower.includes(w));
    }
    if (!sameArea) return null;
    return { address: found.replace(/,\s*Australia$/i, ''), lat: data.lat, lon: data.lon };
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/geocode`, {
      method: 'POST',
      headers: await edgeAuthHeaders(),
      body: JSON.stringify({ address }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.lat == null || data?.lon == null) return null;
    return { lat: data.lat, lon: data.lon };
  } catch {
    return null;
  }
}
