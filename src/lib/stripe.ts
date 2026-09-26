import { loadStripe, type Appearance, type Stripe } from '@stripe/stripe-js';

/**
 * Stripe.js, loaded once and only when billing UI is opened. The publishable
 * key is public by design (it can only create payment forms, not read or move
 * money); the secret key stays in the edge functions.
 */
const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim();

let stripePromise: Promise<Stripe | null> | null = null;

export const stripeConfigured = Boolean(publishableKey);

export function getStripe(): Promise<Stripe | null> {
  if (!publishableKey) return Promise.resolve(null);
  stripePromise ??= loadStripe(publishableKey);
  return stripePromise;
}

/** Matches the app: black surfaces, gold accents. */
export const stripeAppearance: Appearance = {
  theme: 'night',
  variables: {
    colorPrimary: '#D4AF35',
    colorBackground: '#1A1A1A',
    colorText: '#FFFFFF',
    colorDanger: '#EF4444',
    borderRadius: '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
};
