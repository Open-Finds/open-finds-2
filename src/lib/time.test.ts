import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { formatTime } from './time';
import { useCountdown, formatCountdown } from './countdown';
import { sortStops, sortStopsByTime, type Stop } from './supabase';

describe('formatTime', () => {
  it('converts 24h to 12h with a period', () => {
    expect(formatTime('19:15')).toBe('7:15 PM');
    expect(formatTime('07:15')).toBe('7:15 AM');
    expect(formatTime('13:00')).toBe('1:00 PM');
  });

  it('handles the two midnight/noon edge cases', () => {
    // 0 and 12 are where naive modulo arithmetic goes wrong.
    expect(formatTime('00:30')).toBe('12:30 AM');
    expect(formatTime('12:30')).toBe('12:30 PM');
  });

  it('returns the input unchanged when it cannot parse', () => {
    expect(formatTime('not a time')).toBe('not a time');
    expect(formatTime('')).toBe('');
  });
});

const stop = (name: string, time: string, sort_order: number): Stop =>
  ({ id: name, plan_id: 'p', name, address: 'a', time, vibe_link: null, sort_order, user_id: 'u' } as Stop);

describe('sortStops', () => {
  it('orders by sort_order, the single source of truth', () => {
    // Regression: this used to sort by time, which threw away fetchStops'
    // ORDER BY sort_order and made drag-to-reorder a silent no-op.
    const sorted = sortStops([
      stop('dinner', '20:00', 1),
      stop('drinks', '18:00', 0),
      stop('dessert', '22:00', 2),
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['drinks', 'dinner', 'dessert']);
  });

  it('keeps an explicit order even when it contradicts the times', () => {
    // A user who drags dessert to the front gets dessert at the front.
    const sorted = sortStops([
      stop('dinner', '20:00', 1),
      stop('dessert', '22:00', 0),
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['dessert', 'dinner']);
  });

  it('falls back to time when sort_order ties', () => {
    const sorted = sortStops([stop('late', '22:00', 0), stop('early', '18:00', 0)]);
    expect(sorted.map((s) => s.name)).toEqual(['early', 'late']);
  });

  it('does not mutate its input', () => {
    const input = [stop('b', '20:00', 1), stop('a', '18:00', 0)];
    const before = input.map((s) => s.name);
    sortStops(input);
    expect(input.map((s) => s.name)).toEqual(before);
  });
});

describe('sortStopsByTime', () => {
  it('orders chronologically regardless of sort_order', () => {
    const sorted = sortStopsByTime([
      stop('dessert', '22:00', 0),
      stop('drinks', '18:00', 2),
      stop('dinner', '20:00', 1),
    ]);
    expect(sorted.map((s) => s.name)).toEqual(['drinks', 'dinner', 'dessert']);
  });

  it('compares zero-padded 24h strings correctly', () => {
    // String comparison only works because times are zero-padded and 24-hour.
    const sorted = sortStopsByTime([stop('ten', '10:00', 0), stop('nine', '09:00', 1)]);
    expect(sorted.map((s) => s.name)).toEqual(['nine', 'ten']);
  });
});

describe('useCountdown', () => {
  afterEach(() => vi.useRealTimers());

  it('counts down to a future date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const target = new Date('2026-01-03T05:30:15Z').toISOString();

    const { result } = renderHook(() => useCountdown(target));
    expect(result.current.days).toBe(2);
    expect(result.current.hours).toBe(5);
    expect(result.current.minutes).toBe(30);
    expect(result.current.isPast).toBe(false);
  });

  it('clamps to zero once the target has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00Z'));
    const { result } = renderHook(() => useCountdown(new Date('2026-01-01T00:00:00Z').toISOString()));

    expect(result.current.isPast).toBe(true);
    expect(result.current.days).toBe(0);
    expect(result.current.hours).toBe(0);
  });

  it('ticks forward as time passes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { result } = renderHook(() =>
      useCountdown(new Date('2026-01-01T00:01:00Z').toISOString())
    );
    expect(result.current.seconds).toBe(60 % 60);

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current.seconds).toBe(30);
  });
});

describe('formatCountdown', () => {
  it('pluralises each unit independently', () => {
    expect(formatCountdown({ days: 1, hours: 1, minutes: 1 })).toBe('1 day, 1 hr, 1 min');
    expect(formatCountdown({ days: 2, hours: 3, minutes: 4 })).toBe('2 days, 3 hrs, 4 min');
    expect(formatCountdown({ days: 0, hours: 0, minutes: 0 })).toBe('0 days, 0 hrs, 0 min');
  });
});
