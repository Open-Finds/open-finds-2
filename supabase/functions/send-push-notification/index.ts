import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5";

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

async function buildVapidKeyPair(privateKeyB64Url: string) {
  const tempKey = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", d: privateKeyB64Url, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"]
  );
  const fullJwk = await crypto.subtle.exportKey("jwk", tempKey);

  const privateKeyJwk = { kty: "EC", crv: "P-256", x: fullJwk.x, y: fullJwk.y, d: fullJwk.d, ext: true };
  const publicKeyJwk = { kty: "EC", crv: "P-256", x: fullJwk.x, y: fullJwk.y, ext: true };

  return webpush.importVapidKeys(
    { privateKey: privateKeyJwk, publicKey: publicKeyJwk },
    { extractable: false }
  );
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
      const { data: plan } = await supabase
        .from("plans")
        .select("user_id")
        .eq("id", body.plan_id)
        .maybeSingle();
      if (!plan?.user_id) {
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
      resolvedData = { type: "rsvp", url: `/plan/${body.plan_id}` };

      userIds = [plan.user_id];
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

    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!vapidPrivateKey) {
      return new Response(JSON.stringify({ error: "VAPID_PRIVATE_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vapidKeys = await buildVapidKeyPair(vapidPrivateKey);
    const appServer = await webpush.ApplicationServer.new({
      contactInformation: "mailto:noreply@openfinds.app",
      vapidKeys,
    });

    // Insert in-app notification rows for each user
    const notifications = userIds.map((uid) => ({
      user_id: uid,
      type: resolvedType,
      title: resolvedTitle,
      body: resolvedBody || null,
      data: resolvedData,
    }));
    await supabase.from("notifications").insert(notifications);

    // Fetch all push subscriptions for the target users
    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth_key")
      .in("user_id", userIds);

    if (!subs || subs.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = JSON.stringify({
      title: resolvedTitle,
      body: resolvedBody,
      data: { ...(resolvedData ?? {}), url: (resolvedData?.url as string | undefined) ?? "/" },
      icon: "/icon-192.png",
      badge: "/badge-72.png",
    });

    let sent = 0;
    let failed = 0;
    const staleEndpoints: string[] = [];

    for (const sub of subs) {
      try {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        } as unknown as PushSubscription;

        const subscriber = appServer.subscribe(pushSub);
        await subscriber.pushTextMessage(payload, { urgency: "normal" });
        sent++;
      } catch (err) {
        failed++;
        const status = (err as { status?: number }).status;
        if (status === 404 || status === 410) {
          staleEndpoints.push(sub.endpoint);
        }
      }
    }

    // Clean up stale subscriptions
    if (staleEndpoints.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", staleEndpoints);
    }

    return new Response(JSON.stringify({ sent, failed, total: subs.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
