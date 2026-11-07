import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavedVenue } from '../lib/supabase';
const update = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ updateSavedVenue: update }));
import { VenueDetails } from './VenueDetails';
it('persists visited status and reports the returned record to the library', async () => {
  const venue = { id: 'v', name: 'Fixture café', address: '1 Test St', type: 'food', tags: [], visited: false } as unknown as SavedVenue;
  const onSaved = vi.fn(); update.mockResolvedValue({ ...venue, visited: true });
  render(<VenueDetails venue={venue} owned onClose={vi.fn()} onEdit={vi.fn()} onPlan={vi.fn()} onSaved={onSaved} />);
  await userEvent.click(screen.getByRole('button', { name: 'Not visited' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ visited: true })));
  expect(update).toHaveBeenCalledWith('v', { visited: true });
});
it('hides edit and visited actions for another user’s shared venue', () => {
  const venue = { id: 'v', name: 'Shared fixture', address: '1 Test St', type: 'food', tags: [], visited: false } as unknown as SavedVenue;
  render(<VenueDetails venue={venue} owned={false} onClose={vi.fn()} onEdit={vi.fn()} onPlan={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Not visited' })).not.toBeInTheDocument();
});
