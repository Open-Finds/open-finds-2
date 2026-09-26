import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Check, Crown, Zap, Infinity as InfinityIcon, Sparkles, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  SUBSCRIPTION_PLANS,
  fetchProfile,
  openBillingPortal,
  startCheckout,
  type SubscriptionTier,
} from '../lib/supabase';

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

function formatDate(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function SubscriptionPage({ onBack }: { onBack: () => void }) {
  const { session, subscriptionTier, subscriptionStatus, subscriptionRenewsAt, refreshProfile } = useAuth();
  const [busy, setBusy] = useState<PaidTier | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [{ result: returned, tier: boughtTier }] = useState(checkoutReturn);
  const [confirming, setConfirming] = useState(returned === 'success');
  const refresh = useRef(refreshProfile);
  refresh.current = refreshProfile;
  const userId = session?.user.id;

  const isSubscriber = subscriptionTier === 'premium_monthly' || subscriptionTier === 'premium_yearly';
  const renewsOn = formatDate(subscriptionRenewsAt);

  // Back from Stripe. The webhook usually lands within a second or two, and
  // often before this page loads, so wait for the tier that was bought rather
  // than for any change: the profile may already show it.
  useEffect(() => {
    if (returned) {
      window.history.replaceState(null, '', window.location.pathname + '#/subscription');
    }
    if (returned !== 'success' || !userId) return;
    let tries = 0;
    const timer = window.setInterval(async () => {
      tries += 1;
      const profile = await fetchProfile(userId).catch(() => null);
      const done = boughtTier
        ? profile?.subscription_tier === boughtTier
        : profile != null && profile.subscription_tier !== 'free';
      if (done) {
        window.clearInterval(timer);
        await refresh.current();
        setConfirming(false);
      } else if (tries >= 20) {
        window.clearInterval(timer);
        setConfirming(false);
        setError('Payment received, but your plan has not updated yet. Refresh in a minute.');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [returned, boughtTier, userId]);

  const go = async (action: PaidTier | 'portal') => {
    setBusy(action);
    setError(null);
    try {
      const url = action === 'portal' ? await openBillingPortal() : await startCheckout(action);
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing is unavailable');
      setBusy(null);
    }
  };

  // What the button on each card does, given the plan the account is on now.
  const cardAction = (tier: SubscriptionTier): { label: string; onClick?: () => void } => {
    if (tier === subscriptionTier) return { label: 'Current plan' };
    if (tier === 'free') {
      return isSubscriber ? { label: 'Cancel in billing', onClick: () => go('portal') } : { label: 'Included' };
    }
    if (subscriptionTier === 'lifetime') return { label: 'Included in Lifetime' };
    if (isSubscriber && tier !== 'lifetime') return { label: 'Switch in billing', onClick: () => go('portal') };
    return { label: tier === 'lifetime' ? 'Buy Lifetime' : 'Upgrade', onClick: () => go(tier) };
  };

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
            Your last payment didn't go through. Update your card in billing to keep Premium.
          </p>
        )}
        {confirming && (
          <p className="mb-4 flex items-center gap-2 rounded-card border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
            <Loader2 size={16} className="animate-spin" /> Confirming your payment…
          </p>
        )}
        {returned === 'success' && !confirming && !error && subscriptionTier !== 'free' && (
          <p className="mb-4 rounded-card border border-gold/30 bg-gold/10 px-4 py-3 text-sm text-gold">
            You're on {SUBSCRIPTION_PLANS[subscriptionTier].label}. Thanks for upgrading.
          </p>
        )}
        {returned === 'cancelled' && (
          <p className="mb-4 rounded-card border border-gold/15 px-4 py-3 text-sm text-ink-secondary">
            Checkout was cancelled. You haven't been charged.
          </p>
        )}
        {error && (
          <p role="alert" className="mb-4 rounded-card border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}
        {(isSubscriber || subscriptionTier === 'lifetime') && (
          <button
            onClick={() => go('portal')}
            disabled={busy !== null}
            className="mb-6 flex items-center gap-2 rounded-card border border-gold/40 px-4 py-2 text-sm font-bold text-gold transition-all hover:bg-gold/10 active:scale-95 disabled:opacity-50"
          >
            {busy === 'portal' && <Loader2 size={14} className="animate-spin" />}
            Manage billing
          </button>
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
                    disabled={busy !== null || confirming}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
                  >
                    {busy === tier && <Loader2 size={14} className="animate-spin" />}
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
    </div>
  );
}
