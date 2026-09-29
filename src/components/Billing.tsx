import { useEffect, useState, type FormEvent } from 'react';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import {
  CheckoutElementsProvider,
  PaymentElement as CheckoutPaymentElement,
  useCheckoutElements,
} from '@stripe/react-stripe-js/checkout';
import { Check, CreditCard, Download, Loader2, Lock, Receipt, Tag } from 'lucide-react';
import type { Stripe } from '@stripe/stripe-js';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { getStripe, stripeAppearance } from '../lib/stripe';
import { formatLongDate as formatDate } from '../lib/utils';
import {
  SUBSCRIPTION_PLANS,
  saveCard,
  startCardUpdate,
  startCheckout,
  type BillingSummary,
  type SubscriptionTier,
} from '../lib/supabase';

type PaidTier = Exclude<SubscriptionTier, 'free'>;

const STRIPE_LOAD_ERROR = "Couldn't load secure checkout. Check your connection and try again.";

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

/**
 * Checkout inside the app, in the app's own theme. Stripe's Payment Element
 * (a custom-UI Checkout Session) holds the card fields, so card details never
 * touch our code; everything around it is ours. The tier changes when the
 * webhook confirms, which the page waits for after onComplete.
 */
export function CheckoutDialog({
  tier,
  onClose,
  onComplete,
}: {
  tier: PaidTier;
  onClose: () => void;
  onComplete: (tier: PaidTier) => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    let live = true;
    // Load Stripe.js alongside the session so a failed script load is shown
    // here instead of surfacing as an uncaught error inside the provider.
    Promise.all([
      startCheckout(tier),
      getStripe().catch(() => { throw new Error(STRIPE_LOAD_ERROR); }),
    ])
      .then(([secret, loaded]) => {
        if (!live) return;
        if (!loaded) throw new Error(STRIPE_LOAD_ERROR);
        setStripe(loaded);
        setClientSecret(secret);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Checkout is unavailable'));
    return () => { live = false; };
  }, [tier]);

  return (
    <Dialog open onOpenChange={(open) => !open && !paying && onClose()}>
      {/* The dialog itself does not scroll: the form scrolls inside it and the
          pay button stays pinned at the bottom, however short the screen. */}
      <DialogContent className="overflow-hidden sm:max-h-[90dvh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">
            {tier === 'lifetime' ? 'Buy Lifetime' : `Upgrade to ${SUBSCRIPTION_PLANS[tier].label}`}
          </DialogTitle>
          <DialogDescription>Pay securely without leaving Open Finds.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : !clientSecret || !stripe ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-secondary">
            <Loader2 size={16} className="animate-spin" /> Loading secure checkout…
          </div>
        ) : (
          <CheckoutElementsProvider
            stripe={stripe}
            options={{ clientSecret, elementsOptions: { appearance: stripeAppearance } }}
          >
            <CheckoutForm tier={tier} onPaying={setPaying} onPaid={() => onComplete(tier)} />
          </CheckoutElementsProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}

const PLAN_BLURB: Record<PaidTier, string> = {
  premium_monthly: 'Unlimited plans and AI, up to 5 stops, no ads',
  premium_yearly: 'Everything in Premium, two months free',
  lifetime: 'Everything in Premium, paid once',
};

function CheckoutForm({
  tier,
  onPaying,
  onPaid,
}: {
  tier: PaidTier;
  onPaying: (paying: boolean) => void;
  onPaid: () => void;
}) {
  const state = useCheckoutElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);

  if (state.type === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-secondary">
        <Loader2 size={16} className="animate-spin" /> Loading secure checkout…
      </div>
    );
  }
  if (state.type === 'error') {
    return (
      <p role="alert" className="rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
        {state.error.message}
      </p>
    );
  }

  const { checkout } = state;
  const total = checkout.total.total.amount;
  const interval = checkout.recurring?.interval;
  const discount = checkout.discountAmounts?.[0] ?? null;

  const setBusy = (busy: boolean) => {
    setPaying(busy);
    onPaying(busy);
  };

  const pay = async () => {
    setBusy(true);
    setError(null);
    const result = await checkout.confirm({ redirect: 'if_required' });
    if (result.type === 'error') {
      setError(result.error.message);
      setBusy(false);
      return;
    }
    onPaid();
  };

  const applyPromo = async () => {
    if (!promo.trim()) return;
    setPromoBusy(true);
    setPromoError(null);
    const result = await checkout.applyPromotionCode(promo.trim());
    if (result.type === 'error') setPromoError(result.error.message);
    else setPromo('');
    setPromoBusy(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-1 pb-1">
      <div className="shrink-0 rounded-card border border-gold/25 bg-black/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-white">{SUBSCRIPTION_PLANS[tier].label}</p>
            <p className="mt-0.5 text-xs text-ink-secondary">{PLAN_BLURB[tier]}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold text-gold">{total}</p>
            <p className="text-xs text-ink-secondary">{interval ? `per ${interval}` : 'one payment'}</p>
          </div>
        </div>
        {discount && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-gold/15 pt-3 text-sm">
            <span className="flex items-center gap-1.5 text-success">
              <Tag size={14} /> {discount.displayName}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-success">−{discount.amount}</span>
              <button
                type="button"
                onClick={() => { void checkout.removePromotionCode(); }}
                className="text-xs text-ink-secondary underline-offset-2 hover:text-gold hover:underline"
              >
                Remove
              </button>
            </span>
          </div>
        )}
      </div>

      {checkout.email && (
        <p className="text-sm text-ink-secondary">
          Receipt goes to <span className="text-white">{checkout.email}</span>
        </p>
      )}

      {/* Link's optional sign-up block adds email, phone and name fields; keep the form short. */}
      <CheckoutPaymentElement options={{ layout: 'tabs', wallets: { link: 'never' } }} />

      {!discount && (
        promoOpen ? (
          <div>
            <div className="flex gap-2">
              <input
                value={promo}
                onChange={(e) => setPromo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyPromo(); } }}
                placeholder="Promo code"
                aria-label="Promo code"
                className="min-w-0 flex-1 rounded-card border border-gold/25 bg-black/40 px-4 py-2.5 text-sm text-white outline-none placeholder:text-ink-secondary/60 focus:border-gold"
              />
              <Button type="button" size="sm" variant="outline" onClick={applyPromo} disabled={promoBusy || !promo.trim()}>
                {promoBusy ? <Loader2 className="animate-spin" /> : <Check />} Apply
              </Button>
            </div>
            {promoError && <p className="mt-1.5 text-xs text-red-300">{promoError}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPromoOpen(true)}
            className="flex w-fit items-center gap-1.5 text-sm text-gold underline-offset-2 hover:underline"
          >
            <Tag size={14} /> Add a promo code
          </button>
        )
      )}

      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-gold/15 pt-4">
        {error && (
          <p role="alert" className="rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
        <Button size="lg" full onClick={pay} disabled={paying || !checkout.canConfirm} className="shadow-gold-glow">
          {paying ? <Loader2 className="animate-spin" /> : <Lock />}
          {paying ? 'Processing…' : interval ? `Subscribe · ${total}/${interval}` : `Pay ${total}`}
        </Button>
        <p className="text-center text-xs text-ink-secondary">
          {interval ? 'Cancel anytime from Billing. ' : ''}Payments are processed securely by Stripe.
        </p>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep things as they are</Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The in-app card form: a SetupIntent confirmed in Stripe's Payment Element. */
function CardForm({ onSaved, onCancel }: { onSaved: (s: BillingSummary) => void; onCancel: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripe, setStripe] = useState<Stripe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      startCardUpdate(),
      getStripe().catch(() => { throw new Error(STRIPE_LOAD_ERROR); }),
    ])
      .then(([secret, loaded]) => {
        if (!live) return;
        if (!loaded) throw new Error(STRIPE_LOAD_ERROR);
        setStripe(loaded);
        setClientSecret(secret);
      })
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Card update is unavailable'));
    return () => { live = false; };
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (!clientSecret || !stripe) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> Loading card form…
      </div>
    );
  }
  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance: stripeAppearance }}>
      <CardFormInner onSaved={onSaved} onCancel={onCancel} />
    </Elements>
  );
}

function CardFormInner({ onSaved, onCancel }: { onSaved: (s: BillingSummary) => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSaving(true);
    setError(null);
    const { setupIntent, error: stripeError } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
      confirmParams: { return_url: window.location.href },
    });
    if (stripeError || !setupIntent) {
      setError(stripeError?.message ?? 'That card could not be saved');
      setSaving(false);
      return;
    }
    try {
      onSaved(await saveCard(setupIntent.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That card could not be saved');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {/* Same as checkout: no Link sign-up block (email, phone) under the card fields. */}
      <PaymentElement options={{ layout: 'tabs', wallets: { link: 'never' } }} />
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={!stripe || saving}>
          {saving && <Loader2 className="animate-spin" />} Save card
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </form>
  );
}

/** Plan, renewal, card and receipts, managed without leaving the app. */
export function BillingPanel({
  tier,
  summary,
  loading,
  busy,
  onCancel,
  onResume,
  onSwitch,
  onCardSaved,
}: {
  tier: SubscriptionTier;
  summary: BillingSummary | null;
  loading: boolean;
  busy: boolean;
  onCancel: () => void;
  onResume: () => void;
  onSwitch: (to: 'premium_monthly' | 'premium_yearly') => void;
  onCardSaved: (s: BillingSummary) => void;
}) {
  const [editingCard, setEditingCard] = useState(false);
  const sub = summary?.subscription ?? null;
  const card = summary?.card ?? null;
  const periodEnd = formatDate(sub?.currentPeriodEnd);
  const otherTier = sub?.tier === 'premium_yearly' ? 'premium_monthly' : 'premium_yearly';

  return (
    <section aria-labelledby="billing-heading" className="mb-8 rounded-card border border-gold/20 bg-[#0d0d0d] p-5 sm:p-6">
      <h2 id="billing-heading" className="mb-4 text-lg font-bold text-white">Billing</h2>

      {loading && !summary ? (
        <div className="flex items-center gap-2 text-sm text-ink-secondary">
          <Loader2 size={14} className="animate-spin" /> Loading billing…
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gold/80">Plan</p>
            {tier === 'lifetime' ? (
              <p className="mt-1 text-white">Lifetime <span className="text-ink-secondary">· paid once, never renews</span></p>
            ) : sub ? (
              <>
                <p className="mt-1 text-white">
                  {SUBSCRIPTION_PLANS[sub.tier ?? tier].label}
                  {sub.amount != null && (
                    <span className="text-ink-secondary"> · {formatMoney(sub.amount, sub.currency)}/{sub.interval}</span>
                  )}
                </p>
                <p className="mt-1 text-sm text-ink-secondary">
                  {sub.status === 'past_due'
                    ? 'Your last payment failed. Update your card to keep Premium.'
                    : sub.cancelAtPeriodEnd
                    ? `Ends on ${periodEnd}. You keep Premium until then.`
                    : `Renews on ${periodEnd}.`}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {sub.cancelAtPeriodEnd ? (
                    <Button size="sm" onClick={onResume} disabled={busy}>Keep my subscription</Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>Cancel subscription</Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onSwitch(otherTier)} disabled={busy}>
                    Switch to {otherTier === 'premium_yearly' ? 'yearly' : 'monthly'}
                  </Button>
                </div>
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-secondary">No active subscription.</p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gold/80">Payment method</p>
            {editingCard ? (
              <div className="mt-3">
                <CardForm
                  onCancel={() => setEditingCard(false)}
                  onSaved={(s) => { setEditingCard(false); onCardSaved(s); }}
                />
              </div>
            ) : (
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-2 text-white">
                  <CreditCard size={16} className="text-gold" />
                  {card
                    ? `${card.brand.charAt(0).toUpperCase()}${card.brand.slice(1)} •••• ${card.last4} · ${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`
                    : 'No card on file'}
                </span>
                {sub && tier !== 'lifetime' && (
                  <Button size="sm" variant="ghost" onClick={() => setEditingCard(true)} disabled={busy}>
                    {card ? 'Change card' : 'Add card'}
                  </Button>
                )}
              </div>
            )}
          </div>

          {summary && summary.invoices.length > 0 && (
            <div className="md:col-span-2">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold/80">Receipts</p>
              <ul className="divide-y divide-gold/10">
                {summary.invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
                    <Receipt size={14} className="text-gold/60" />
                    <span className="w-36 text-white">{formatDate(inv.date)}</span>
                    <span className="w-20 text-white">{formatMoney(inv.amount, inv.currency)}</span>
                    <span className="capitalize text-ink-secondary">{inv.status}</span>
                    {inv.pdf && (
                      <a
                        href={inv.pdf}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto flex items-center gap-1 text-gold hover:underline"
                      >
                        <Download size={14} /> Receipt
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
