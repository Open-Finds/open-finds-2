import { useEffect, useRef, useState } from 'react';
import { RING_START, stepRing, TICK_MS } from '../lib/progressRing';

/**
 * The AI Save loading ring: an orange line fills the card's border while two violet dots run around it
 * (hidden when the phone asks for reduced motion). How the line moves: see lib/progressRing.
 */
export function ProgressBorder({ value, done = false, onFilled }: {
  /** Real progress, 0 to 1: it only changes the line's speed. */
  value: number;
  /** The result is in: the line finishes the ring. */
  done?: boolean;
  /** Called once the line has gone all the way round. */
  onFilled?: () => void;
}) {
  const [shown, setShown] = useState(0);
  const latest = useRef({ value, done, onFilled });
  latest.current = { value, done, onFilled };

  useEffect(() => {
    // A timer, not requestAnimationFrame: the share pop-up over another app may never get animation frames,
    // and the line must still move there. The CSS transition below smooths between ticks.
    let last = performance.now();
    let state = RING_START;
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
      last = now;
      state = stepRing(state, latest.current.value, latest.current.done, dt);
      setShown(state.shown);
      if (state.shown >= 1) {
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
