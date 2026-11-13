import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSaveDialog } from './AiSaveDialog';
import type { SharedVenueResult } from '../lib/aiSave';

const mocks = vi.hoisted(() => ({
  identifySharedVenue: vi.fn(), publishVenue: vi.fn(), saveSharedVenue: vi.fn(), sendRecommendation: vi.fn(),
  shareRecommendationOrigin: () => 'https://www.theunsaved.app',
}));
vi.mock('../lib/aiSave', () => mocks);
vi.mock('../lib/supabase', () => ({ updateSavedVenue: vi.fn() }));
vi.mock('../lib/openai', () => ({ UserFacingError: Error }));

const link = 'https://www.instagram.com/reel/test/';
const venue = { name: 'Test cafe', address: '1 Test St', type: 'food' as const, link, lat: 1, lon: 2 };
const saved = { ...venue, id: 'saved' };
const candidate = { ...venue, order: 1, tags: [] };

async function start(result: SharedVenueResult = { venue, candidates: [candidate] }) {
  mocks.identifySharedVenue.mockResolvedValueOnce(result);
  const onClose = vi.fn();
  const onPlan = vi.fn();
  await act(async () => render(<AiSaveDialog link={link} onClose={onClose} onPlan={onPlan} />));
  return { onClose, onPlan };
}

describe('Shared venue actions', () => {
  beforeEach(() => vi.resetAllMocks());

  it('lets the user close after verification without writing', async () => {
    const flow = await start();
    expect(screen.getByRole('button', { name: 'Save Venue' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(flow.onClose).toHaveBeenCalledOnce();
    expect(flow.onPlan).not.toHaveBeenCalled();
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
    expect(mocks.publishVenue).not.toHaveBeenCalled();
  });

  it('saves explicitly and retries a failed write with the same verified venue', async () => {
    mocks.saveSharedVenue.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(saved);
    await start();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Venue' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Venue' })));
    expect(screen.getByRole('button', { name: 'Saved to My Venues' })).toBeDisabled();
    expect(mocks.saveSharedVenue.mock.calls).toEqual([[venue, link], [venue, link]]);
    expect(mocks.identifySharedVenue).toHaveBeenCalledOnce();
    expect(mocks.publishVenue).not.toHaveBeenCalled();
  });

  it('publishes without saving and reuses the URL after a cancelled share', async () => {
    const url = 'https://www.theunsaved.app/v/id';
    mocks.publishVenue.mockResolvedValue(url);
    mocks.sendRecommendation.mockResolvedValue('cancelled');
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(mocks.publishVenue).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share recommendation' })));
    }
    expect(mocks.publishVenue).toHaveBeenCalledOnce();
    expect(mocks.publishVenue).toHaveBeenCalledWith(venue);
    expect(mocks.sendRecommendation).toHaveBeenLastCalledWith(expect.any(String), url);
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  });

  it('passes the verified venue to planning without publishing or saving', async () => {
    const flow = await start();
    fireEvent.click(screen.getByRole('button', { name: 'Create Plan' }));
    expect(flow.onPlan).toHaveBeenCalledOnce();
    expect(flow.onPlan).toHaveBeenCalledWith(venue);
    expect(mocks.publishVenue).not.toHaveBeenCalled();
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  });

  it('retains the verification retry and allows manual correction', async () => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: true } });
    expect(screen.getByLabelText('Venue name')).toHaveValue(venue.name);
    expect(screen.queryByRole('button', { name: 'Quick Share' })).not.toBeInTheDocument();
    mocks.identifySharedVenue.mockResolvedValueOnce({ venue, candidates: [candidate] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry verification' })));
    expect(mocks.identifySharedVenue.mock.calls[0][1]).toBe(mocks.identifySharedVenue.mock.calls[1][1]);
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeEnabled();
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  });
});
