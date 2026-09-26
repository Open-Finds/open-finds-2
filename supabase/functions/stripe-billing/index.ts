import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { json, preflight } from "../_shared/cors.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { consumeRateLimit } from "../_shared/ratelimit.ts";
import { LOOKUP_KEYS, Stripe, stripeClient, tierForLookupKey } from "../_shared/stripe.ts";

/**
 * Billing management inside the app, in place of Stripe's hosted portal.
 *
 * Every action is scoped to the caller's own Stripe customer and the
 * subscription recorded on their profile; ids from the request are never
 * trusted on their own. Actions change Stripe only. The profile follows
 * through stripe-webhook, exactly as it does for checkout.
 *
 *   summary      plan, renewal, card on file, recent invoices
 *   cancel       stop renewing at the end of the period
 *   resume       undo a pending cancellation
 *   switch       move between monthly and yearly (prorated)
 *   card-setup   SetupIntent for the in-app card form
 *   card-save    make a card confirmed by that form the default
 */

type Action = "summary" | "cancel" | "resume" | "switch" | "card-setup" | "card-save";
const ACTIONS = new Set<Action>(["summary", "cancel", "resume", "switch", "card-setup", "card-save"]);

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json(req, { error: "POST only" }, 405);

  try {
    const auth = await requireUser(req);
    if (!auth.ok) return json(req, { error: auth.error }, auth.status);

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = body?.action as Action;
    if (!ACTIONS.has(action)) return json(req, { error: "Unknown action" }, 400);

    if (action !== "summary") {
      const limit = await consumeRateLimit("stripe-billing", auth.user.id, 20, 60 * 10);
      if (!limit.allowed) {
        return json(req, { error: "Too many changes. Try again shortly." }, 429, {
          "Retry-After": String(limit.retryAfter),
        });
      }
    }

    const { data: profile, error } = await serviceClient()
      .from("profiles")
      .select("subscription_tier, stripe_customer_id, stripe_subscription_id")
      .eq("id", auth.user.id)
      .maybeSingle();
    if (error) throw error;

    const customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      return action === "summary"
        ? json(req, { subscription: null, card: null, invoices: [] })
        : json(req, { error: "No billing account yet" }, 404);
    }

    const stripe = stripeClient();
    const sub = await ownSubscription(stripe, customerId, profile?.stripe_subscription_id);

    switch (action) {
      case "summary":
        return json(req, await summary(stripe, customerId, sub));

      case "cancel":
      case "resume": {
        if (!sub) return json(req, { error: "No active subscription" }, 404);
        await stripe.subscriptions.update(sub.id, { cancel_at_period_end: action === "cancel" });
        return json(req, await summary(stripe, customerId, await stripe.subscriptions.retrieve(sub.id)));
      }

      case "switch": {
        if (!sub) return json(req, { error: "No active subscription" }, 404);
        const tier = body?.tier;
        if (tier !== "premium_monthly" && tier !== "premium_yearly") {
          return json(req, { error: "Choose premium_monthly or premium_yearly" }, 400);
        }
        const item = sub.items.data[0];
        if (tierForLookupKey(item?.price?.lookup_key) === tier) {
          return json(req, { error: "You are already on that plan" }, 409);
        }
        const prices = await stripe.prices.list({ lookup_keys: [LOOKUP_KEYS[tier]], active: true, limit: 1 });
        if (!prices.data[0]) return json(req, { error: "This plan is not available yet" }, 503);
        await stripe.subscriptions.update(sub.id, {
          items: [{ id: item.id, price: prices.data[0].id }],
          proration_behavior: "create_prorations",
          // Switching plans is a decision to keep going.
          cancel_at_period_end: false,
        });
        return json(req, await summary(stripe, customerId, await stripe.subscriptions.retrieve(sub.id)));
      }

      case "card-setup": {
        const intent = await stripe.setupIntents.create({
          customer: customerId,
          payment_method_types: ["card"],
          usage: "off_session",
          metadata: { user_id: auth.user.id },
        });
        return json(req, { clientSecret: intent.client_secret });
      }

      case "card-save": {
        const setupIntentId = body?.setupIntentId;
        if (typeof setupIntentId !== "string" || !setupIntentId.startsWith("seti_")) {
          return json(req, { error: "setupIntentId is required" }, 400);
        }
        // Trust the SetupIntent, not a payment method id from the browser: it
        // must be ours, for this customer, and actually confirmed.
        const intent = await stripe.setupIntents.retrieve(setupIntentId);
        if (intent.customer !== customerId || intent.status !== "succeeded" || !intent.payment_method) {
          return json(req, { error: "That card could not be confirmed" }, 400);
        }
        const pm = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method.id;
        await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
        if (sub) await stripe.subscriptions.update(sub.id, { default_payment_method: pm });
        return json(req, await summary(stripe, customerId, sub && await stripe.subscriptions.retrieve(sub.id)));
      }
    }
  } catch (err) {
    console.error("[stripe-billing]", err);
    const message = err instanceof Stripe.errors.StripeError ? err.message : "Billing is unavailable";
    return json(req, { error: message }, 500);
  }
});

/** The caller's live subscription, only if it belongs to their customer. */
async function ownSubscription(
  stripe: Stripe,
  customerId: string,
  recordedId: string | null | undefined,
): Promise<Stripe.Subscription | null> {
  if (!recordedId) return null;
  try {
    const sub = await stripe.subscriptions.retrieve(recordedId);
    if (sub.customer !== customerId) return null;
    return ["active", "trialing", "past_due"].includes(sub.status) ? sub : null;
  } catch {
    return null;
  }
}

async function summary(stripe: Stripe, customerId: string, sub: Stripe.Subscription | null) {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["invoice_settings.default_payment_method"],
  });
  let pm = !customer.deleted
    ? customer.invoice_settings?.default_payment_method as Stripe.PaymentMethod | string | null
    : null;
  if (sub?.default_payment_method) pm = sub.default_payment_method as string | Stripe.PaymentMethod;
  if (typeof pm === "string") pm = await stripe.paymentMethods.retrieve(pm);
  if (!pm) {
    // Checkout attaches the card without making it the customer default.
    pm = (await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 })).data[0] ?? null;
  }

  const invoices = await stripe.invoices.list({ customer: customerId, limit: 6 });
  const charges = await stripe.charges.list({ customer: customerId, limit: 6 });
  const item = sub?.items.data[0];

  return {
    subscription: sub && {
      tier: tierForLookupKey(item?.price?.lookup_key),
      status: sub.status,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      currentPeriodEnd: new Date(sub.current_period_end * 1000).toISOString(),
      amount: item?.price?.unit_amount ?? null,
      currency: item?.price?.currency ?? "usd",
      interval: item?.price?.recurring?.interval ?? null,
    },
    card: pm?.card
      ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year }
      : null,
    // Subscriptions bill through invoices; Lifetime is a one-off charge.
    invoices: [
      ...invoices.data
        .filter((i) => i.status !== "draft")
        .map((i) => ({
          id: i.id,
          date: new Date(i.created * 1000).toISOString(),
          amount: i.amount_paid || i.amount_due,
          currency: i.currency,
          status: i.status,
          description: i.lines.data[0]?.description ?? "Open Finds Premium",
          pdf: i.invoice_pdf ?? null,
        })),
      ...charges.data
        .filter((c) => !c.invoice && c.paid)
        .map((c) => ({
          id: c.id,
          date: new Date(c.created * 1000).toISOString(),
          amount: c.amount,
          currency: c.currency,
          status: c.refunded ? "refunded" : "paid",
          description: c.description ?? "Open Finds Lifetime",
          pdf: c.receipt_url ?? null,
        })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
  };
}
