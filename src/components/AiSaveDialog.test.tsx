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

describe('Saving and sharing a venue Google has not confirmed', () => {
  beforeEach(() => vi.resetAllMocks());
  const unconfirmed = { ...candidate, lat: null, lon: null };
  const review = { candidates: [unconfirmed], issue: { stage: 'verify' as const, retryable: false, reason: 'needs_review' as const } };

  it('shows the saved venue with Quick Share and Create Plan after a save without verification', async () => {
    mocks.saveSharedVenue.mockResolvedValue({ ...saved, lat: null, lon: null });
    await start(review);
    expect(screen.queryByRole('button', { name: 'Quick Share' })).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(screen.getByRole('button', { name: 'Saved to My Venues' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Quick Share' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create Plan' })).toBeEnabled();
    expect(screen.getByText('AI Save might not be accurate. Check the address before you go.')).toBeInTheDocument();
  });

  it('tells the user when only the area is known, and does not call that accurate', async () => {
    mocks.saveSharedVenue.mockResolvedValue({ ...saved, address: 'Chatswood, NSW', lat: null, lon: null });
    await start({ ...review, candidates: [{ ...unconfirmed, address: 'Chatswood, NSW' }] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(screen.getByText('AI Save found the area only. Tap Edit to add the street address.')).toBeInTheDocument();
    expect(screen.queryByText(/might not be accurate/)).not.toBeInTheDocument();
  });

  it('shows no warning for a Google-verified venue', async () => {
    await start();
    expect(screen.queryByText(/might not be accurate|area only/)).not.toBeInTheDocument();
  });

  it('adds the unverified line to the message a friend gets, and not for a verified venue', async () => {
    mocks.saveSharedVenue.mockResolvedValue({ ...saved, lat: null, lon: null });
    mocks.publishVenue.mockResolvedValue('https://www.theunsaved.app/v/id');
    mocks.sendRecommendation.mockResolvedValue('shared');
    await start(review);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(screen.getAllByText('Address not verified: check it before you go.').length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share recommendation' })));
    expect(mocks.sendRecommendation.mock.calls[0][0]).toContain('Address not verified: check it before you go.');
  });

  it('sends a verified venue with the message as typed', async () => {
    mocks.publishVenue.mockResolvedValue('https://www.theunsaved.app/v/id');
    mocks.sendRecommendation.mockResolvedValue('shared');
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share recommendation' })));
    expect(mocks.sendRecommendation.mock.calls[0][0]).toBe("Let's check this out! 🤩");
  });

  it('lists only Google places under Places found, never what the AI read', async () => {
    await start({ ...review, candidates: [unconfirmed, { ...candidate, name: 'Real Cafe', lat: 3, lon: 4 }] });
    expect(screen.getByRole('button', { name: /Real Cafe/ })).toBeInTheDocument();
    const found = screen.getByRole('group', { name: 'Places found' });
    expect(found).not.toHaveTextContent('Test cafe');
  });
});

describe('A post that names several venues', () => {
  beforeEach(() => vi.resetAllMocks());
  const alpha = { venue: { ...venue, name: 'Alpha', lat: 1, lon: 2 }, verified: true };
  const beta = { venue: { ...venue, name: 'Beta', address: '2 Test St, Sydney NSW', lat: null, lon: null }, verified: false };
  const gamma = { venue: { ...venue, name: 'Gamma', address: '', lat: null, lon: null }, verified: false };
  const startRows = async (onSaved = vi.fn()) => {
    mocks.identifySharedVenue.mockResolvedValueOnce({ rows: [alpha, beta, gamma], candidates: [] });
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} onSaved={onSaved} />));
    return { onSaved };
  };
  const box = (name: string) => screen.getByRole('checkbox', { name: `Save ${name}` });

  it('lists every venue, with the ones Google confirmed ticked and the rest left to the user', async () => {
    await startRows();
    expect(screen.getByText('We found 3 venues. Tick the ones to save.')).toBeInTheDocument();
    expect(box('Alpha')).toHaveAttribute('aria-checked', 'true');
    expect(box('Beta')).toHaveAttribute('aria-checked', 'false');
    expect(box('Gamma')).toBeDisabled();
    expect(screen.getByText('Confirmed on Google Maps')).toBeInTheDocument();
    expect(screen.getByText('AI Save might not be accurate. Check the address before you go.')).toBeInTheDocument();
    expect(screen.getByText('This venue cannot be saved without an address.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save selected (1)' })).toBeEnabled();
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  });

  it('saves only the ticked venues, then offers Quick Share for each saved one and comes back to the list', async () => {
    mocks.saveSharedVenue.mockImplementation(async (details: { name: string }) => ({ ...saved, name: details.name }));
    const { onSaved } = await startRows();
    fireEvent.click(box('Beta'));
    expect(screen.getByRole('button', { name: 'Save selected (2)' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save selected (2)' })));
    expect(mocks.saveSharedVenue.mock.calls).toEqual([[alpha.venue, link], [beta.venue, link]]);
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getAllByText('Saved to My Venues')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save selected (0)' })).toBeDisabled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick Share' })[0]);
    expect(screen.getByText('Recommend this venue to a friend.')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('group', { name: 'Venues found' })).toBeInTheDocument();
  });

  it('keeps a venue that failed to save ticked, says so, and saves only that one on the next try', async () => {
    mocks.saveSharedVenue.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(saved);
    await startRows();
    fireEvent.click(box('Beta'));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save selected (2)' })));
    expect(screen.getByRole('alert')).toHaveTextContent('One venue could not be saved');
    expect(screen.getByRole('button', { name: 'Save selected (1)' })).toBeEnabled();
    mocks.saveSharedVenue.mockResolvedValueOnce(saved);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save selected (1)' })));
    expect(mocks.saveSharedVenue).toHaveBeenCalledTimes(3);
    expect(mocks.saveSharedVenue.mock.calls[2][0]).toBe(alpha.venue);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
