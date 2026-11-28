import { useEffect, useRef, useState } from 'react';

/**
 * The AI Save loading ring: an orange line fills the card's border as real steps finish, while two violet dots
 * run around it to show it is still working (hidden when the phone asks for reduced motion).
 *
 * The line never jumps. It moves faster the further it is behind the real progress (`value`), and while it waits
 * for the next step it creeps slowly towards `toward` (where the current step ends) without ever reaching it.
 * It never goes backwards.
 */

/** How quickly the line closes the gap to `value`: a share of the gap per second, with a floor so the end is not slow. */
const CATCH_UP = 3;
const MIN_SPEED = 0.15;
/** Seconds for the creep to cover about two thirds of the way to `toward`. */
const CREEP = 4;
/** The creep stops short of where the step ends, so a slow step still has room to move. */
const CREEP_SHARE = 0.85;

/** One frame of movement: `dt` seconds after `shown`. Never backwards, never past 1. */
export function stepProgress(shown: number, value: number, toward: number, dt: number): number {
  const target = Math.min(1, Math.max(0, value));
  if (shown < target) return Math.min(target, shown + Math.max((target - shown) * CATCH_UP, MIN_SPEED) * dt);
  const ceiling = target + (Math.max(target, Math.min(1, toward)) - target) * CREEP_SHARE;
  if (shown >= ceiling) return shown;
  return shown + (ceiling - shown) * (1 - Math.exp(-dt / CREEP));
}

export function ProgressBorder({ value, toward = value, onFilled }: {
  /** Real progress, 0 to 1. 1 fills the ring. */
  value: number;
  /** Where the current step will end: the line creeps towards it while waiting. */
  toward?: number;
  /** Called once the line has gone all the way round. */
  onFilled?: () => void;
}) {
  const [shown, setShown] = useState(0);
  const latest = useRef({ value, toward, onFilled });
  latest.current = { value, toward, onFilled };

  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let current = 0;
    let filled = false;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const { value: target, toward: next } = latest.current;
      current = stepProgress(current, target, next, dt);
      setShown(current);
      if (current >= 1 && !filled) {
        filled = true;
        latest.current.onFilled?.();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const percent = Math.round(shown * 100);
  return <svg role="progressbar" aria-label="AI Save progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    className="pointer-events-none absolute inset-0 size-full">
    <rect x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="15" pathLength="100" fill="none"
      className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${shown * 100} 100`} />
    {/* Two dots, half the border apart, running round. */}
    <rect x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="15" pathLength="100" fill="none"
      className="ai-save-dots stroke-ai" strokeWidth="6" strokeLinecap="round" strokeDasharray="0.001 49.999" />
  </svg>;
}

/** Where a link's AI Save has got to, from what it has already worked out (see SharedVenueProgress in aiSave). */
export function linkProgress(progress: {
  checkedSaved?: boolean; identification?: { metadata?: unknown }; candidates?: unknown; searched?: boolean;
  verified?: unknown; rows?: unknown;
}): { value: number; toward: number } {
  if (progress.verified || progress.rows) return { value: 0.9, toward: 0.98 };
  if (progress.searched) return { value: 0.7, toward: 0.9 };
  if (progress.candidates) return { value: 0.6, toward: 0.9 };
  if (progress.identification?.metadata) return { value: 0.3, toward: 0.6 };
  if (progress.checkedSaved) return { value: 0.1, toward: 0.3 };
  return { value: 0, toward: 0.1 };
}
