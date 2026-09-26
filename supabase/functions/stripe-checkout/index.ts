import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { LOOKUP_KEYS, type PaidTier, stripeClient } from "../_shared/stripe.ts";
import { appOrigin } from "../_shared/origin.ts";

/**
 * Starts a Stripe Checkout for Premium. With { embedded: true } it returns
 * the client secret of an embedded session, which the app mounts in place;
 * otherwise the URL of Stripe's hosted page.
 *
 * Nothing here grants Premium. The tier changes only when stripe-webhook
 * receives Stripe's signed confirmation, so abandoning checkout or faking
 * completion in the browser gets the caller nothing.
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

    const body = await req.json().catch(() => null) as { tier?: unknown; embedded?: unknown } | null;
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
    // A live subscription is changed or cancelled from the billing section.
    // Buying a second one here would charge twice. Lifetime is the exception:
    // the webhook cancels the subscription once Lifetime is paid.
    if (profile?.stripe_subscription_id && paidTier !== "lifetime") {
      return json(req, { error: "You already subscribe. Switch plans in the Billing section." }, 409);
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
    const common = {
      customer: customerId,
      client_reference_id: auth.user.id,
      mode: paidTier === "lifetime" ? "payment" as const : "subscription" as const,
      line_items: [{ price: price.id, quantity: 1 }],
      allow_promotion_codes: true,
      metadata,
      ...(paidTier === "lifetime"
        ? { payment_intent_data: { metadata } }
        : { subscription_data: { metadata } }),
    };

    if (body?.embedded === true) {
      // Embedded Checkout: the payment form renders inside the app, so there
      // is no success or cancel page. Card payments finish in place and the
      // app's onComplete takes over; return_url is used only by the few
      // payment methods that must leave the page to authenticate.
      const session = await stripe.checkout.sessions.create({
        ...common,
        ui_mode: "embedded",
        redirect_on_completion: "if_required",
        return_url: `${returnTo}?checkout=success&tier=${paidTier}`,
      });
      return json(req, { clientSecret: session.client_secret });
    }

    // Hosted page, kept for app builds that predate the embedded form.
    const session = await stripe.checkout.sessions.create({
      ...common,
      success_url: `${returnTo}?checkout=success&tier=${paidTier}`,
      cancel_url: `${returnTo}?checkout=cancelled`,
    });
    return json(req, { url: session.url });
  } catch (err) {
    console.error("[stripe-checkout]", err);
    return json(req, { error: "Could not start checkout" }, 500);
  }
});
