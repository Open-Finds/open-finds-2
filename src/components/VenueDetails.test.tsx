import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SavedVenue } from '../lib/supabase';
const update = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({ fetchCollections: vi.fn(), copyVenueToLibrary: vi.fn(), createCollection: vi.fn() }));
vi.mock('../lib/supabase', () => ({ updateSavedVenue: update, ...api }));
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

const someoneElses = { id: 'p', name: 'Hercules Cafe', address: '1 Test St, Ashfield NSW 2131', type: 'food', tags: [], visited: false, link: null } as unknown as SavedVenue;

it('asks a signed-out visitor to log in before saving or planning', async () => {
  const onLoginRequired = vi.fn(); const onPlan = vi.fn();
  render(<VenueDetails venue={someoneElses} owned={false} signedIn={false} onLoginRequired={onLoginRequired} onClose={vi.fn()} onEdit={vi.fn()} onPlan={onPlan} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Log in' }));
  expect(onLoginRequired.mock.calls).toEqual([['save'], ['plan'], [null]]);
  expect(onPlan).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Mark visited' })).not.toBeInTheDocument();
});

it('saves someone else’s venue into a chosen collection', async () => {
  api.fetchCollections.mockResolvedValue([{ id: 'c1', name: 'Sydney cafés' }]);
  api.copyVenueToLibrary.mockResolvedValue({ venue: { ...someoneElses, id: 'mine' }, existed: false });
  const onCopied = vi.fn();
  render(<VenueDetails venue={someoneElses} owned={false} onCopied={onCopied} onClose={vi.fn()} onEdit={vi.fn()} onPlan={vi.fn()} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await userEvent.click(await screen.findByRole('radio', { name: 'Sydney cafés' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save venue' }));
  await waitFor(() => expect(onCopied).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine' })));
  expect(api.copyVenueToLibrary).toHaveBeenCalledWith(someoneElses, 'c1');
  expect(await screen.findByText('Saved to your venues.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
});

it('remembers a signed-out action until it is used', async () => {
  const { rememberVenueAction, pendingVenueAction, clearVenueAction } = await import('../lib/pendingVenue');
  rememberVenueAction('p', 'save');
  expect(pendingVenueAction()).toEqual({ id: 'p', action: 'save' });
  clearVenueAction();
  expect(pendingVenueAction()).toBeNull();
});
