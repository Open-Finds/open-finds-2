#!/usr/bin/env node
/**
 * Creates everything Open Finds needs in a Stripe account. Safe to re-run:
 * anything that already exists is left alone. Run once against the test
 * account and once against the live account.
 *
 *   STRIPE_SECRET_KEY=sk_... node scripts/stripe-setup.mjs [webhook-url]
 *
 * With a webhook URL it also registers the endpoint. Stripe shows the signing
 * secret only when the endpoint is created, so on that run the secret is the
 * one thing written to stdout (everything else goes to stderr) and can be
 * piped straight into `supabase secrets set STRIPE_WEBHOOK_SECRET=...`.
 */

import { readFileSync } from 'node:fs';

// Falls back to the git-ignored .env so the key never has to be typed.
function keyFromDotEnv() {
  try {
    return readFileSync('.env', 'utf8').match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1]?.trim();
  } catch {
    return undefined;
  }
}

const key = process.env.STRIPE_SECRET_KEY || keyFromDotEnv();
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set');
  process.exit(1);
}
const webhookUrl = process.argv[2];
const log = (...a) => console.error(...a);

async function stripe(method, path, params) {
  const body = params ? new URLSearchParams(flatten(params)).toString() : undefined;
  const url = `https://api.stripe.com/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : body,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.message ?? res.status}`);
  return json;
}

// Stripe's form encoding: a[b][0][c]=x
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const name = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object') flatten(v, name, out);
    else out.push([name, String(v)]);
  }
  return out;
}

const PRICES = [
  { lookup_key: 'open_finds_premium_monthly', nickname: 'Premium monthly', unit_amount: 299, recurring: { interval: 'month' } },
  { lookup_key: 'open_finds_premium_yearly', nickname: 'Premium yearly', unit_amount: 2499, recurring: { interval: 'year' } },
  { lookup_key: 'open_finds_premium_lifetime', nickname: 'Premium lifetime', unit_amount: 3999 },
];

const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'charge.refunded',
];

const account = await stripe('GET', 'account');
log(`Stripe account ${account.id} (${key.startsWith('sk_live') ? 'LIVE' : 'test'} mode)`);

// Product
const products = await stripe('GET', 'products/search', { query: "metadata['app']:'open_finds_premium'" });
let product = products.data[0];
if (!product) {
  product = await stripe('POST', 'products', {
    name: 'Open Finds Premium',
    description: 'Unlimited plans, up to 5 stops, unlimited AI, no ads',
    metadata: { app: 'open_finds_premium' },
  });
  log(`+ product ${product.id}`);
} else {
  log(`= product ${product.id}`);
}

// Prices
const existing = await stripe('GET', 'prices', {
  lookup_keys: PRICES.map((p) => p.lookup_key),
  limit: 10,
});
for (const p of PRICES) {
  const found = existing.data.find((e) => e.lookup_key === p.lookup_key);
  if (found) {
    if (found.unit_amount !== p.unit_amount) {
      log(`! ${p.lookup_key} is ${found.unit_amount} cents in Stripe, expected ${p.unit_amount}. Left as is.`);
    } else {
      log(`= price ${p.lookup_key} ${found.id}`);
    }
    continue;
  }
  const created = await stripe('POST', 'prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: p.unit_amount,
    nickname: p.nickname,
    lookup_key: p.lookup_key,
    recurring: p.recurring,
  });
  log(`+ price ${p.lookup_key} ${created.id}`);
}

// Webhook
if (webhookUrl) {
  const endpoints = await stripe('GET', 'webhook_endpoints', { limit: 100 });
  const found = endpoints.data.find((e) => e.url === webhookUrl);
  if (found) {
    await stripe('POST', `webhook_endpoints/${found.id}`, { enabled_events: WEBHOOK_EVENTS });
    log(`= webhook ${found.id} (events refreshed; its secret is unchanged and not shown)`);
  } else {
    const created = await stripe('POST', 'webhook_endpoints', {
      url: webhookUrl,
      enabled_events: WEBHOOK_EVENTS,
      description: 'Open Finds Premium',
    });
    log(`+ webhook ${created.id}`);
    process.stdout.write(created.secret);
  }
}
