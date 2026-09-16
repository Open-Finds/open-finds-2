import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";


type Coord = { lat: number; lng: number };

type Destination = string | { address: string; lat?: number; lon?: number };

type VenueDistance = {
  durationSeconds: number | null;
  durationText: string | null;
  error?: boolean;
  lat?: number | null;
  lon?: number | null;
};

async function getGoogleMapsApiKey(): Promise<string> {
  const { data, error } = await serviceClient()
    .from("app_secrets")
    .select("value")
    .eq("key", "GOOGLE_MAPS_API_KEY")
    .maybeSingle();
  if (error || !data) throw new Error("Google Maps API key not found");
  return data.value as string;
}

async function geocode(address: string, apiKey: string): Promise<Coord | null> {
  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
      return { lat: loc.lat, lng: loc.lng };
    }
    return null;
  } catch {
    return null;
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
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

    const limit = await consumeRateLimit("travel-times", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) {
      return json(
        req,
        { error: "Rate limit reached. Try again shortly." },
        429,
        { "Retry-After": String(limit.retryAfter) },
      );
    }

    const { origin, destinations } = await req.json();
    if (!origin) {
      return json(req, { error: "origin is required" }, 400);
    }
    if (!Array.isArray(destinations) || destinations.length === 0) {
      return json(req, { error: "destinations must be a non-empty array" }, 400);
    }

    const apiKey = await getGoogleMapsApiKey();

    // Resolve origin coordinates
    let originCoord: Coord | null = null;
    if (typeof origin === "object" && origin.lat != null && origin.lon != null) {
      originCoord = { lat: origin.lat, lng: origin.lon };
    } else if (typeof origin === "string" && origin.trim()) {
      originCoord = await geocode(origin.trim(), apiKey);
    }

    if (!originCoord) {
      const results: VenueDistance[] = destinations.map(() => ({
        durationSeconds: null,
        durationText: null,
        error: true,
      }));
      return json(req, { distances: results });
    }

    // Resolve each destination's coordinates
    const destCoords: (Coord | null)[] = [];
    for (let i = 0; i < destinations.length; i++) {
      const dest = destinations[i] as Destination;
      if (typeof dest === "object" && dest.lat != null && dest.lon != null) {
        destCoords.push({ lat: dest.lat, lng: dest.lon });
      } else {
        const addr = typeof dest === "string" ? dest : dest.address;
        const c = await geocode(addr.trim(), apiKey);
        destCoords.push(c);
      }
    }

    // Build results array
    const results: VenueDistance[] = destinations.map(() => ({
      durationSeconds: null,
      durationText: null,
      error: true,
    }));

    // Attach coordinates to every result
    for (let i = 0; i < destCoords.length; i++) {
      if (destCoords[i]) {
        results[i].lat = destCoords[i]!.lat;
        results[i].lon = destCoords[i]!.lng;
      }
    }

    // Collect valid destinations for Distance Matrix batch query
    const validIndices: number[] = [];
    const destCoordStrings: string[] = [];
    for (let i = 0; i < destCoords.length; i++) {
      if (destCoords[i]) {
        validIndices.push(i);
        destCoordStrings.push(`${destCoords[i]!.lat},${destCoords[i]!.lng}`);
      }
    }

    // Query Google Distance Matrix for driving times (batch all valid destinations)
    if (validIndices.length > 0) {
      const dmUrl =
        `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${originCoord.lat},${originCoord.lng}` +
        `&destinations=${destCoordStrings.join("|")}` +
        `&mode=driving&units=metric&key=${apiKey}`;

      try {
        const res = await fetch(dmUrl);
        if (res.ok) {
          const data = await res.json();
          const rows = data?.rows;
          if (Array.isArray(rows) && rows.length > 0) {
            const elements = rows[0]?.elements;
            if (Array.isArray(elements)) {
              for (let vi = 0; vi < validIndices.length && vi < elements.length; vi++) {
                const origIdx = validIndices[vi];
                const el = elements[vi];
                if (el?.status === "OK" && typeof el.duration?.value === "number") {
                  const secs = el.duration.value;
                  results[origIdx] = {
                    durationSeconds: secs,
                    durationText: formatDuration(secs),
                    error: false,
                    lat: destCoords[origIdx]?.lat,
                    lon: destCoords[origIdx]?.lng,
                  };
                }
              }
            }
          }
        }
      } catch {
        // Distance Matrix failed — leave results as error
      }
    }

    return json(req, { distances: results });
  } catch (err) {
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[travel-times] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
