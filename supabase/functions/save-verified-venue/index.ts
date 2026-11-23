import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { VENUE_CATEGORIES, type VenueCategory, verifyVenueToken } from "../_shared/venueToken.ts";

/**
 * Saves a Google-confirmed venue and links it to the shared venue record.
 *
 * The app sends the venue stamp that resolve-place issued with Google's
 * details. This function checks the caller's session and that the stamp is
 * genuine, unexpired and was issued to this caller, then saves through
 * save_verified_venue. Any refusal here is safe: the app falls back to its
 * normal, unlinked save, so nobody loses a venue.
 *
 * No Google or AI call is made, so there is no provider cost.
 */

const RATE_LIMIT = 120;
const RATE_WINDOW_SECONDS = 60 * 60;
const STORAGE_TYPES = new Set(["food", "dessert", "bar", "activity"]);

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json(req, { error: "A venue stamp is required" }, 400);
    const { venueToken, type, link, category, name, address } = body as Record<string, unknown>;

    const place = await verifyVenueToken(venueToken, auth.user.id);
    if (!place) return json(req, { error: "invalid_venue_token" }, 400);

    // Writes to a shared table: fail closed if the limit cannot be checked (the app then saves unlinked).
    const limit = await consumeRateLimit("save-verified-venue", auth.user.id, RATE_LIMIT, RATE_WINDOW_SECONDS, { failClosed: true });
    if (!limit.allowed) {
      return json(req, { error: "Rate limit reached. Try again shortly." }, limit.available ? 429 : 503,
        { "Retry-After": String(limit.retryAfter) });
    }

    // Google's place types decide the category; only when they say nothing does the saver's choice set it.
    const chosen = typeof category === "string" && VENUE_CATEGORIES.includes(category as VenueCategory)
      ? category as VenueCategory : null;
    const placeCategory = place.category ?? chosen ?? "activity";
    // The name and address shown to the person, for their own save only (the shared venue keeps Google's).
    const text = (value: unknown, max: number) => typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
    const save = {
      name: text(name, 200),
      address: text(address, 500),
      type: typeof type === "string" && STORAGE_TYPES.has(type) ? type : null,
      link: typeof link === "string" && link.length <= 2048 && link.startsWith("https://") ? link : null,
    };

    // Service role justification: save_verified_venue writes the shared venues table, which no API role may write.
    // The caller's session was verified above, the venue details come only from the verified stamp, and the
    // function scopes every read and write of saved_venues to that verified user id.
    const { data, error } = await serviceClient().rpc("save_verified_venue", {
      p_user: auth.user.id,
      p_place: { ...place, category: placeCategory },
      p_save: save,
    });
    if (error || !data) {
      console.error("[save-verified-venue] save failed", error?.code ?? "no_row");
      return json(req, { error: "Could not save this venue" }, 500);
    }
    return json(req, data, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("[save-verified-venue] internal error", String(err));
    return json(req, { error: "Internal error" }, 500);
  }
});
