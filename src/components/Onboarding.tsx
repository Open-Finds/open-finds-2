import { useState } from 'react';
import {
  Link2,
  Sparkles,
  Send,
  Compass,
  ChevronRight,
  X,
  Check,
  Utensils,
} from 'lucide-react';
import { updateDietaryPreferences } from '../lib/supabase';

const STEPS = [
  {
    icon: Link2,
    title: 'Save Venues from Links',
    desc: 'Paste any Instagram, website, or map link and we\u2019ll pull the venue details automatically. Build your personal collection over time.',
  },
  {
    icon: Sparkles,
    title: 'Plan a Night Out',
    desc: 'Pick your vibe \u2014 food, activity, or dessert \u2014 and we\u2019ll curate a multi-stop itinerary with travel times between each spot.',
  },
  {
    icon: Send,
    title: 'Invite Your Friends',
    desc: 'Share your plan with a link. Friends can RSVP in one tap \u2014 no account needed. See who\u2019s in, who\u2019s out, live.',
  },
  {
    icon: Compass,
    title: 'Plan Trips Too',
    desc: 'Going further? Use the Trip Planner to map out multi-day adventures with daily itineraries and shared RSVPs.',
  },
] as const;

const DIETARY_OPTIONS = [
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten-free', label: 'Gluten-Free' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'dairy-free', label: 'Dairy-Free' },
  { key: 'nut-allergy', label: 'Nut Allergy' },
  { key: 'pescatarian', label: 'Pescatarian' },
];

export function Onboarding({ onComplete }: { onComplete: (dontShowAgain: boolean) => void }) {
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [dietarySelections, setDietarySelections] = useState<Set<string>>(new Set());
  const [savingDietary, setSavingDietary] = useState(false);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isDietaryStep = step === STEPS.length;
  const Icon = current.icon;

  const toggleDietary = (key: string) => {
    setDietarySelections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const next = () => {
    if (isLast) {
      setStep((s) => s + 1);
    } else if (isDietaryStep) {
      (async () => {
        setSavingDietary(true);
        try {
          await updateDietaryPreferences(Array.from(dietarySelections));
        } catch {
          /* ignore — preferences are optional */
        } finally {
          setSavingDietary(false);
        }
        onComplete(dontShowAgain);
      })();
    } else {
      setStep((s) => s + 1);
    }
  };

  const totalSteps = STEPS.length + 1;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black px-6">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, #1a1207 0%, #0a0a0a 55%, #000000 100%)',
        }}
      />

      {/* Skip button */}
      <button
        onClick={() => onComplete(dontShowAgain)}
        className="absolute right-5 top-5 z-10 flex items-center gap-1 text-sm font-medium text-ink-secondary transition-colors hover:text-white"
      >
        Skip <X size={16} />
      </button>

      <div className="relative z-10 flex w-full max-w-md flex-col items-center text-center">
        {isDietaryStep ? (
          <>
            {/* Dietary preferences step */}
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gold/30 bg-gold/10 shadow-gold-glow">
              <Utensils size={36} className="text-gold" />
            </div>

            <h2 className="mt-8 text-2xl font-bold text-white">Dietary Preferences</h2>

            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              Help our AI find venues that work for you. Select any dietary needs and we\u2019ll filter recommendations accordingly. You can change these anytime in Settings.
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {DIETARY_OPTIONS.map((opt) => {
                const selected = dietarySelections.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    onClick={() => toggleDietary(opt.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                      selected
                        ? 'border-gold bg-gold text-black'
                        : 'border-gold/30 bg-black/50 text-gold hover:border-gold/60'
                    }`}
                  >
                    {selected && <Check size={14} strokeWidth={3} />}
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Progress dots */}
            <div className="mt-10 flex gap-2">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === step ? 'w-8 bg-gold' : 'w-2 bg-gold/30'
                  }`}
                />
              ))}
            </div>

            {/* Don't show again checkbox */}
            <label className="mt-8 flex cursor-pointer items-center gap-2.5 select-none">
              <button
                type="button"
                onClick={() => setDontShowAgain((v) => !v)}
                className={`flex h-6 w-6 items-center justify-center rounded-md border-2 transition-all ${
                  dontShowAgain
                    ? 'border-gold bg-gold text-black'
                    : 'border-gold/40 bg-transparent'
                }`}
              >
                {dontShowAgain && <Check size={16} strokeWidth={3} />}
              </button>
              <span className="text-sm font-medium text-ink-secondary">
                Do not show again
              </span>
            </label>

            {/* Get Started button */}
            <button
              onClick={next}
              disabled={savingDietary}
              className="mt-6 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3.5 text-base font-bold text-black shadow-gold-glow transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
            >
              {savingDietary ? 'Saving...' : 'Get Started'}
            </button>

            {!dontShowAgain && (
              <p className="mt-3 text-xs text-ink-secondary/60">
                You\u2019ll see this guide again next time. Replay it anytime in Settings.
              </p>
            )}
          </>
        ) : (
          <>
            {/* Icon */}
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gold/30 bg-gold/10 shadow-gold-glow">
              <Icon size={36} className="text-gold" />
            </div>

            {/* Title */}
            <h2 className="mt-8 text-2xl font-bold text-white">{current.title}</h2>

            {/* Description */}
            <p className="mt-4 text-base leading-relaxed text-ink-secondary">
              {current.desc}
            </p>

            {/* Progress dots */}
            <div className="mt-10 flex gap-2">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <span
                  key={i}
                  className={`h-2 rounded-full transition-all duration-300 ${
                    i === step ? 'w-8 bg-gold' : 'w-2 bg-gold/30'
                  }`}
                />
              ))}
            </div>

            {/* Next / Get Started button */}
            <button
              onClick={next}
              className="mt-6 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3.5 text-base font-bold text-black shadow-gold-glow transition-all duration-200 active:scale-[0.98]"
            >
              Next <ChevronRight size={20} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
