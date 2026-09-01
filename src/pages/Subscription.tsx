import { useState } from 'react';
import { ChevronLeft, Check, Crown, Zap, Infinity as InfinityIcon, Loader2, Sparkles, Calendar, MapPin, Star, Ban } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { updateSubscriptionTier, SUBSCRIPTION_PLANS, type SubscriptionTier } from '../lib/supabase';

const PLAN_ORDER: SubscriptionTier[] = ['free', 'premium_monthly', 'premium_yearly', 'lifetime'];

const PLAN_META: Record<SubscriptionTier, { icon: React.ReactNode; tagline: string; period: string }> = {
  free: { icon: <Zap size={20} />, tagline: 'Get started for free', period: '' },
  premium_monthly: { icon: <Crown size={20} />, tagline: 'Best for trying Premium', period: '/mo' },
  premium_yearly: { icon: <Crown size={20} />, tagline: 'Save 50% vs monthly', period: '/yr' },
  lifetime: { icon: <InfinityIcon size={20} />, tagline: 'Pay once, keep forever', period: '' },
};

const FREE_FEATURES = [
  '3 active plans',
  '2 stops per plan',
  'Manual venue add (limited)',
  '3 discovery suggestions per week',
  'Share plan: copy link + social',
  'Full RSVP dashboard with decline reasons',
  'Google Maps + countdown',
  'Calendar export',
  'AI venue extraction',
  'Watch ad for credits',
];

const PREMIUM_FEATURES = [
  'Unlimited active plans',
  'Up to 5 stops per plan',
  'Unlimited venue adds',
  'Unlimited AI extraction',
  'Unlimited discovery suggestions',
  'Calendar export: Google + Apple + Outlook',
  'Travel mode: multi-day trips',
  'No ads',
];

export function SubscriptionPage({ onBack }: { onBack: () => void }) {
  const { subscriptionTier } = useAuth();
  const [selecting, setSelecting] = useState<SubscriptionTier | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<SubscriptionTier | null>(null);

  const handleSelect = async (tier: SubscriptionTier) => {
    if (tier === subscriptionTier) return;
    setError(null);
    setSelecting(tier);
    try {
      await updateSubscriptionTier(tier);
      setSuccess(tier);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update subscription.');
    } finally {
      setSelecting(null);
    }
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

      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-2 flex items-center gap-3">
          <Sparkles size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-white">Choose Your Plan</h1>
        </div>
        <p className="mb-8 text-sm text-ink-secondary">
          You're currently on <span className="font-semibold text-gold">{SUBSCRIPTION_PLANS[subscriptionTier].label}</span>
        </p>

        {error && (
          <div className="mb-4 rounded-card border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {PLAN_ORDER.map((tier) => {
            const plan = SUBSCRIPTION_PLANS[tier];
            const meta = PLAN_META[tier];
            const isCurrent = tier === subscriptionTier;
            const isSelecting = selecting === tier;
            const isFree = tier === 'free';
            const isLifetime = tier === 'lifetime';
            const isPremium = tier === 'premium_monthly' || tier === 'premium_yearly' || tier === 'lifetime';
            const features = isFree ? FREE_FEATURES : PREMIUM_FEATURES;
            const price = plan.priceCents === 0 ? 'Free' : `$${(plan.priceCents / 100).toFixed(2)}`;

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
                <div className="flex items-start justify-between">
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
                  <div className="text-right">
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
                  {isFree && (
                    <li className="flex items-center gap-2 text-sm text-ink-secondary/60">
                      <Ban size={14} className="shrink-0 text-danger/60" /> No multi-day trips
                    </li>
                  )}
                </ul>

                <button
                  onClick={() => handleSelect(tier)}
                  disabled={isCurrent || isSelecting}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-card py-3 text-sm font-bold transition-all active:scale-[0.98] disabled:cursor-default ${
                    isCurrent
                      ? 'border border-gold/30 bg-gold/10 text-gold'
                      : isPremium
                      ? 'bg-gold text-black shadow-gold-glow hover:brightness-110'
                      : 'border border-gold/30 bg-black/40 text-gold hover:bg-gold/10'
                  }`}
                >
                  {isCurrent ? (
                    <><Check size={16} /> Current Plan</>
                  ) : isSelecting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : success === tier ? (
                    <><Check size={16} /> Activated!</>
                  ) : isFree ? (
                    'Switch to Free'
                  ) : isLifetime ? (
                    'Buy Lifetime'
                  ) : (
                    `Upgrade to ${plan.label}`
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-xs text-ink-secondary">
          Payments are processed securely via Stripe. You can cancel anytime.
        </p>
      </div>
    </div>
  );
}
