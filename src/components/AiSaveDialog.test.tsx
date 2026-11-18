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
    expect(screen.getByRole('alert')).toHaveTextContent('Google Places could not match this exact venue');
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

describe('Confirm the venue choices', () => {
  beforeEach(() => vi.resetAllMocks());
  const place = (over: Record<string, unknown> = {}) => ({ ...venue, name: 'Kiddo Coffee', address: '84-86 Mary St, Surry Hills NSW 2010', lat: -33.88, lon: 151.21, order: 1, tags: [], ...over });
  const choices = [place(), place({ name: 'Kiddo Coffee Redfern', address: '1 Lawson St, Redfern NSW 2016', lat: -33.89, lon: 151.2, order: 2 })];
  const noMatch = { stage: 'verify' as const, retryable: false, reason: 'no_match' as const };

  it('shows the venue choices instead of an error, with the best match selected', async () => {
    await start({ candidates: choices, choices, issue: noMatch });
    expect(screen.getByText('Confirm the venue')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Kiddo Coffee\s*84-86 Mary St/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Kiddo Coffee Redfern\s*1 Lawson St/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Confirm & Save' })).toBeEnabled();
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  });

  it('saves only the chosen place, with its coordinates, after an explicit Confirm & Save', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByRole('radio', { name: /Kiddo Coffee Redfern/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' })));
    expect(mocks.saveSharedVenue).toHaveBeenCalledOnce();
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Kiddo Coffee Redfern', lat: -33.89, lon: 151.2 });
    expect(screen.getByRole('button', { name: 'Quick Share' })).toBeEnabled();
  });

  it('preselects nothing when the choices are only the closest results, and says so', async () => {
    await start({ candidates: choices, choices, issue: { ...noMatch, weak: true } });
    expect(screen.getByText(/closest Google results/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm & Save' })).toBeDisabled();
  });

  it('None of these match opens the details form with the search box, and unverified saving still works without coordinates', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByRole('button', { name: 'None of these match' }));
    expect(screen.getByLabelText(/search Google Places/)).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ lat: null, lon: null });
  });

  it('never keeps coordinates after the venue text is changed by hand', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByRole('button', { name: 'None of these match' }));
    fireEvent.click(screen.getByRole('button', { name: /Kiddo Coffee Redfern/ }));
    fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'Kiddo Coffee (edited)' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Kiddo Coffee (edited)', lat: null, lon: null });
  });

  it('never shows what the AI read as a Google choice when Google found nothing', async () => {
    await start({ candidates: [], issue: { stage: 'identify', retryable: true } });
    expect(screen.getByLabelText(/search Google Places/)).toBeInTheDocument();
  });
});

describe('No Google choices', () => {
  beforeEach(() => vi.resetAllMocks());
  it('does not present the AI-read venue as a Google choice when Google found nothing', async () => {
    await start({ candidates: [{ ...candidate, lat: 5, lon: 6 }], issue: { stage: 'verify', retryable: false, reason: 'no_match' } });
    expect(screen.queryByText('Confirm the venue')).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeEnabled();
  });
});
