import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { HomeDashboard } from './HomeDashboard';

const api = vi.hoisted(() => ({
  fetchSavedVenues: vi.fn(),
  fetchAllPlans: vi.fn(),
  fetchInvitedPlanIds: vi.fn(),
  fetchPlansByIds: vi.fn(),
  fetchStops: vi.fn(),
  fetchRsvps: vi.fn(),
  sortStops: vi.fn(stops => stops),
  updateSavedVenue: vi.fn(),
}));
vi.mock('../lib/supabase', () => api);
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ displayName: 'QA', session: { user: { id: 'qa' } } }) }));
vi.mock('../components/VenueDetails', () => ({ VenueDetails: () => null }));
vi.mock('../components/SavedVenueCard', () => ({ SavedVenueCard: () => null }));
vi.mock('../components/VenueThumb', () => ({ VenueThumb: () => null }));

const venue = { id: 'venue-1', name: 'Supper Club', address: '11 Test Street', type: 'food', user_id: 'qa', visited: true, tags: ['casual'] };
const props = () => ({
  onPlan: vi.fn(), onVenues: vi.fn(), onEvent: vi.fn(), onEvents: vi.fn(),
  onSettings: vi.fn(), onSave: vi.fn(), onNotifications: vi.fn(), unreadCount: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  api.fetchSavedVenues.mockResolvedValue([]);
  api.fetchAllPlans.mockResolvedValue([]);
  api.fetchInvitedPlanIds.mockResolvedValue([]);
  api.fetchPlansByIds.mockResolvedValue([]);
});

it('offers one primary planning action when there are no upcoming events', async () => {
  const actions = props();
  render(<HomeDashboard {...actions} />);
  await screen.findByText('No upcoming events yet.');
  await userEvent.click(screen.getByRole('button', { name: /Make a plan/ }));
  expect(actions.onPlan).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'Save Venues' }));
  expect(actions.onSave).toHaveBeenCalledOnce();
});

it('connects dashboard actions to the selected event, venue and navigation', async () => {
  api.fetchSavedVenues.mockResolvedValue([venue]);
  api.fetchAllPlans.mockResolvedValue([{ id: 'event-1', title: 'Dinner', date: '2099-10-17', location: 'Bankstown' }]);
  api.fetchStops.mockResolvedValue([{ time: '19:30' }]);
  api.fetchRsvps.mockResolvedValue([{ id: 'a', status: 'in', name: 'Jacky' }, { id: 'b', status: 'declined', name: 'Rory' }]);
  api.updateSavedVenue.mockResolvedValue({ ...venue, tags: ['casual', 'Favourite'] });
  const actions = props();
  render(<HomeDashboard {...actions} />);
  expect(await screen.findByText('1 going')).toBeInTheDocument();
  expect(screen.getByText(/7:30 PM · Bankstown/)).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
  await userEvent.click(screen.getByRole('button', { name: /Dinner/ }));
  await userEvent.click(screen.getByRole('button', { name: /Upcoming events/ }));
  await userEvent.click(screen.getByRole('button', { name: /All venues/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Profile and settings' }));
  await userEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
  await userEvent.click(screen.getByRole('button', { name: 'Plan it at Supper Club' }));
  await userEvent.click(screen.getByRole('button', { name: 'Favourite Supper Club' }));
  expect(actions.onEvent).toHaveBeenCalledWith('event-1');
  expect(actions.onEvents).toHaveBeenCalledOnce();
  expect(actions.onVenues).toHaveBeenCalledOnce();
  expect(actions.onSettings).toHaveBeenCalledOnce();
  expect(actions.onNotifications).toHaveBeenCalledOnce();
  expect(actions.onPlan).toHaveBeenCalledWith('saved', venue);
  expect(api.updateSavedVenue).toHaveBeenCalledWith('venue-1', { tags: ['casual', 'Favourite'] });
  expect(screen.getByRole('button', { name: 'Favourite Supper Club' })).toHaveAttribute('aria-pressed', 'true');
});
