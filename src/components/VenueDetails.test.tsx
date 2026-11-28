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
  await userEvent.click(screen.getByRole('button', { name: 'Mark visited' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ visited: true })));
  expect(update).toHaveBeenCalledWith('v', { visited: true });
});
it('hides edit and visited actions for another user’s shared venue', () => {
  const venue = { id: 'v', name: 'Shared fixture', address: '1 Test St', type: 'food', tags: [], visited: false } as unknown as SavedVenue;
  render(<VenueDetails venue={venue} owned={false} onClose={vi.fn()} onEdit={vi.fn()} onPlan={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mark visited' })).not.toBeInTheDocument();
});
it('reads the suburb and the source platform for the venue page', async () => {
  const { suburbOf, sourceOf } = await import('../lib/venuePage');
  expect(suburbOf('12 Liverpool Rd, Ashfield NSW 2131, Australia')).toBe('Ashfield, NSW');
  expect(suburbOf('Shop 3, 40 George St, Sydney NSW 2000')).toBe('Sydney, NSW');
  expect(suburbOf('Somewhere')).toBe('Somewhere');
  expect(sourceOf('https://www.instagram.com/reel/abc')).toEqual({ name: 'Instagram', video: true });
  expect(sourceOf('https://maps.google.com/?q=x')).toEqual({ name: 'Google Maps', video: false });
});
