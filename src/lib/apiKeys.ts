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
      address: data.address ?? null,
      lat: data.lat ?? null,
      lon: data.lon ?? null,
      type: types.includes(data.type) ? data.type : null,
    };
  } catch {
    return null;
  }
}

/** A real address has a street number; "Croydon Park NSW 2133" is only an area. */
export function hasStreetNumber(address: string): boolean {
  return /\d/.test(address.replace(/\b\d{4}\b\s*(,?\s*australia)?\s*$/i, ''));
}

/**
 * The street address for a venue known only by name and area, as captions
 * give it ("📍 Pocket Burger, Croydon Park"). The result has to be in the
 * same postcode, or the same suburb, so another branch elsewhere isn't
 * picked; otherwise null and the caller keeps what it had.
 */
export async function findStreetAddress(
  name: string,
  area: string,
): Promise<{ address: string; lat: number; lon: number } | null> {
  const parts = area.split(',').map((p) => p.trim()).filter(Boolean);
  const suburb = parts[parts.length - 1] ?? '';
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/geocode`, {
      method: 'POST',
      headers: await edgeAuthHeaders(),
      body: JSON.stringify({ address: `${name} ${suburb}`.trim() }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const found = typeof data?.address === 'string' ? data.address : '';
    if (data?.lat == null || data?.lon == null || !hasStreetNumber(found)) return null;
    const postcode = area.match(/\b\d{4}\b/)?.[0];
    const suburbName = suburb.replace(/\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b|\b\d{4}\b/gi, '').trim().toLowerCase();
    const sameArea = postcode ? found.includes(postcode) : !!suburbName && found.toLowerCase().includes(suburbName);
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
