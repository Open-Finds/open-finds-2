import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Plan, Rsvp, Stop } from '../lib/supabase';

/**
 * The guest RSVP flow — the app's most important path, and the one that broke
 * when the M01 lockdown removed the open INSERT policy while this page was
 * still writing to the rsvps table directly.
 *
 * The assertion that matters is that submitting goes through insertRsvp() (the
 * submit_plan_rsvp RPC) and never touches supabase.from('rsvps').
 */

const fetchPlan = vi.fn();
const fetchStops = vi.fn();
const fetchRsvps = vi.fn();
const insertRsvp = vi.fn();
const setGuestName = vi.fn();
const sendGuestRsvpPushNotification = vi.fn();
const fromSpy = vi.fn();

vi.mock('../lib/supabase', () => ({
  supabase: {
    // Any direct table access from this page is a bug; record it so the test
    // can assert it never happens.
    from: (...args: unknown[]) => {
      fromSpy(...args);
      throw new Error('Rsvp.tsx must not write to tables directly');
    },
    auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) },
  },
  fetchPlan: (...a: unknown[]) => fetchPlan(...a),
  fetchStops: (...a: unknown[]) => fetchStops(...a),
  fetchRsvps: (...a: unknown[]) => fetchRsvps(...a),
  insertRsvp: (...a: unknown[]) => insertRsvp(...a),
  setGuestName: (...a: unknown[]) => setGuestName(...a),
  sendGuestRsvpPushNotification: (...a: unknown[]) => sendGuestRsvpPushNotification(...a),
  sortStops: (s: Stop[]) => [...s].sort((a, b) => a.time.localeCompare(b.time)),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ session: null, displayName: null }),
}));

const { RsvpPage } = await import('./Rsvp');

const plan: Plan = {
  id: 'plan-1',
  title: 'Birthday Night',
  date: '2026-12-01',
  host_name: 'Alex',
  location: 'Fitzroy',
  type: 'food',
  status: 'active',
  share_link: '/plan/plan-1',
  canceled: false,
  user_id: 'device-1',
  trip_id: null,
  day_number: null,
  accommodation_name: null,
  accommodation_address: null,
  created_at: '2026-09-01T00:00:00Z',
} as Plan;

const stop: Stop = {
  id: 'stop-1', plan_id: 'plan-1', name: 'Cutler & Co',
  address: '55 Gertrude St', time: '19:00', vibe_link: null,
  sort_order: 0, user_id: 'device-1',
} as Stop;

beforeEach(() => {
  fetchPlan.mockResolvedValue(plan);
  fetchStops.mockResolvedValue([stop]);
  fetchRsvps.mockResolvedValue([] as Rsvp[]);
  insertRsvp.mockResolvedValue({ id: 'rsvp-1', name: 'Jordan', status: 'in' } as Rsvp);
  sendGuestRsvpPushNotification.mockResolvedValue(undefined);
  fromSpy.mockClear();
});

describe('guest RSVP', () => {
  it('shows the plan a share link points at', async () => {
    render(<RsvpPage id="plan-1" />);
    expect(await screen.findByText('Birthday Night')).toBeInTheDocument();
    expect(screen.getByText('Cutler & Co')).toBeInTheDocument();
  });

  it('refuses to submit without a name', async () => {
    const user = userEvent.setup();
    render(<RsvpPage id="plan-1" />);
    await screen.findByText('Birthday Night');

    await user.click(screen.getByRole('button', { name: /i'?m in/i }));

    expect(await screen.findByText(/please enter your name/i)).toBeInTheDocument();
    expect(insertRsvp).not.toHaveBeenCalled();
  });

  it('submits an acceptance through the RPC, not a direct table write', async () => {
    const user = userEvent.setup();
    render(<RsvpPage id="plan-1" />);
    await screen.findByText('Birthday Night');

    await user.type(screen.getByPlaceholderText(/your name/i), 'Jordan');
    await user.click(screen.getByRole('button', { name: /i'?m in/i }));

    await waitFor(() => {
      expect(insertRsvp).toHaveBeenCalledWith({
        plan_id: 'plan-1',
        name: 'Jordan',
        status: 'in',
      });
    });
    // The regression guard: no supabase.from() anywhere in this flow.
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('notifies the host after a successful RSVP', async () => {
    const user = userEvent.setup();
    render(<RsvpPage id="plan-1" />);
    await screen.findByText('Birthday Night');

    await user.type(screen.getByPlaceholderText(/your name/i), 'Jordan');
    await user.click(screen.getByRole('button', { name: /i'?m in/i }));

    await waitFor(() => {
      expect(sendGuestRsvpPushNotification).toHaveBeenCalledWith({
        planId: 'plan-1', rsvpName: 'Jordan', rsvpStatus: 'in',
      });
    });
  });

  it('submits a decline with the declined status', async () => {
    insertRsvp.mockResolvedValue({ id: 'rsvp-2', name: 'Sam', status: 'declined' } as Rsvp);
    const user = userEvent.setup();
    render(<RsvpPage id="plan-1" />);
    await screen.findByText('Birthday Night');

    await user.type(screen.getByPlaceholderText(/your name/i), 'Sam');
    await user.click(screen.getByRole('button', { name: /can'?t make it/i }));

    await waitFor(() => {
      expect(insertRsvp).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'declined', name: 'Sam' })
      );
    });
  });

  it('surfaces a submission failure instead of failing silently', async () => {
    // What a blocked RLS policy looks like from the client.
    insertRsvp.mockRejectedValue(new Error('new row violates row-level security policy'));
    const user = userEvent.setup();
    render(<RsvpPage id="plan-1" />);
    await screen.findByText('Birthday Night');

    await user.type(screen.getByPlaceholderText(/your name/i), 'Jordan');
    await user.click(screen.getByRole('button', { name: /i'?m in/i }));

    expect(await screen.findByText(/row-level security/i)).toBeInTheDocument();
  });
});
