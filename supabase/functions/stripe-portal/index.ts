import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { stripeClient } from "../_shared/stripe.ts";
import { appOrigin } from "../_shared/origin.ts";

/**
 * Opens Stripe's billing portal, where a subscriber cancels, switches between
 * monthly and yearly, updates their card, or downloads invoices. Changes made
 * there reach the app through stripe-webhook.
 */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const origin = appOrigin(req);
    if (!origin) return json(req, { error: "Unknown app origin" }, 400);

    const { data: profile, error } = await serviceClient()
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!profile?.stripe_customer_id) {
      return json(req, { error: "No billing account yet" }, 404);
    }

    const stripe = stripeClient();
    // Created by scripts/stripe-setup.mjs. Without it Stripe falls back to the
    // account default, which only exists once saved in the dashboard.
    const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 20 });
    const configuration = configs.data.find((c) => c.metadata?.app === "open_finds_premium")?.id;

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      configuration,
      return_url: `${origin}/#/subscription`,
    });
    return json(req, { url: session.url });
  } catch (err) {
    console.error("[stripe-portal]", err);
    return json(req, { error: "Could not open billing" }, 500);
  }
});
