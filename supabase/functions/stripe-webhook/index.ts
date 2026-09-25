import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { serviceClient } from "../_shared/auth.ts";
import { cryptoProvider, Stripe, stripeClient, tierForLookupKey } from "../_shared/stripe.ts";

/**
 * The only writer of a profile's Premium state.
 *
 * Called by Stripe, not the app, so there is no user session and no CORS;
 * verify_jwt is off for this function and the Stripe signature is the gate.
 *
 * Subscription events are not applied from the payload. The subscription is
 * re-read from Stripe and its current state written, which makes handling
 * idempotent and immune to Stripe delivering events out of order.
 */

// Stripe keeps these subscriptions billing; past_due is still retrying the
// card, so access stays on until Stripe gives up and cancels.
const LIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

type Db = ReturnType<typeof serviceClient>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const signature = req.headers.get("Stripe-Signature");
  if (!secret || !signature) return new Response("Missing signature", { status: 400 });

  const stripe = stripeClient();
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, secret, undefined, cryptoProvider);
  } catch (err) {
    console.warn("[stripe-webhook] bad signature", String(err));
    return new Response("Bad signature", { status: 400 });
  }

  const db = serviceClient();
  const { data: seen } = await db.from("stripe_events").select("id").eq("id", event.id).maybeSingle();
  if (seen) return new Response("Already handled", { status: 200 });

  try {
    await handle(stripe, db, event);
  } catch (err) {
    // A non-2xx makes Stripe retry with backoff for up to three days.
    console.error("[stripe-webhook]", event.type, event.id, err);
    return new Response("Handler failed", { status: 500 });
  }

  await db.from("stripe_events").insert({ id: event.id, type: event.type });
  return new Response("ok", { status: 200 });
});

async function handle(stripe: Stripe, db: Db, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "subscription" && session.subscription) {
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        await syncSubscription(stripe, db, id);
      } else if (session.mode === "payment" && session.metadata?.tier === "lifetime") {
        if (session.payment_status !== "paid") return; // async methods settle later
        await grantLifetime(stripe, db, session);
      }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(stripe, db, (event.data.object as Stripe.Subscription).id);
      return;
    case "charge.refunded":
      await revokeRefundedLifetime(stripe, db, event.data.object as Stripe.Charge);
      return;
    default:
      return;
  }
}

async function findUserId(
  db: Db,
  metadataUserId: string | undefined,
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null,
): Promise<string | null> {
  const customerId = typeof customer === "string" ? customer : customer?.id;
  if (customerId) {
    const { data } = await db.from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
    if (data?.id) return data.id as string;
  }
  // Only trusted when the customer is not already linked to someone else:
  // metadata is set by our own checkout, but the customer link is the anchor.
  return metadataUserId ?? null;
}

async function syncSubscription(stripe: Stripe, db: Db, subscriptionId: string) {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await findUserId(db, sub.metadata?.user_id, sub.customer);
  if (!userId) {
    console.warn("[stripe-webhook] no profile for subscription", sub.id);
    return;
  }

  const { data: profile, error } = await db
    .from("profiles")
    .select("subscription_tier, stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return;

  // Lifetime outranks any subscription; nothing here may take it away.
  if (profile.subscription_tier === "lifetime") return;

  const lookupKey = sub.items.data[0]?.price?.lookup_key;
  const tier = tierForLookupKey(lookupKey);
  const live = LIVE_STATUSES.has(sub.status) && sub.status !== "paused" && tier && tier !== "lifetime";

  if (live) {
    const { error: e } = await db.from("profiles").update({
      subscription_tier: tier,
      subscription_status: sub.cancel_at_period_end ? "canceling" : sub.status,
      subscription_renews_at: new Date(sub.current_period_end * 1000).toISOString(),
      stripe_subscription_id: sub.id,
    }).eq("id", userId);
    if (e) throw e;
    return;
  }

  // An ended subscription only downgrades the account if it is the one on
  // record, so a stale event for an old subscription cannot undo a newer one.
  if (profile.stripe_subscription_id && profile.stripe_subscription_id !== sub.id) return;

  const { error: e } = await db.from("profiles").update({
    subscription_tier: "free",
    subscription_status: "active",
    subscription_renews_at: null,
    stripe_subscription_id: null,
  }).eq("id", userId);
  if (e) throw e;
}

async function grantLifetime(stripe: Stripe, db: Db, session: Stripe.Checkout.Session) {
  const userId = await findUserId(db, session.metadata?.user_id, session.customer);
  if (!userId) {
    console.warn("[stripe-webhook] no profile for lifetime session", session.id);
    return;
  }

  const { data: profile } = await db
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("id", userId)
    .maybeSingle();

  const { error } = await db.from("profiles").update({
    subscription_tier: "lifetime",
    subscription_status: "active",
    subscription_renews_at: null,
    stripe_subscription_id: null,
  }).eq("id", userId);
  if (error) throw error;

  // Someone upgrading from monthly or yearly should not keep being billed.
  const oldSub = profile?.stripe_subscription_id as string | null | undefined;
  if (oldSub) {
    try {
      await stripe.subscriptions.cancel(oldSub, { prorate: true });
    } catch (err) {
      console.error("[stripe-webhook] could not cancel old subscription", oldSub, err);
    }
  }
}

async function revokeRefundedLifetime(stripe: Stripe, db: Db, charge: Stripe.Charge) {
  if (!charge.refunded || !charge.payment_intent) return; // partial refunds keep access
  const piId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent.id;
  const pi = await stripe.paymentIntents.retrieve(piId);
  if (pi.metadata?.tier !== "lifetime") return;

  const userId = await findUserId(db, pi.metadata?.user_id, charge.customer);
  if (!userId) return;

  const { error } = await db.from("profiles").update({
    subscription_tier: "free",
    subscription_status: "active",
    subscription_renews_at: null,
  }).eq("id", userId).eq("subscription_tier", "lifetime");
  if (error) throw error;
}
