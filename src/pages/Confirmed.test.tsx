import { expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
const countdown = vi.hoisted(() => vi.fn(() => ({ days: 0, hours: 1, minutes: 0, seconds: 0, isPast: false })));
vi.mock('../lib/countdown', () => ({ useCountdown: countdown, formatCountdown: () => '1 hour' }));
vi.mock('../lib/supabase', () => ({
  fetchPlan: async () => ({ id: 'p', title: 'Test plan', date: '2026-10-28', location: 'Sydney' }),
  fetchStops: async () => [{ id: 's', name: 'Test place', address: '1 Test St', time: '20:30', sort_order: 0 }],
  fetchRsvps: async () => [], sortStops: (s: unknown) => s,
}));
vi.mock('../components/Shared', () => ({ Timeline: () => null, RsvpList: () => null }));
vi.mock('../components/AddToCalendar', () => ({ AddToCalendar: () => null }));
import { ConfirmedPage } from './Confirmed';
it('counts down to the first stop, matching the host event summary', async () => {
  render(<ConfirmedPage id="p" />);
  await waitFor(() => expect(countdown).toHaveBeenLastCalledWith(new Date('2026-10-28T20:30:00').toISOString()));
});
