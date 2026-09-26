import { useEffect, useState, type FormEvent } from 'react';
import {
  Elements,
  EmbeddedCheckout,
  EmbeddedCheckoutProvider,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import { CreditCard, Download, Loader2, Receipt } from 'lucide-react';
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

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);
}

/**
 * Stripe's checkout form, mounted inside the app. Payment happens in Stripe's
 * iframe, so card details never touch our code; the tier changes when the
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    startCheckout(tier)
      .then((secret) => live && setClientSecret(secret))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Checkout is unavailable'));
    return () => { live = false; };
  }, [tier]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-white">
            {tier === 'lifetime' ? 'Buy Lifetime' : `Upgrade to ${SUBSCRIPTION_PLANS[tier].label}`}
          </DialogTitle>
          <DialogDescription>Secure payment by Stripe. You stay in Open Finds the whole time.</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        ) : !clientSecret ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-secondary">
            <Loader2 size={16} className="animate-spin" /> Loading secure checkout…
          </div>
        ) : (
          // Stripe's form is light; the rounded panel keeps it from floating on black.
          <div className="overflow-hidden rounded-card bg-white">
            <EmbeddedCheckoutProvider
              stripe={getStripe()}
              options={{ clientSecret, onComplete: () => onComplete(tier) }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}
      </DialogContent>
    </Dialog>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    startCardUpdate()
      .then((secret) => live && setClientSecret(secret))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Card update is unavailable'));
    return () => { live = false; };
  }, []);

  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>;
  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> Loading card form…
      </div>
    );
  }
  return (
    <Elements stripe={getStripe()} options={{ clientSecret, appearance: stripeAppearance }}>
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
      <PaymentElement options={{ layout: 'tabs' }} />
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
                {sub && (
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
