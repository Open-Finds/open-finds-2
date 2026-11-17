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

  it.each([
    ['unavailable', 'temporarily unavailable'],
    ['limit', 'reached its limit'],
    ['busy', 'busy with another request'],
    ['auth', 'sign in again'],
  ] as const)('words a %s provider problem as a service problem and keeps manual saving open', async (reason, text) => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: true, reason } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent(/could not verify|could not match|could not identify/i);
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
    expect(screen.getByLabelText('Address')).toHaveValue(venue.address);
  });

  it('words a provider problem during identification as a service problem, not a missing venue', async () => {
    await start({ candidates: [], issue: { stage: 'identify', retryable: true, reason: 'limit' } });
    expect(screen.getByRole('alert')).toHaveTextContent('reached its limit');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/could not identify/i);
    expect(screen.getByRole('button', { name: 'Retry identification' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeDisabled();
  });

  it('offers no retry for an exact request the backend already saw, but still allows editing and saving', async () => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: false, reason: 'duplicate' } });
    expect(screen.getByRole('alert')).toHaveTextContent('already checked');
    expect(screen.queryByRole('button', { name: /^Retry/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
  });

  it('says nothing was checked yet when the details need review, and lets the user verify or save', async () => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: false, reason: 'needs_review' } });
    expect(screen.getByRole('alert')).toHaveTextContent('could not confirm it automatically');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/could not match/i);
    expect(screen.getByRole('button', { name: 'Verify details' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
  });

  it('says Google Places found no exact match only after it was actually asked', async () => {
    await start({ candidates: [candidate], issue: { stage: 'verify', retryable: false, reason: 'no_match' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Google Places could not confirm this exact venue');
    expect(screen.getByRole('button', { name: 'Verify details' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
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

describe('Google place choices', () => {
  beforeEach(() => vi.resetAllMocks());
  const chosen = { ...venue, name: 'Sculpture by the Sea', address: 'Marine Dr, Bondi Beach NSW 2026, Australia', lat: -33.89, lon: 151.27, order: 1, tags: [] };

  it('saves a chosen Google place with its coordinates, and drops them once the text is edited by hand', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ candidates: [chosen], issue: { stage: 'verify', retryable: false, reason: 'no_match' } });
    expect(screen.getByRole('alert')).toHaveTextContent('could not confirm this exact venue');
    fireEvent.click(screen.getByRole('button', { name: /Sculpture by the Sea/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save this place' })));
    expect(mocks.saveSharedVenue).toHaveBeenLastCalledWith(
      expect.objectContaining({ name: 'Sculpture by the Sea', lat: -33.89, lon: 151.27 }), link,
    );
  });

  it('never keeps coordinates after the venue text is changed', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ candidates: [chosen], issue: { stage: 'verify', retryable: false, reason: 'no_match' } });
    fireEvent.click(screen.getByRole('button', { name: /Sculpture by the Sea/ }));
    fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'Sculpture by the Sea (edited)' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Sculpture by the Sea (edited)', lat: null, lon: null });
  });
});
