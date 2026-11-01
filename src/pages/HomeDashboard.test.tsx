import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ displayName: 'QA', session: { user: { id: 'qa' } } }) }));
vi.mock('../lib/supabase', () => ({ fetchSavedVenues: async () => [], fetchAllPlans: async () => [], fetchInvitedPlanIds: async () => [], fetchPlansByIds: async () => [] }));
vi.mock('../components/VenueDetails', () => ({ VenueDetails: () => null }));
vi.mock('../components/SavedVenueCard', () => ({ SavedVenueCard: () => null }));
import { HomeDashboard } from './HomeDashboard';
it('keeps one primary create-plan CTA when there are no upcoming events', async () => {
  const onPlan = vi.fn(); render(<HomeDashboard onPlan={onPlan} onVenues={vi.fn()} onEvent={vi.fn()} onSettings={vi.fn()} onSave={vi.fn()} />);
  await screen.findByText('No upcoming events yet.');
  expect(screen.queryByRole('button', { name: 'Plan an event' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Make a plan' })); expect(onPlan).toHaveBeenCalledTimes(1);
});

