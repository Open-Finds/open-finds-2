import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AddToCollection } from './AddToCollection';

const mocks = vi.hoisted(() => ({ fetchCollections: vi.fn(), addVenueToCollection: vi.fn(), createCollection: vi.fn() }));
vi.mock('../lib/supabase', () => mocks);

beforeEach(() => vi.clearAllMocks());

it('lists my collections and adds the venue to the one I pick', async () => {
  mocks.fetchCollections.mockResolvedValue([{ id: 'c1', name: 'Date nights' }, { id: 'c2', name: 'Brunch' }]);
  mocks.addVenueToCollection.mockResolvedValue(undefined);
  render(<AddToCollection venueId="v1" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to collection' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Brunch' })));
  expect(mocks.addVenueToCollection.mock.calls).toEqual([['c2', 'v1']]);
  expect(screen.getByRole('status')).toHaveTextContent('Added to Brunch.');
});

it('creates a new collection and adds the venue to it', async () => {
  mocks.fetchCollections.mockResolvedValue([]);
  mocks.createCollection.mockResolvedValue({ id: 'c9', name: 'Trips' });
  mocks.addVenueToCollection.mockResolvedValue(undefined);
  render(<AddToCollection venueId="v1" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to collection' })));
  fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Trips' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Create' })));
  expect(mocks.createCollection.mock.calls).toEqual([['Trips']]);
  expect(mocks.addVenueToCollection.mock.calls).toEqual([['c9', 'v1']]);
});

it('says so when the venue cannot be added', async () => {
  mocks.fetchCollections.mockResolvedValue([{ id: 'c1', name: 'Brunch' }]);
  mocks.addVenueToCollection.mockRejectedValue(new Error('offline'));
  render(<AddToCollection venueId="v1" />);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add to collection' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Brunch' })));
  expect(screen.getByRole('alert')).toHaveTextContent('Could not add it');
});
