import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareToAppFlow } from './ShareToAppFlow';
import { extractVenuesFromLink } from '../lib/openai';
import { fetchSavedVenues, insertSavedVenue } from '../lib/supabase';
import { composeShareMessage, DEFAULT_SHARE_MESSAGE } from '../lib/shareMessage';

vi.mock('../lib/openai', () => ({
  extractVenuesFromLink: vi.fn(), fetchLinkThumbnail: vi.fn().mockResolvedValue(null),
  UserFacingError: class extends Error {},
}));
vi.mock('../lib/supabase', () => ({
  fetchSavedVenues: vi.fn(), insertSavedVenue: vi.fn(), updateSavedVenueCoords: vi.fn(),
}));
vi.mock('../lib/apiKeys', () => ({ geocodeAddress: vi.fn().mockResolvedValue(null) }));
vi.mock('../lib/invite', () => ({ copyToClipboard: vi.fn().mockResolvedValue(true) }));

const link = 'https://www.instagram.com/reel/ABC/';
const venue = { name: 'Good Cafe', address: '10 Main St', type: 'food' as const, tags: ['brunch'], order: 1, lat: 1, lon: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractVenuesFromLink).mockResolvedValue([venue]);
  vi.mocked(fetchSavedVenues).mockResolvedValue([]);
  vi.mocked(insertSavedVenue).mockResolvedValue({ id: 'saved' } as Awaited<ReturnType<typeof insertSavedVenue>>);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ShareToAppFlow', () => {
  it('extracts only once in StrictMode, then saves and closes', async () => {
    const onClose = vi.fn();
    render(<StrictMode><ShareToAppFlow link={link} onClose={onClose} onSaved={vi.fn()} /></StrictMode>);
    expect(await screen.findByText('Good Cafe')).toBeInTheDocument();
    expect(extractVenuesFromLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(link)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Preview original shared reel' })).toHaveAttribute('href', link);
    fireEvent.click(screen.getByRole('button', { name: 'Save to app' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(insertSavedVenue).toHaveBeenCalledWith(expect.objectContaining({ name: venue.name, address: venue.address, link }));
  });

  it('saves before Step 2 and sends the edited fields in text without a duplicate url field', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    render(<ShareToAppFlow link={link} onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText('Good Cafe');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Send' }));
    const input = await screen.findByLabelText('Event name');
    expect(insertSavedVenue).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Message')).toHaveValue(DEFAULT_SHARE_MESSAGE);
    fireEvent.change(input, { target: { value: 'Brunch together' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '22 New Road' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ text: composeShareMessage({ name: 'Brunch together', address: '22 New Road', message: DEFAULT_SHARE_MESSAGE, link }) }));
    expect(screen.queryByText(link)).not.toBeInTheDocument();
  });

  it('keeps the review open if saving fails', async () => {
    vi.mocked(insertSavedVenue).mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();
    render(<ShareToAppFlow link={link} onClose={onClose} onSaved={vi.fn()} />);
    await screen.findByText('Good Cafe');
    fireEvent.click(screen.getByRole('button', { name: 'Save & Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
    expect(screen.queryByLabelText('Event name')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without saving', async () => {
    const onClose = vi.fn();
    render(<ShareToAppFlow link={link} onClose={onClose} onSaved={vi.fn()} />);
    await screen.findByText('Good Cafe');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(insertSavedVenue).not.toHaveBeenCalled();
  });
});
