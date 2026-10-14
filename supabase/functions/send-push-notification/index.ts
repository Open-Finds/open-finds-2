import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPush } from "../_shared/webpush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PushRequestBody {
  user_id?: string;
  user_ids?: string[];
  plan_id?: string;
  rsvp_name?: string;
  rsvp_status?: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  type?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const apiKey = req.headers.get("apikey") ?? "";
    if (!authHeader && !apiKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as PushRequestBody;

    // Create an authenticated client to verify the caller's session.
    // For authenticated requests (friend invites, etc.) the Authorization
    // header carries the user's JWT. For guest RSVP requests only the
    // anon apikey is present, so we validate the plan_id server-side.
    const isGuestRsvp = !!(body.plan_id && body.rsvp_name);

    if (!isGuestRsvp) {
      // Authenticated flow — verify the JWT and extract the caller's user ID.
      const token = authHeader.replace("Bearer ", "");
      if (!token || token === apiKey) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      const { data: { user }, error: userErr } = await authClient.auth.getUser();
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "Invalid session" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Resolve target user IDs and the notification text. Guest pushes have
    // their text composed server-side; only the authenticated path may supply it.
    let userIds: string[] = [];
    let resolvedTitle = "";
    let resolvedBody = "";
    let resolvedType = "general";
    let resolvedData: Record<string, unknown> | null = null;

    if (isGuestRsvp) {
      // Guest RSVP flow — unauthenticated, so nothing the caller sends is
      // trusted as display text. We verify the RSVP genuinely exists and then
      // compose the notification ourselves; previously title/body came
      // straight from the request, which made this an open channel for
      // pushing arbitrary text to any host whose plan id was known.
      // plans.user_id is the host's device id, not an account; notifications
      // and push subscriptions are keyed by the account in owner_id.
      const { data: plan } = await supabase
        .from("plans")
        .select("owner_id")
        .eq("id", body.plan_id)
        .maybeSingle();
      if (!plan) {
        return new Response(JSON.stringify({ error: "Plan not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const guestName = (body.rsvp_name ?? "").trim().slice(0, 80);
      if (!guestName) {
        return new Response(JSON.stringify({ error: "rsvp_name is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // The RSVP must already be on record. This ties a push to a real action
      // rather than letting anyone with a plan id generate notifications.
      const { data: rsvpRow } = await supabase
        .from("rsvps")
        .select("id, status")
        .eq("plan_id", body.plan_id)
        .eq("name", guestName)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!rsvpRow) {
        return new Response(JSON.stringify({ error: "No matching RSVP for this plan" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const isIn = (rsvpRow as { status?: string }).status === "in";
      resolvedTitle = isIn ? `${guestName} is coming!` : `${guestName} can't make it`;
      resolvedBody = isIn
        ? `${guestName} just RSVP'd "I'm In" to your plan.`
        : `${guestName} just declined your plan.`;
      resolvedType = "rsvp";
      // The host's view of the plan: who's coming.
      resolvedData = { type: "rsvp", plan_id: body.plan_id, url: `/#/plan/${body.plan_id}/dashboard` };

      if (!plan.owner_id) {
        // A plan made before the host signed in has no account to notify.
        return new Response(JSON.stringify({ sent: 0, failed: 0, total: 0, notified: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userIds = [plan.owner_id];
    } else {
      userIds = body.user_ids ?? (body.user_id ? [body.user_id] : []);
      resolvedTitle = (body.title ?? "").slice(0, 200);
      resolvedBody = (body.body ?? "").slice(0, 500);
      resolvedType = body.type ?? body.data?.type as string | undefined ?? "general";
      resolvedData = body.data ?? null;
    }

    if (userIds.length === 0 || !resolvedTitle) {
      return new Response(JSON.stringify({ error: "Unable to resolve notification target" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The in-app notification is the reliable channel and is written first,
    // unconditionally. Push is best-effort on top of it: previously a missing
    // VAPID key returned 500 *before* this insert, so an unconfigured push
    // silently cost the host their in-app notification too.
    const notifications = userIds.map((uid) => ({
      user_id: uid,
      type: resolvedType,
      title: resolvedTitle,
      body: resolvedBody || null,
      data: resolvedData,
    }));
    const { error: insertErr } = await supabase.from("notifications").insert(notifications);
    if (insertErr) {
      console.error("[push] in-app notification insert failed", insertErr.message);
    }

    const result = await sendPush(supabase, userIds, {
      title: resolvedTitle,
      body: resolvedBody,
      data: resolvedData ?? {},
    });
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
