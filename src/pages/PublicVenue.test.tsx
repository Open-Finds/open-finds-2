import { render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PendingVenuePlan } from './PublicVenue';

const mocks = vi.hoisted(() => ({ readGuestSave: vi.fn(), readPublicVenue: vi.fn(), saveSharedVenue: vi.fn() }));
vi.mock('../lib/aiSave', () => ({
  ...mocks,
  sourceUrl: (link: string) => link,
}));

afterEach(() => {
  window.history.replaceState(null, '', '/');
  sessionStorage.clear();
});

it('hands the direct link to the planner and consumes it without saving', async () => {
  const id = '497dfa0b-29bf-446d-a272-f8a9211d53bd';
  window.history.replaceState(null, '', '/?planVenue=' + id);
  const venue = { name: 'Cafe', address: '1 Main St', type: 'food', link: null };
  mocks.readPublicVenue.mockResolvedValueOnce(venue);
  const onPlan = vi.fn();
  render(<PendingVenuePlan onPlan={onPlan} />);
  await waitFor(() => expect(onPlan).toHaveBeenCalledWith(venue));
  expect(mocks.readPublicVenue).toHaveBeenCalledWith(id);
  expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  expect(window.location.search).toBe('');
});
