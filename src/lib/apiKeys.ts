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
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Fetches driving times from one origin to multiple destinations via the
// deployed travel-times edge function. The origin can be a street address
// (geocoded server-side) or a {lat, lon} pair (e.g. from device GPS, which
// skips geocoding entirely). Destinations can also include pre-stored
// lat/lon coordinates so the edge function can skip geocoding them.
export async function fetchDistanceMatrix(
  origin: OriginInput,
  destinations: DestinationInput[]
): Promise<VenueDistance[] | null> {
  const hasOrigin =
    typeof origin === "string"
      ? origin.trim().length > 0
      : origin.lat != null && origin.lon != null;
  if (!hasOrigin || destinations.length === 0) return null;

  try {
    const apiUrl = `${SUPABASE_URL}/functions/v1/travel-times`;
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
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
};

export function isGoogleMapsLink(url: string): boolean {
  const lower = url.toLowerCase().trim();
  return (
    lower.includes("google.com/maps") ||
    lower.includes("maps.google.com") ||
    lower.includes("maps.app.goo.gl")
  );
}

export async function resolveGoogleMapsLink(url: string): Promise<ResolvedPlace | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/resolve-place`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.error) return null;
    if (!data.name && !data.address && data.lat == null) return null;
    return {
      name: data.name ?? null,
      address: data.address ?? null,
      lat: data.lat ?? null,
      lon: data.lon ?? null,
    };
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/geocode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
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
