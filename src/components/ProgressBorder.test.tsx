import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProgressBorder } from './ProgressBorder';
import { linkProgress, stepProgress } from '../lib/progressRing';

const run = (shown: number, value: number, toward: number, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) shown = stepProgress(shown, value, toward, 1 / 60);
  return shown;
};

it('catches up smoothly: faster when further behind, never past the real progress', () => {
  const far = stepProgress(0, 0.8, 0.8, 1 / 60);
  const near = stepProgress(0.7, 0.8, 0.8, 1 / 60) - 0.7;
  expect(far).toBeGreaterThan(near);
  expect(far).toBeLessThan(0.1);
  expect(run(0, 0.8, 0.8, 3)).toBeCloseTo(0.8, 5);
});

it('creeps while waiting, but stops short of where the step ends and never goes backwards', () => {
  const waited = run(0.15, 0.15, 0.6, 30);
  expect(waited).toBeGreaterThan(0.4);
  expect(waited).toBeLessThan(0.6);
  expect(stepProgress(0.5, 0.2, 0.3, 1)).toBe(0.5);
  expect(run(0, 1, 1, 3)).toBe(1);
});

it('reads how far a link search has got from its progress', () => {
  expect(linkProgress({}).value).toBe(0);
  expect(linkProgress({ checkedSaved: true }).value).toBe(0.1);
  expect(linkProgress({ checkedSaved: true, identification: { metadata: {} } }).value).toBe(0.3);
  expect(linkProgress({ candidates: [] }).value).toBe(0.6);
  expect(linkProgress({ candidates: [], searched: true }).value).toBe(0.7);
  expect(linkProgress({ rows: [] }).value).toBe(0.9);
});

it('fills the ring on a timer (the share pop-up may get no animation frames) and says when it is done', () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  const onFilled = vi.fn();
  render(<ProgressBorder value={1} onFilled={onFilled} />);
  act(() => { vi.advanceTimersByTime(5000); });
  expect(screen.getByRole('progressbar', { name: 'AI Save progress' })).toHaveAttribute('aria-valuenow', '100');
  expect(onFilled).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
