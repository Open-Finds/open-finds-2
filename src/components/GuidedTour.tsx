import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIETARY_OPTIONS, TOUR_STEPS } from '@/lib/tour';

/**
 * The walkthrough: a short tour over the real app (client, Round 3 item 7).
 * Each step lights up the button it's about, with two or three sentences on
 * what it does; people tap to move on. Finishing or skipping turns it off;
 * Settings → Replay Walkthrough turns it back on.
 *
 * Steps point at elements by `data-tour="…"`. When one isn't on screen (a
 * phone and a laptop show different navigation, and a step may be scrolled
 * away), the tour uses the visible one, scrolls it into view, or shows the
 * card on its own in the middle.
 */

const PAD = 8;
const GAP = 14;
const MARGIN = 16;

/** The first element for this step that is actually on screen. */
function findTarget(id: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${id}"]`));
  return all.find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }) ?? null;
}

export function GuidedTour({
  initialDietary,
  onFinish,
}: {
  initialDietary: string[];
  /** Called once, when the tour is done or skipped, with the dietary picks. */
  onFinish: (dietary: string[] | null) => void;
}) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [card, setCard] = useState<{ top: number; left: number; width: number } | null>(null);
  const [dietary, setDietary] = useState<Set<string>>(() => new Set(initialDietary));
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  // Track where the step's element is, through scrolling, resizing and the
  // page settling after it first draws.
  const measure = useCallback(() => {
    const el = findTarget(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step.target]);

  // Bring the step's element on screen. Done twice: the page can still be
  // laying itself out when a step starts, which leaves the first scroll short
  // or long. The navigation is fixed in place and never needs it.
  const ensureVisible = useCallback(() => {
    const el = findTarget(step.target);
    if (!el || el.closest('nav')) return;
    const r = el.getBoundingClientRect();
    if (r.top < MARGIN || r.bottom > window.innerHeight - MARGIN) {
      el.scrollIntoView({ block: r.height < window.innerHeight * 0.6 ? 'center' : 'start' });
    }
  }, [step.target]);

  useEffect(() => {
    ensureVisible();
    measure();
    const timers = [
      ...[100, 350, 700, 1000].map((ms) => window.setTimeout(measure, ms)),
      window.setTimeout(() => { ensureVisible(); measure(); }, 450),
    ];
    // Pages slide in when they open; a slide moves things without a scroll
    // or resize, so measure again whenever one finishes.
    const events = ['resize', 'scroll', 'animationend', 'transitionend'] as const;
    events.forEach((e) => window.addEventListener(e, measure, true));
    return () => {
      timers.forEach(clearTimeout);
      events.forEach((e) => window.removeEventListener(e, measure, true));
    };
  }, [step.target, measure, ensureVisible]);

  // Put the card below the highlight if it fits, otherwise above; centred
  // when there is nothing to point at.
  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(360, vw - MARGIN * 2);
    const height = cardRef.current?.offsetHeight ?? 220;
    if (!rect) {
      setCard({ top: Math.max(MARGIN, (vh - height) / 2), left: (vw - width) / 2, width });
      return;
    }
    const below = rect.bottom + PAD + GAP;
    const above = rect.top - PAD - GAP - height;
    const top = below + height <= vh - MARGIN ? below : above >= MARGIN ? above : Math.max(MARGIN, vh - height - MARGIN);
    const centre = rect.left + rect.width / 2;
    const left = Math.min(Math.max(MARGIN, centre - width / 2), vw - width - MARGIN);
    setCard({ top, left, width });
  }, [rect, index]);

  useEffect(() => { nextRef.current?.focus(); }, [index]);

  const finish = useCallback((skipped: boolean) => {
    onFinish(skipped ? null : Array.from(dietary));
  }, [dietary, onFinish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(true);
      if (e.key === 'ArrowRight' && !last) setIndex((i) => i + 1);
      if (e.key === 'ArrowLeft' && index > 0) setIndex((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [finish, last, index]);

  const toggle = (key: string) =>
    setDietary((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {/* The dimmed screen with a lit window over the step's button. */}
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-2xl ring-2 ring-gold transition-all duration-300"
          // Kept inside the screen: the tab bar sits on the bottom edge.
          style={{
            top: Math.max(2, rect.top - PAD),
            left: Math.max(2, rect.left - PAD),
            width: Math.min(window.innerWidth - 2, rect.right + PAD) - Math.max(2, rect.left - PAD),
            height: Math.min(window.innerHeight - 2, rect.bottom + PAD) - Math.max(2, rect.top - PAD),
            boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.72), 0 0 24px rgba(212, 175, 53, 0.45)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-black/75" />
      )}

      <div
        ref={cardRef}
        className="fixed rounded-card border border-gold/40 bg-[#141414] p-5 shadow-2xl transition-[top,left] duration-300"
        style={card ? { top: card.top, left: card.left, width: card.width } : { visibility: 'hidden' }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-gold/80">{index + 1} of {TOUR_STEPS.length}</span>
          <button
            onClick={() => finish(true)}
            className="flex items-center gap-1 text-xs text-ink-secondary transition-colors hover:text-white"
          >
            Skip tour <X size={13} />
          </button>
        </div>
        <h2 id="tour-title" className="text-lg font-bold text-white">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-secondary">{step.body}</p>

        {step.dietary && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DIETARY_OPTIONS.map((o) => {
              const on = dietary.has(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => toggle(o.key)}
                  aria-pressed={on}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold transition-all',
                    on ? 'border-gold bg-gold text-black' : 'border-gold/30 text-gold hover:bg-gold/10'
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1.5" aria-hidden="true">
            {TOUR_STEPS.map((_, i) => (
              <span key={i} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-5 bg-gold' : 'w-1.5 bg-gold/30')} />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <button
                onClick={() => setIndex((i) => i - 1)}
                className="flex items-center gap-1 rounded-card px-3 py-2 text-sm font-semibold text-ink-secondary transition-colors hover:text-white"
              >
                <ChevronLeft size={16} /> Back
              </button>
            )}
            <button
              ref={nextRef}
              onClick={() => (last ? finish(false) : setIndex((i) => i + 1))}
              className="flex items-center gap-1 rounded-card bg-gold px-4 py-2 text-sm font-bold text-black transition-all active:scale-95"
            >
              {last ? <><Check size={16} /> Done</> : <>Next <ChevronRight size={16} /></>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
