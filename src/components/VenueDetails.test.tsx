import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavedVenue } from '../lib/supabase';
const update = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ updateSavedVenue: update }));
const share = vi.hoisted(() => ({ publish: vi.fn(), send: vi.fn() }));
vi.mock('../lib/aiSave', () => ({ publishVenue: share.publish, sendRecommendation: share.send, shareRecommendationOrigin: () => 'https://staging.example.test' }));
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
  expect(screen.queryByRole('button', { name: 'Quick Share' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Not visited' })).not.toBeInTheDocument();
});

it('shares an owned saved venue through the existing recommendation RPC path', async () => {
  const venue = { id: 'owned-id', name: 'Fixture cafe', address: '1 Test St', type: 'food', tags: [], link: null,
    personal_note: 'private note', visited: false } as unknown as SavedVenue;
  const url = 'https://staging.example.test/venue/shared-id';
  share.publish.mockResolvedValue(url);
  share.send.mockResolvedValue('shared');
  render(<VenueDetails venue={venue} owned onClose={vi.fn()} onEdit={vi.fn()} onPlan={vi.fn()} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
  await waitFor(() => expect(share.send).toHaveBeenCalledWith('Fixture cafe', url));
  expect(share.publish).toHaveBeenCalledWith({ name: venue.name, address: venue.address, type: venue.type, link: null }, venue.id);
});
