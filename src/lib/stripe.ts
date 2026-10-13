import { loadStripe, type Appearance, type Stripe } from '@stripe/stripe-js';

/**
 * Stripe.js, loaded once and only when billing UI is opened. The publishable
 * key is public by design (it can only create payment forms, not read or move
 * money); the secret key stays in the edge functions.
 */
const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined)?.trim();

let stripePromise: Promise<Stripe | null> | null = null;

export const stripeConfigured = Boolean(publishableKey);

export function getStripe({ fresh = false } = {}): Promise<Stripe | null> {
  if (!publishableKey) return Promise.resolve(null);
  // "Try again" asks for a new instance: one whose hidden Stripe frames timed
  // out stays stuck. The script itself is still only downloaded once.
  if (fresh) stripePromise = null;
  // A failed load (flaky network, blocked script) must not be cached, or every
  // later attempt fails too without trying again.
  // developerTools: Stripe shows a floating "stripe" test-mode assistant badge
  // on every page once Stripe.js has loaded. It never appears with live keys,
  // but testers took it for part of the app.
  stripePromise ??= loadStripe(publishableKey, {
    developerTools: { assistant: { enabled: false } },
  }).catch((err) => {
    stripePromise = null;
    throw err;
  });
  return stripePromise;
}

/** A design token ("--primary") as the hex colour Stripe's iframes need. */
function token(name: string): string {
  const [h, s, l] = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map((v) => parseFloat(v));
  if (![h, s, l].every(Number.isFinite)) return '#000000';
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/**
 * Stripe's payment fields, in the app's current theme. Stripe draws them in
 * its own iframe, so it's handed the tokens' values rather than class names;
 * read when the form opens, so it follows light and dark.
 */
export function stripeAppearance(): Appearance {
  const dark = document.documentElement.classList.contains('dark');
  return {
    theme: dark ? 'night' : 'stripe',
    variables: {
      colorPrimary: token('--primary-text'),
      colorBackground: token('--card'),
      colorText: token('--foreground'),
      colorDanger: token('--destructive-text'),
      colorTextSecondary: token('--muted-foreground'),
      colorTextPlaceholder: token('--muted-foreground'),
      borderRadius: '12px',
      fontFamily: '"Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif',
    },
    rules: {
      '.Input': { backgroundColor: token(dark ? '--background' : '--card'), border: `1px solid ${token('--input')}`, boxShadow: 'none' },
      '.Input:focus': { borderColor: token('--ring'), boxShadow: `0 0 0 1px ${token('--ring')}` },
      '.Tab': { backgroundColor: token(dark ? '--background' : '--card'), border: `1px solid ${token('--border')}` },
      '.Tab--selected': { borderColor: token('--primary'), backgroundColor: token('--primary-soft') },
      '.Label': { color: token('--muted-foreground') },
    },
  };
}
