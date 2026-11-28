import { useEffect, useRef, useState } from 'react';
import { stepProgress, TICK_MS } from '../lib/progressRing';

/**
 * The AI Save loading ring: an orange line fills the card's border as real steps finish, while two violet dots
 * run around it to show it is still working (hidden when the phone asks for reduced motion).
 *
 * The line never jumps. It moves faster the further it is behind the real progress (`value`), and while it waits
 * for the next step it creeps slowly towards `toward` (where the current step ends) without ever reaching it.
 * It never goes backwards.
 */

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
    // A timer, not requestAnimationFrame: the share pop-up over another app may never get animation frames,
    // and the line must still move there. The CSS transition below smooths between ticks.
    let last = performance.now();
    let current = 0;
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      const { value: target, toward: next } = latest.current;
      current = stepProgress(current, target, next, dt);
      setShown(current);
      if (current >= 1) {
        clearInterval(timer);
        latest.current.onFilled?.();
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const percent = Math.round(shown * 100);
  return <svg role="progressbar" aria-label="AI Save progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
    className="pointer-events-none absolute inset-0 size-full">
    <rect x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="15" pathLength="100" fill="none"
      className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${shown * 100} 100`}
      style={{ transition: `stroke-dasharray ${TICK_MS}ms linear` }} />
    {/* Two short dashes, half the border apart, running round (rounded ends make them dots). */}
    <rect x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="15" pathLength="100" fill="none"
      className="ai-save-dots stroke-ai" strokeWidth="4" strokeLinecap="round" strokeDasharray="0.6 49.4" />
  </svg>;
}
