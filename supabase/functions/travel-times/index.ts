import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { type Coord, geocodeAU, getGoogleMapsApiKey, logGoogleError, mapLimit } from "../_shared/maps.ts";

type Destination = string | { address: string; lat?: number | null; lon?: number | null };

type VenueDistance = {
  durationSeconds: number | null;
  durationText: string | null;
  error?: boolean;
  lat?: number | null;
  lon?: number | null;
};

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

const RATE_LIMIT = 60;
const RATE_WINDOW_SECONDS = 60 * 60;
/** Google's limit on destinations in one Distance Matrix request. */
const MATRIX_BATCH = 25;
/** Each destination can cost a geocode; cap what one request may spend. */
const MAX_DESTINATIONS = 100;

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

    const results: VenueDistance[] = destinations.map(() => ({
      durationSeconds: null,
      durationText: null,
      error: true,
    }));

    const apiKey = await getGoogleMapsApiKey();

    // Resolve the origin. A typed place that can't be found is reported as
    // such, so the app can say so instead of "nothing within 30 min".
    let originCoord: Coord | null = null;
    let originAddress: string | null = null;
    if (typeof origin === "object" && origin.lat != null && origin.lon != null) {
      originCoord = { lat: origin.lat, lng: origin.lon };
    } else if (typeof origin === "string" && origin.trim()) {
      const found = await geocodeAU(origin, apiKey);
      originCoord = found.coord;
      originAddress = found.formattedAddress;
      if (!originCoord) {
        const originError = found.status === "ZERO_RESULTS" ? "not_found" : "unavailable";
        return json(req, { distances: results, originError });
      }
    }
    if (!originCoord) {
      return json(req, { distances: results, originError: "not_found" });
    }

    // Venues saved with coordinates skip geocoding; the rest are looked up a
    // few at a time rather than one after another.
    const wanted = (destinations as Destination[]).slice(0, MAX_DESTINATIONS);
    const destCoords: (Coord | null)[] = await mapLimit(wanted, 5, async (dest) => {
      if (typeof dest === "object" && dest.lat != null && dest.lon != null) {
        return { lat: dest.lat, lng: dest.lon };
      }
      const addr = typeof dest === "string" ? dest : dest?.address;
      if (typeof addr !== "string" || !addr.trim()) return null;
      return (await geocodeAU(addr, apiKey)).coord;
    });
    destCoords.forEach((c, i) => {
      if (c) {
        results[i].lat = c.lat;
        results[i].lon = c.lng;
      }
    });

    const valid = destCoords
      .map((c, i) => (c ? { i, c } : null))
      .filter((v): v is { i: number; c: Coord } => v !== null);

    for (let start = 0; start < valid.length; start += MATRIX_BATCH) {
      const batch = valid.slice(start, start + MATRIX_BATCH);
      const dmUrl =
        `https://maps.googleapis.com/maps/api/distancematrix/json` +
        `?origins=${originCoord.lat},${originCoord.lng}` +
        `&destinations=${batch.map(({ c }) => `${c.lat},${c.lng}`).join("|")}` +
        `&mode=driving&units=metric&key=${apiKey}`;
      try {
        const res = await fetch(dmUrl);
        if (!res.ok) {
          console.error("[travel-times] Distance Matrix HTTP", res.status);
          continue;
        }
        const data = await res.json();
        if (data.status !== "OK") {
          logGoogleError("travel-times", data);
          continue;
        }
        const elements = data?.rows?.[0]?.elements;
        if (!Array.isArray(elements)) continue;
        batch.forEach(({ i, c }, k) => {
          const el = elements[k];
          if (el?.status === "OK" && typeof el.duration?.value === "number") {
            results[i] = {
              durationSeconds: el.duration.value,
              durationText: formatDuration(el.duration.value),
              error: false,
              lat: c.lat,
              lon: c.lng,
            };
          }
        });
      } catch (err) {
        console.error("[travel-times] Distance Matrix failed", String(err));
      }
    }

    return json(req, {
      distances: results,
      origin: { lat: originCoord.lat, lon: originCoord.lng, address: originAddress },
    });
  } catch (err) {
    // Upstream/config detail is logged, not returned — error text from the
    // Maps client can leak key state and internal identifiers.
    console.error("[travel-times] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
