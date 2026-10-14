import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { getGoogleMapsApiKey } from "../_shared/maps.ts";

/**
 * A photo for one of the caller's saved venues, from Google Places, looked up
 * once and stored on the venue (saved_venues.photo_url). `refresh` looks again,
 * for when a stored photo address has stopped working.
 *
 * Costs a Places Text Search and a photo lookup the first time per venue, so
 * it's capped per user.
 */
const RATE_LIMIT = 200;
const RATE_WINDOW_SECONDS = 60 * 60;

async function findPhoto(name: string, address: string, apiKey: string): Promise<string | null> {
  const search = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.photos" },
    body: JSON.stringify({ textQuery: `${name} ${address}`, pageSize: 1, languageCode: "en" }),
  });
  if (!search.ok) {
    console.warn("[venue-photo] text search failed", search.status);
    return null;
  }
  const photoName = (await search.json())?.places?.[0]?.photos?.[0]?.name as string | undefined;
  if (!photoName) return null;
  const media = await fetch(`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=480&skipHttpRedirect=true&key=${apiKey}`);
  if (!media.ok) return null;
  return ((await media.json())?.photoUri as string | undefined) ?? null;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const { venue_id, refresh } = await req.json().catch(() => ({}));
    if (typeof venue_id !== "string") return json(req, { error: "venue_id is required" }, 400);

    const db = serviceClient();
    const { data: venue } = await db
      .from("saved_venues")
      .select("id, name, address, photo_url, photo_checked_at")
      .eq("id", venue_id)
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (!venue) return json(req, { error: "Not found" }, 404);
    if (venue.photo_checked_at && !refresh) return json(req, { url: venue.photo_url ?? null });

    const limit = await consumeRateLimit("venue-photo", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS);
    if (!limit.allowed) return json(req, { url: null }, 429, { "Retry-After": String(limit.retryAfter) });

    const url = await findPhoto(venue.name, venue.address, await getGoogleMapsApiKey());
    await db.from("saved_venues").update({ photo_url: url, photo_checked_at: new Date().toISOString() }).eq("id", venue.id);
    return json(req, { url });
  } catch (err) {
    console.error("[venue-photo] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
