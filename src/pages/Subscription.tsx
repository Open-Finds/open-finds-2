import { ChevronLeft, Check, Crown, Zap, Infinity as InfinityIcon, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { SUBSCRIPTION_PLANS, type SubscriptionTier } from '../lib/supabase';

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

export function SubscriptionPage({ onBack }: { onBack: () => void }) {
  const { subscriptionTier } = useAuth();

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
          You're currently on <span className="font-semibold text-gold">{SUBSCRIPTION_PLANS[subscriptionTier].label}</span>.
          Checkout is not open yet, so a plan cannot be switched from this screen.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 xl:items-start">
          {PLAN_ORDER.map((tier) => {
            const plan = SUBSCRIPTION_PLANS[tier];
            const meta = PLAN_META[tier];
            const isCurrent = tier === subscriptionTier;
            const isFree = tier === 'free';
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
                </ul>

                <p className={`mt-5 rounded-card py-3 text-center text-sm font-bold ${
                  isCurrent
                    ? 'border border-gold/30 bg-gold/10 text-gold'
                    : 'border border-gold/20 text-ink-secondary'
                }`}>
                  {isCurrent ? 'Current plan' : 'Opens with checkout'}
                </p>
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
