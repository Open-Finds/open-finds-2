import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProgressBorder } from './ProgressBorder';
import { linkProgress, RING_START, stepRing, type RingState } from '../lib/progressRing';

const TICK = 0.05;
/** The line after `seconds`, with the real progress fixed at `value`; also the biggest single move seen. */
const run = (seconds: number, value: number, from: RingState = RING_START, done = false) => {
  let state = from;
  let biggest = 0;
  for (let t = 0; t < seconds - 1e-9; t += TICK) {
    const next = stepRing(state, value, done, TICK);
    biggest = Math.max(biggest, next.shown - state.shown);
    expect(next.shown).toBeGreaterThanOrEqual(state.shown);
    state = next;
  }
  return { state, biggest };
};

it('follows a curve planned around a typical 20 second save, and never sits still or reaches the end on its own', () => {
  // Real progress keeping pace with the line: about 80% at 20 s, still moving and short of the end at 40 s.
  let state = RING_START;
  for (let t = 0; t < 20; t += TICK) state = stepRing(state, state.shown, false, TICK);
  expect(state.shown).toBeGreaterThan(0.75);
  expect(state.shown).toBeLessThan(0.85);
  const later = run(20, state.shown, state).state.shown;
  expect(later).toBeGreaterThan(state.shown);
  expect(later).toBeLessThan(0.95);
});

it('real steps change the speed (at most twice, at least 0.3x), never the position', () => {
  const ahead = run(5, 0.9);
  const behind = run(5, 0);
  const even = (() => { let s = RING_START; for (let t = 0; t < 5; t += TICK) s = stepRing(s, s.shown, false, TICK); return s; })();
  expect(ahead.state.shown).toBeGreaterThan(even.shown);
  expect(behind.state.shown).toBeLessThan(even.shown);
  expect(behind.state.shown).toBeGreaterThan(0);
  expect(ahead.state.rate).toBeLessThanOrEqual(2);
  expect(behind.state.rate).toBeGreaterThanOrEqual(0.3);
  // A step landing never makes the line lurch: no tick moves more than a sliver.
  expect(ahead.biggest).toBeLessThan(0.02);
});

it('glides the rest of the way round in under a second once the result is in', () => {
  const start = run(8, 0.3).state;
  const { state, biggest } = run(0.9, 1, start, true);
  expect(state.shown).toBe(1);
  expect(biggest).toBeLessThan(0.1);
});

it('reads how far a link search has got from its progress', () => {
  expect(linkProgress({})).toBe(0);
  expect(linkProgress({ checkedSaved: true })).toBe(0.1);
  expect(linkProgress({ checkedSaved: true, identification: { metadata: {} } })).toBe(0.3);
  expect(linkProgress({ candidates: [] })).toBe(0.6);
  expect(linkProgress({ candidates: [], searched: true })).toBe(0.7);
  expect(linkProgress({ rows: [] })).toBe(0.9);
});

it('fills the ring on a timer (the share pop-up may get no animation frames) and says when it is done', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  const onFilled = vi.fn();
  const { rerender } = render(<ProgressBorder value={0} onFilled={onFilled} />);
  act(() => { vi.advanceTimersByTime(3000); });
  const ring = screen.getByRole('progressbar', { name: 'AI Save progress' });
  expect(Number(ring.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
  expect(onFilled).not.toHaveBeenCalled();
  rerender(<ProgressBorder value={0.9} done onFilled={onFilled} />);
  act(() => { vi.advanceTimersByTime(1500); });
  expect(ring).toHaveAttribute('aria-valuenow', '100');
  expect(onFilled).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
