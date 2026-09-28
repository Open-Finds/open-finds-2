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
  // A failed load (flaky network, blocked script) must not be cached, or every
  // later attempt fails too without trying again.
  stripePromise ??= loadStripe(publishableKey).catch((err) => {
    stripePromise = null;
    throw err;
  });
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
    colorTextSecondary: '#A3A3A3',
    colorTextPlaceholder: '#6B6B6B',
    borderRadius: '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  rules: {
    '.Input': { backgroundColor: '#0D0D0D', border: '1px solid rgba(212, 175, 53, 0.25)', boxShadow: 'none' },
    '.Input:focus': { borderColor: '#D4AF35', boxShadow: '0 0 0 1px #D4AF35' },
    '.Tab': { backgroundColor: '#0D0D0D', border: '1px solid rgba(212, 175, 53, 0.25)' },
    '.Tab--selected': { borderColor: '#D4AF35', backgroundColor: 'rgba(212, 175, 53, 0.1)' },
    '.Label': { color: '#A3A3A3' },
  },
};
