import Stripe from "npm:stripe@17.7.0";

/**
 * Stripe client for edge functions. Fetch-based because Deno has no Node http.
 * STRIPE_SECRET_KEY is a function secret; it never reaches the browser.
 */
export function stripeClient(): Stripe {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key, {
    apiVersion: "2025-02-24.acacia",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export const cryptoProvider = Stripe.createSubtleCryptoProvider();

export type PaidTier = "premium_monthly" | "premium_yearly" | "lifetime";

/**
 * Prices are found by lookup key rather than by id, so test and live accounts
 * need no id wiring: scripts/stripe-setup.mjs creates the same keys in each.
 */
export const LOOKUP_KEYS: Record<PaidTier, string> = {
  premium_monthly: "open_finds_premium_monthly",
  premium_yearly: "open_finds_premium_yearly",
  lifetime: "open_finds_premium_lifetime",
};

export function tierForLookupKey(key: string | null | undefined): PaidTier | null {
  const hit = Object.entries(LOOKUP_KEYS).find(([, k]) => k === key);
  return hit ? (hit[0] as PaidTier) : null;
}

export { Stripe };
