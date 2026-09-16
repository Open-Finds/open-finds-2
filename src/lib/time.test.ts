import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { formatTime } from './time';
import { useCountdown, formatCountdown } from './countdown';
import { sortStops, type Stop } from './supabase';

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

describe('sortStops', () => {
  const stop = (name: string, time: string): Stop =>
    ({ id: name, plan_id: 'p', name, address: 'a', time, vibe_link: null, sort_order: 0, user_id: 'u' } as Stop);

  it('orders by time ascending', () => {
    const sorted = sortStops([stop('late', '22:00'), stop('early', '18:00'), stop('mid', '20:30')]);
    expect(sorted.map((s) => s.name)).toEqual(['early', 'mid', 'late']);
  });

  it('sorts zero-padded 24h strings correctly', () => {
    // The implementation compares strings, which only works because times are
    // zero-padded and 24-hour. "09:00" must sort before "10:00".
    const sorted = sortStops([stop('ten', '10:00'), stop('nine', '09:00')]);
    expect(sorted.map((s) => s.name)).toEqual(['nine', 'ten']);
  });

  it('does not mutate its input', () => {
    const input = [stop('b', '20:00'), stop('a', '18:00')];
    const before = input.map((s) => s.name);
    sortStops(input);
    expect(input.map((s) => s.name)).toEqual(before);
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
