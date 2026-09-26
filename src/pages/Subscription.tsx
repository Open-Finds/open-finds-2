import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Check, Crown, Zap, Infinity as InfinityIcon, Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBSCRIPTION_PLANS,
  fetchBilling,
  fetchProfile,
  setCancelAtPeriodEnd,
  switchSubscriptionPlan,
  type BillingSummary,
  type SubscriptionTier,
} from '../lib/supabase';
import { stripeConfigured } from '../lib/stripe';
import { BillingPanel, CheckoutDialog, ConfirmDialog } from '../components/Billing';
import { formatLongDate as formatDate } from '../lib/utils';

const PLAN_ORDER: SubscriptionTier[] = ['free', 'premium_monthly', 'premium_yearly', 'lifetime'];

const PLAN_META: Record<SubscriptionTier, { icon: React.ReactNode; tagline: string; period: string }> = {
  free: { icon: <Zap size={20} />, tagline: 'Get started for free', period: '' },
  premium_monthly: { icon: <Crown size={20} />, tagline: 'Unlimited plans and AI', period: '/mo' },
  premium_yearly: { icon: <Crown size={20} />, tagline: 'Two months free', period: '/yr' },
  lifetime: { icon: <InfinityIcon size={20} />, tagline: 'Pay once', period: '' },
};

const FREE_FEATURES = [
  '1 active plan',
  '2 stops per plan',
  '3 AI extractions a day',
  '3 Something New suggestions a day',
  'Share plan and RSVP',
  'Google Maps and countdown',
  'Calendar export',
];

const PREMIUM_FEATURES = [
  'Unlimited active plans',
  'Up to 5 stops per plan',
  'Unlimited AI extraction',
  'Unlimited Something New',
  'No ads',
];

type PaidTier = Exclude<SubscriptionTier, 'free'>;

const PAID_TIERS: PaidTier[] = ['premium_monthly', 'premium_yearly', 'lifetime'];

function checkoutReturn(): { result: 'success' | 'cancelled' | null; tier: PaidTier | null } {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const result = params.get('checkout');
  const tier = params.get('tier') as PaidTier | null;
  return {
    result: result === 'success' || result === 'cancelled' ? result : null,
    tier: tier && PAID_TIERS.includes(tier) ? tier : null,
  };
}

type Confirm = { kind: 'cancel' } | { kind: 'switch'; to: 'premium_monthly' | 'premium_yearly' };

const price = (tier: PaidTier) => `$${(SUBSCRIPTION_PLANS[tier].priceCents / 100).toFixed(2)}`;

export function SubscriptionPage({ onBack }: { onBack: () => void }) {
  const { session, subscriptionTier, subscriptionStatus, subscriptionRenewsAt, refreshProfile } = useAuth();
  const [initialReturn] = useState(checkoutReturn);
  const [checkoutTier, setCheckoutTier] = useState<PaidTier | null>(null);
  // Set once a payment completes; cleared when the webhook has updated the tier.
  const [awaitingTier, setAwaitingTier] = useState<PaidTier | null>(
    initialReturn.result === 'success' ? initialReturn.tier ?? 'premium_monthly' : null,
  );
  const [upgradedTo, setUpgradedTo] = useState<PaidTier | null>(null);
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingVersion, setBillingVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef(refreshProfile);
  refresh.current = refreshProfile;
  const userId = session?.user.id;

  const isSubscriber = subscriptionTier === 'premium_monthly' || subscriptionTier === 'premium_yearly';
  const renewsOn = formatDate(subscriptionRenewsAt);
  const confirming = awaitingTier !== null;

  // A few payment methods have to leave the embedded form to authenticate and
  // come back with ?checkout=success; tidy the URL either way.
  useEffect(() => {
    if (initialReturn.result) {
      window.history.replaceState(null, '', window.location.pathname + '#/subscription');
    }
  }, [initialReturn.result]);

  // The webhook usually lands within a second or two of payment, sometimes
  // before this runs, so wait for the tier that was bought rather than for
  // any change: the profile may already show it.
  useEffect(() => {
    if (!awaitingTier || !userId) return;
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const profile = await fetchProfile(userId).catch(() => null);
      if (profile?.subscription_tier === awaitingTier) {
        window.clearInterval(timer);
        await refresh.current();
        setUpgradedTo(awaitingTier);
        setAwaitingTier(null);
        // Buying Lifetime cancels the old subscription in the same webhook
        // run; give that a moment before re-reading receipts and plan.
        window.setTimeout(() => setBillingVersion((v) => v + 1), 3000);
      } else if (tries >= 20) {
        window.clearInterval(timer);
        setAwaitingTier(null);
        setError('Payment received, but your plan has not updated yet. Refresh in a minute.');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [awaitingTier, userId]);

  useEffect(() => {
    if (!userId || subscriptionTier === 'free') {
      setBilling(null);
      return;
    }
    let live = true;
    setBillingLoading(true);
    fetchBilling()
      .then((b) => live && setBilling(b))
      .catch((err) => live && setError(err instanceof Error ? err.message : 'Billing is unavailable'))
      .finally(() => live && setBillingLoading(false));
    return () => { live = false; };
  }, [userId, subscriptionTier, billingVersion]);

  const openCheckout = (tier: PaidTier) => {
    setError(null);
    if (!stripeConfigured) {
      console.warn('VITE_STRIPE_PUBLISHABLE_KEY is not set');
      setError("Payments aren't available yet. Please try again later.");
      return;
    }
    setCheckoutTier(tier);
  };

  // Stripe changes straight away; the profile follows via the webhook, so
  // re-read it once that has had time to land.
  const runBilling = async (change: () => Promise<BillingSummary>) => {
    setBusy(true);
    setError(null);
    try {
      setBilling(await change());
      setConfirm(null);
      for (const wait of [1500, 4000]) {
        window.setTimeout(() => { void refresh.current(); }, wait);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing is unavailable');
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  };

  const canceling = billing?.subscription?.cancelAtPeriodEnd ?? subscriptionStatus === 'canceling';

  // What the button on each card does, given the plan the account is on now.
  const cardAction = (tier: SubscriptionTier): { label: string; onClick?: () => void } => {
    if (tier === subscriptionTier) return { label: 'Current plan' };
    if (tier === 'free') {
      if (!isSubscriber) return { label: 'Included' };
      return canceling
        ? { label: `Starts ${renewsOn ?? 'at period end'}` }
        : { label: 'Cancel subscription', onClick: () => setConfirm({ kind: 'cancel' }) };
    }
    if (subscriptionTier === 'lifetime') return { label: 'Included in Lifetime' };
    if (isSubscriber && tier !== 'lifetime') {
      return {
        label: `Switch to ${tier === 'premium_yearly' ? 'yearly' : 'monthly'}`,
        onClick: () => setConfirm({ kind: 'switch', to: tier }),
      };
    }
    return { label: tier === 'lifetime' ? 'Buy Lifetime' : 'Upgrade', onClick: () => openCheckout(tier) };
  };

  const confirmCopy = confirm?.kind === 'cancel'
    ? {
        title: 'Cancel your subscription?',
        body: `You keep Premium until ${renewsOn ?? 'the end of this billing period'}. After that your account moves to Free and you won't be charged again.`,
        confirmLabel: 'Cancel subscription',
        run: () => runBilling(() => setCancelAtPeriodEnd(true)),
      }
    : confirm?.kind === 'switch'
    ? {
        title: `Switch to ${confirm.to === 'premium_yearly' ? 'yearly' : 'monthly'}?`,
        body: confirm.to === 'premium_yearly'
          ? `You'll be billed ${price('premium_yearly')} a year from today. The unused part of this month is credited against it.`
          : `You'll be billed ${price('premium_monthly')} a month from today. The unused part of your year becomes credit toward those bills.`,
        confirmLabel: 'Switch plan',
        run: () => runBilling(() => switchSubscriptionPlan(confirm.to)),
      }
    : null;

  return (
    <div className="min-h-screen overflow-y-auto bg-black px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-5 top-5 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-2 flex items-center gap-3">
          <Sparkles size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-white">Choose Your Plan</h1>
        </div>
        <p className="mb-8 text-sm text-ink-secondary">
          You're currently on <span className="font-semibold text-gold">{SUBSCRIPTION_PLANS[subscriptionTier].label}</span>.
          {isSubscriber && renewsOn && (subscriptionStatus === 'canceling'
            ? ` It ends on ${renewsOn} and won't renew.`
            : ` It renews on ${renewsOn}.`)}
        </p>

        {subscriptionStatus === 'past_due' && (
          <p className="mb-4 rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            Your last payment didn't go through. Update your card under Billing to keep Premium.
          </p>
        )}
        {confirming && (
          <p className="mb-4 flex items-center gap-2 rounded-card border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
            <Loader2 size={16} className="animate-spin" /> Confirming your payment…
          </p>
        )}
        {upgradedTo && subscriptionTier === upgradedTo && (
          <p className="mb-4 rounded-card border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
            You're on {SUBSCRIPTION_PLANS[upgradedTo].label}. Thanks for upgrading.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        {subscriptionTier !== 'free' && (
          <BillingPanel
            tier={subscriptionTier}
            summary={billing}
            loading={billingLoading}
            busy={busy || confirming}
            onCancel={() => setConfirm({ kind: 'cancel' })}
            onResume={() => runBilling(() => setCancelAtPeriodEnd(false))}
            onSwitch={(to) => setConfirm({ kind: 'switch', to })}
            onCardSaved={setBilling}
          />
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:items-start">
          {PLAN_ORDER.map((tier) => {
            const plan = SUBSCRIPTION_PLANS[tier];
            const meta = PLAN_META[tier];
            const isCurrent = tier === subscriptionTier;
            const isFree = tier === 'free';
            const isPremium = tier === 'premium_monthly' || tier === 'premium_yearly' || tier === 'lifetime';
            const features = isFree ? FREE_FEATURES : PREMIUM_FEATURES;
            const price = plan.priceCents === 0 ? 'Free' : `$${(plan.priceCents / 100).toFixed(2)}`;
            const action = cardAction(tier);

            return (
              <div
                key={tier}
                className={`rounded-card border p-5 transition-all ${
                  isCurrent
                    ? 'border-gold bg-gold/10 shadow-gold-glow'
                    : isPremium
                    ? 'border-gold/30 bg-[#0d0d0d] hover:border-gold/60'
                    : 'border-gold/15 bg-[#0d0d0d]'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                      isCurrent ? 'bg-gold text-black' : 'bg-gold/10 text-gold'
                    }`}>
                      {meta.icon}
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">{plan.label}</h3>
                      <p className="text-xs text-ink-secondary">{meta.tagline}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-2xl font-bold text-gold">{price}</p>
                    {meta.period && <p className="text-xs text-ink-secondary">{meta.period}</p>}
                  </div>
                </div>

                <ul className="mt-4 space-y-1.5">
                  {features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-ink-secondary">
                      <Check size={14} className="shrink-0 text-gold" /> {f}
                    </li>
                  ))}
                </ul>

                {action.onClick ? (
                  <button
                    onClick={action.onClick}
                    disabled={busy || confirming}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    {action.label}
                  </button>
                ) : (
                  <p className={`mt-5 rounded-card py-3 text-center text-sm font-bold ${
                    isCurrent
                      ? 'border border-gold/30 bg-gold/10 text-gold'
                      : 'border border-gold/20 text-ink-secondary'
                  }`}>
                    {action.label}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Family is $7.99 a month for 4 people, plus $1 a month for each extra person.
          The yearly family price was quoted two ways, so it is not listed until that is settled.
          Ads for extra credits belong in the phone app, not here.
        </p>
      </div>

      {checkoutTier && (
        <CheckoutDialog
          tier={checkoutTier}
          onClose={() => setCheckoutTier(null)}
          onComplete={(tier) => {
            setCheckoutTier(null);
            setAwaitingTier(tier);
          }}
        />
      )}
      {confirmCopy && (
        <ConfirmDialog
          title={confirmCopy.title}
          body={confirmCopy.body}
          confirmLabel={confirmCopy.confirmLabel}
          busy={busy}
          onConfirm={confirmCopy.run}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
