/** The maths behind the AI Save loading ring (components/ProgressBorder). */

/** How quickly the line closes the gap to `value`: a share of the gap per second, with a floor so the end is not slow. */
const CATCH_UP = 3;
const MIN_SPEED = 0.15;
/** Seconds for the creep to cover about two thirds of the way to `toward`. */
const CREEP = 4;
/** The creep stops short of where the step ends, so a slow step still has room to move. */
const CREEP_SHARE = 0.85;
/** How often the line moves (a timer, see ProgressBorder). */
export const TICK_MS = 50;

/** One frame of movement: `dt` seconds after `shown`. Never backwards, never past 1. */
export function stepProgress(shown: number, value: number, toward: number, dt: number): number {
  const target = Math.min(1, Math.max(0, value));
  if (shown < target) return Math.min(target, shown + Math.max((target - shown) * CATCH_UP, MIN_SPEED) * dt);
  const ceiling = target + (Math.max(target, Math.min(1, toward)) - target) * CREEP_SHARE;
  if (shown >= ceiling) return shown;
  return shown + (ceiling - shown) * (1 - Math.exp(-dt / CREEP));
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
