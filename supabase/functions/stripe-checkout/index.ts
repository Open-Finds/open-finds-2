import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { LOOKUP_KEYS, type PaidTier, stripeClient } from "../_shared/stripe.ts";
import { appOrigin } from "../_shared/origin.ts";

/**
 * Starts a Stripe Checkout for Premium and returns its URL.
 *
 * Nothing here grants Premium. The tier changes only when stripe-webhook
 * receives Stripe's signed confirmation, so abandoning or faking the success
 * redirect gets the caller nothing.
 */
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const limit = await consumeRateLimit("stripe-checkout", auth.user.id, 10, 60 * 10);
    if (!limit.allowed) {
      return json(req, { error: "Too many attempts. Try again shortly." }, 429, {
        "Retry-After": String(limit.retryAfter),
      });
    }

    const body = await req.json().catch(() => null) as { tier?: unknown } | null;
    const tier = body?.tier;
    if (typeof tier !== "string" || !(tier in LOOKUP_KEYS)) {
      return json(req, { error: "Choose premium_monthly, premium_yearly or lifetime" }, 400);
    }
    const paidTier = tier as PaidTier;

    const origin = appOrigin(req);
    if (!origin) return json(req, { error: "Unknown app origin" }, 400);

    const db = serviceClient();
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.subscription_tier === "lifetime") {
      return json(req, { error: "You already have Lifetime" }, 409);
    }
    // A live subscription is changed or cancelled in the billing portal.
    // Buying a second one here would charge twice. Lifetime is the exception:
    // the webhook cancels the subscription once Lifetime is paid.
    if (profile?.stripe_subscription_id && paidTier !== "lifetime") {
      return json(req, { error: "You already subscribe. Use Manage billing to switch plans." }, 409);
    }

    const stripe = stripeClient();

    let customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: auth.user.email ?? undefined,
          metadata: { user_id: auth.user.id },
        },
        { idempotencyKey: `customer-${auth.user.id}` },
      );
      customerId = customer.id;
      const { error } = await db
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", auth.user.id);
      if (error) throw error;
    }

    const prices = await stripe.prices.list({
      lookup_keys: [LOOKUP_KEYS[paidTier]],
      active: true,
      limit: 1,
    });
    const price = prices.data[0];
    if (!price) {
      console.error("[stripe-checkout] no price for", LOOKUP_KEYS[paidTier]);
      return json(req, { error: "This plan is not available yet" }, 503);
    }

    const metadata = { user_id: auth.user.id, tier: paidTier };
    const returnTo = `${origin}/#/subscription`;
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: auth.user.id,
      mode: paidTier === "lifetime" ? "payment" : "subscription",
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      metadata,
      ...(paidTier === "lifetime"
        ? { payment_intent_data: { metadata } }
        : { subscription_data: { metadata } }),
      success_url: `${returnTo}?checkout=success&tier=${paidTier}`,
      cancel_url: `${returnTo}?checkout=cancelled`,
    });

    return json(req, { url: session.url });
  } catch (err) {
    console.error("[stripe-checkout]", err);
    return json(req, { error: "Could not start checkout" }, 500);
  }
});
