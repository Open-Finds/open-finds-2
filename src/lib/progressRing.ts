/**
 * The maths behind the AI Save loading ring (components/ProgressBorder).
 *
 * Time drives the line, so it moves steadily: it follows a curve planned around a typical AI Save (about 20 s on
 * staging, 22 saves, Nov 2026; a quick one about 9 s, a slow one about 27 s) and eases off near the end, so a slow
 * save never sits at 99%. Real steps never move the line; they only change its speed: ahead of the line, it speeds
 * up (up to twice as fast); behind it, it slows down (never below 0.3x, so it never stops). The speed itself changes
 * gradually. When the result arrives, the line glides the rest of the way round in under a second.
 */

/** How often the line moves (a timer, see ProgressBorder). */
export const TICK_MS = 50;
/** The curve never passes this before the result arrives. */
const CEILING = 0.95;
/** Seconds for the curve to cover about two thirds of the way: ~80% at 20 s, ~87% at 27 s. */
const PACE = 11;
const MIN_RATE = 0.3;
const MAX_RATE = 2;
/** How strongly a gap between the real progress and the line changes the speed. */
const PULL = 4;
/** How quickly the speed itself changes (per second). */
const EASE = 1.5;

export type RingState = { /** Seconds along the curve. */ clock: number; rate: number; shown: number };
export const RING_START: RingState = { clock: 0, rate: 1, shown: 0 };

const curve = (clock: number) => CEILING * (1 - Math.exp(-clock / PACE));

/** One tick: `dt` seconds later. `value` is the real progress (0 to 1); `done` means the result is in. Never backwards. */
export function stepRing(state: RingState, value: number, done: boolean, dt: number): RingState {
  if (done) {
    const shown = Math.min(1, state.shown + Math.max((1 - state.shown) * 3, 0.4) * dt);
    return { ...state, shown };
  }
  const wanted = Math.min(MAX_RATE, Math.max(MIN_RATE, 1 + (value - state.shown) * PULL));
  const rate = state.rate + (wanted - state.rate) * Math.min(1, dt * EASE);
  const clock = state.clock + rate * dt;
  return { clock, rate, shown: Math.max(state.shown, curve(clock)) };
}

/** Where a link's AI Save has got to, from what it has already worked out (see SharedVenueProgress in aiSave). */
export function linkProgress(progress: {
  checkedSaved?: boolean; identification?: { metadata?: unknown }; candidates?: unknown; searched?: boolean;
  verified?: unknown; rows?: unknown;
}): number {
  if (progress.verified || progress.rows) return 0.9;
  if (progress.searched) return 0.7;
  if (progress.candidates) return 0.6;
  if (progress.identification?.metadata) return 0.3;
  if (progress.checkedSaved) return 0.1;
  return 0;
}
