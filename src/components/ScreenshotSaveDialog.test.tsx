import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScreenshotSaveDialog } from './ScreenshotSaveDialog';

const mocks = vi.hoisted(() => ({ read: vi.fn(), search: vi.fn(), insert: vi.fn(), record: vi.fn() }));
vi.mock('../lib/aiSaveScreenshots', () => ({ findFromScreenshots: mocks.read, MAX_SCREENSHOTS: 6, READ: 0.6 }));
vi.mock('../lib/apiKeys', () => ({ searchGooglePlaces: mocks.search }));
vi.mock('../lib/geolocation', () => ({ quietLocation: async () => null }));
vi.mock('../lib/supabase', () => ({ insertSavedVenue: mocks.insert }));
vi.mock('../lib/aiSaveResults', () => ({ recordAiSaveResult: mocks.record, REASON_LABELS: { wrong_venue: 'Wrong venue' } }));
vi.mock('./AddToCollection', () => ({ AddToCollection: ({ venueId }: { venueId: string }) => <p>Collections for {venueId}</p> }));

const row = (name: string, address: string, verified: boolean, extra = {}) =>
  ({ venue: { name, address, type: 'food', link: '', lat: 1, lon: 2, tags: [] }, verified, ...extra });
const images = ['data:image/jpeg;base64,AAAA'];
const open = async (count = 1) => {
  const onClose = vi.fn();
  await act(async () => { render(<ScreenshotSaveDialog count={count} loadImages={async () => images} onClose={onClose} />); });
  return onClose;
};

beforeEach(() => { vi.clearAllMocks(); mocks.insert.mockImplementation(async (venue: { name: string }) => ({ id: 'saved-' + venue.name, ...venue })); });

it('reads the screenshots, ticks confirmed venues, and saves them without a link', async () => {
  mocks.read.mockResolvedValue([row('Boulangerie de Saigon', 'Low Pavement, Nottingham, UK', true)]);
  await open();
  expect(mocks.read).toHaveBeenCalledWith(images, expect.any(String), expect.any(Function));
  expect(screen.getByRole('checkbox', { name: 'Save Boulangerie de Saigon' })).toHaveAttribute('aria-checked', 'true');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save selected (1)' })));
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Boulangerie de Saigon', link: null, lat: 1, lon: 2 }));
  expect(screen.getByText('Saved to My Venues')).toBeInTheDocument();
  expect(screen.getByText('Collections for saved-Boulangerie de Saigon')).toBeInTheDocument();
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ platform: 'other', postKind: 'photo', outcome: 'confirmed', foundBy: 'ai' }));
});

it('offers a near match only on request, never ticked', async () => {
  mocks.read.mockResolvedValue([row('Banh Mi Bay', '', false, { suggestion: { name: 'Banh Mi Bay', address: 'Sydney NSW', lat: 3, lon: 4 } })]);
  await open();
  const box = screen.getByRole('checkbox', { name: 'Save Banh Mi Bay' });
  expect(box).toHaveAttribute('aria-checked', 'false');
  expect(box).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Yes, use this: Banh Mi Bay' }));
  expect(screen.getByRole('checkbox', { name: 'Save Banh Mi Bay' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByText('Sydney NSW')).toBeInTheDocument();
});

it('falls back to searching by name when nothing can be read', async () => {
  mocks.read.mockResolvedValue([]);
  mocks.search.mockResolvedValue([{ name: 'Boulangerie de Saigon', address: 'Nottingham, UK', lat: 1, lon: 2, type: 'food' }]);
  await open(8);
  expect(screen.getByRole('alert')).toHaveTextContent("couldn't read a venue");
  expect(screen.getByText('Only the first 6 screenshots are read.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search Google Maps'), { target: { value: 'boulangerie de saigon' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Search' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: /Boulangerie de Saigon/ })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save selected (1)' })));
  expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'Boulangerie de Saigon', address: 'Nottingham, UK' }));
  expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'searched', foundBy: 'manual' }));
});

it('says so (and keeps the search) when the pictures cannot be opened or read', async () => {
  await act(async () => { render(<ScreenshotSaveDialog count={2} loadImages={async () => []} onClose={vi.fn()} />); });
  expect(screen.getByRole('alert')).toHaveTextContent("couldn't open these pictures");
  expect(mocks.read).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Search Google Maps')).toBeInTheDocument();
});
