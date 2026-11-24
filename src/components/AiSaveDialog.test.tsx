import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiSaveDialog } from './AiSaveDialog';
import type { SharedVenueResult } from '../lib/aiSave';

const mocks = vi.hoisted(() => ({
  identifySharedVenue: vi.fn(), publishVenue: vi.fn(), saveSharedVenue: vi.fn(), sendRecommendationLink: vi.fn(), sendRecommendationMessage: vi.fn(),
  shareRecommendationOrigin: () => 'https://www.theunsaved.app',
}));
vi.mock('../lib/aiSave', () => mocks);
const store = vi.hoisted(() => ({ readProgress: vi.fn(), writeProgress: vi.fn() }));
vi.mock('../lib/progressStore', () => store);
const places = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock('../lib/apiKeys', async importOriginal => ({ ...(await importOriginal<typeof import('../lib/apiKeys')>()), searchGooglePlaces: places.search }));
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
    mocks.sendRecommendationLink.mockResolvedValue('cancelled');
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(mocks.publishVenue).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i++) {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send link' })));
    }
    expect(mocks.publishVenue).toHaveBeenCalledOnce();
    expect(mocks.publishVenue).toHaveBeenCalledWith(venue, undefined, { unverified: false });
    expect(mocks.sendRecommendationLink).toHaveBeenLastCalledWith(url, 'Test cafe');
    expect(mocks.sendRecommendationMessage).not.toHaveBeenCalled();
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

  it('selects a choice when any part of its card is tapped, not only the circle', async () => {
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByText('1 Lawson St, Redfern NSW 2016'));
    expect(screen.getByRole('radio', { name: /Kiddo Coffee Redfern/ })).toBeChecked();
    fireEvent.click(screen.getByText('84-86 Mary St, Surry Hills NSW 2010'));
    expect(screen.getByRole('radio', { name: /Kiddo Coffee\s*84-86 Mary St/ })).toBeChecked();
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

  it('None of these match opens an empty details form, with only a search box that says what to type', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByRole('button', { name: 'None of these match' }));
    // Nothing from the rejected results (or the creator's handle) is left in the boxes.
    expect(screen.getByLabelText('Venue name')).toHaveValue('');
    expect(screen.getByLabelText('Address')).toHaveValue('');
    const search = screen.getByLabelText(/search Google Places/);
    expect(search).toHaveValue('');
    expect(search).toHaveAttribute('placeholder', 'Enter venue name…');
    expect(screen.queryByRole('group', { name: 'Places found' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save without verification' })).toBeDisabled();
    // Typing the details by hand still saves, without coordinates.
    fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'My place' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 Made Up St, Sydney NSW 2000' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'My place', lat: null, lon: null });
  });

  it('after None of these match, the only suggestion is what the user searches for', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    places.search.mockResolvedValue([{ name: 'Certified Pizza St Marys', address: '5 Crana St, St Marys NSW 2760', type: 'food', lat: -33.77, lon: 150.77 }]);
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByRole('button', { name: 'None of these match' }));
    fireEvent.change(screen.getByLabelText(/search Google Places/), { target: { value: 'Certified pizza st marys' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Search' })));
    expect(places.search.mock.calls[0][0]).toBe('Certified pizza st marys');
    const found = screen.getByRole('group', { name: 'Places found' });
    expect(found).toHaveTextContent('Certified Pizza St Marys');
    expect(found).not.toHaveTextContent('Kiddo Coffee');
    // Boxes stay empty until the user picks one.
    expect(screen.getByLabelText('Venue name')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /Certified Pizza St Marys/ }));
    expect(screen.getByLabelText('Venue name')).toHaveValue('Certified Pizza St Marys');
    expect(screen.getByLabelText('Address')).toHaveValue('5 Crana St, St Marys NSW 2760');
  });

  it('never keeps coordinates after the venue text is changed by hand', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    places.search.mockResolvedValue([{ name: 'Kiddo Coffee Redfern', address: '1 Lawson St, Redfern NSW 2016', type: 'food', lat: -33.89, lon: 151.2 }]);
    await start({ candidates: choices, choices, issue: noMatch });
    fireEvent.click(screen.getByRole('button', { name: 'None of these match' }));
    fireEvent.change(screen.getByLabelText(/search Google Places/), { target: { value: 'Kiddo Coffee Redfern' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Search' })));
    fireEvent.click(screen.getByRole('button', { name: /Kiddo Coffee Redfern/ }));
    fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'Kiddo Coffee (edited)' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Kiddo Coffee (edited)', lat: null, lon: null });
  });

  it('says the caption could not be read, and offers a retry, instead of guessing', async () => {
    const message = "We couldn't read this post's caption. TikTok and Instagram sometimes block us, so try again, or search for the venue below.";
    await start({ candidates: [], issue: { stage: 'identify', retryable: true, cause: new Error(message) } });
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't read this post's caption");
    expect(screen.getByRole('button', { name: 'Retry identification' })).toBeInTheDocument();
    expect(screen.getByLabelText(/search Google Places/)).toBeInTheDocument();
  });

  it('passes the caption that came with the share on to AI Save', async () => {
    const shared = 'Ocean Royale at Club Auburn https://vt.tiktok.com/ZSsFTaXA9/';
    mocks.identifySharedVenue.mockResolvedValueOnce({ venue, candidates: [candidate] });
    await act(async () => render(<AiSaveDialog link={link} sharedText={shared} onClose={vi.fn()} onPlan={vi.fn()} />));
    expect(mocks.identifySharedVenue.mock.calls[0][1]).toMatchObject({ identification: { sharedText: shared } });
  });

  it('reads the venue again from a caption the user pastes', async () => {
    await start({ candidates: [], issue: { stage: 'identify', retryable: true, cause: new Error('no caption') } });
    const box = screen.getByLabelText('Paste the caption');
    expect(screen.getByRole('button', { name: 'Read caption' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '\u{1F4CD} Ocean Royale at Club Auburn\n12-14 Northumberland Road, Auburn NSW 2144' } });
    mocks.identifySharedVenue.mockResolvedValueOnce({ venue, candidates: [candidate] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Read caption' })));
    expect(mocks.identifySharedVenue).toHaveBeenCalledTimes(2);
    expect(mocks.identifySharedVenue.mock.calls[1][1].identification.sharedText).toContain('Ocean Royale at Club Auburn');
    // Once a venue is found the box goes away.
    expect(screen.queryByLabelText('Paste the caption')).not.toBeInTheDocument();
  });

  it('offers the paste box only for TikTok and Instagram posts', async () => {
    mocks.identifySharedVenue.mockResolvedValueOnce({ candidates: [], issue: { stage: 'identify', retryable: true } });
    await act(async () => render(<AiSaveDialog link="https://test.example/cafes" onClose={vi.fn()} onPlan={vi.fn()} />));
    expect(screen.queryByLabelText('Paste the caption')).not.toBeInTheDocument();
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

  it('warns when the venue Google confirmed is not named in the post', async () => {
    await start({ venue: { ...venue, name: 'Oyama Ramen', mentioned: false }, candidates: [candidate] });
    expect(screen.getByText("Not mentioned in the post. Check it's the right place before saving.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Venue' })).toBeEnabled();
  });

  it('shows no warning for a Google-verified venue', async () => {
    await start();
    expect(screen.queryByText(/might not be accurate|area only/)).not.toBeInTheDocument();
  });

  it('flags an unverified venue on the shared page, not in the chat message', async () => {
    mocks.saveSharedVenue.mockResolvedValue({ ...saved, lat: null, lon: null });
    mocks.publishVenue.mockResolvedValue('https://www.theunsaved.app/v/id?u=1');
    mocks.sendRecommendationLink.mockResolvedValue('shared');
    await start(review);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(screen.getAllByText(/Address not verified/).length).toBeGreaterThan(0);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send link' })));
    expect(mocks.publishVenue.mock.calls[0][2]).toEqual({ unverified: true });
    expect(mocks.sendRecommendationMessage).not.toHaveBeenCalled();
    expect(mocks.sendRecommendationLink).toHaveBeenCalledWith('https://www.theunsaved.app/v/id?u=1', expect.any(String));
  });

  it('sends the message first on its own, then the link alone, with the chips filled in', async () => {
    mocks.publishVenue.mockResolvedValue('https://www.theunsaved.app/v/id');
    mocks.sendRecommendationMessage.mockResolvedValue('shared');
    mocks.sendRecommendationLink.mockResolvedValue('shared');
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Write a message' }), { target: { value: 'Down?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Venue name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Address' }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '1. Send message' })));
    expect(mocks.sendRecommendationMessage).toHaveBeenCalledWith('Down? Test cafe 1 Test St');
    expect(mocks.sendRecommendationLink).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '2. Send link' })));
    expect(mocks.sendRecommendationLink).toHaveBeenCalledWith('https://www.theunsaved.app/v/id', 'Test cafe');
  });

  it('shows a plus on the venue name and address buttons, and a minus once added to take it out again', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    const box = screen.getByRole('textbox', { name: 'Write a message' });
    const name = () => screen.getByRole('button', { name: 'Venue name' });
    const address = () => screen.getByRole('button', { name: 'Address' });
    expect(name()).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(box, { target: { value: 'Down?' } });
    fireEvent.click(name());
    fireEvent.click(address());
    expect(box).toHaveValue('Down? [venue name] [address]');
    expect(name()).toHaveAttribute('aria-pressed', 'true');
    expect(address()).toHaveAttribute('aria-pressed', 'true');
    // The second tap (now a minus) removes only that one.
    fireEvent.click(name());
    expect(box).toHaveValue('Down? [address]');
    expect(name()).toHaveAttribute('aria-pressed', 'false');
    expect(address()).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(address());
    expect(box).toHaveValue('Down?');
  });

  it('only offers the link step when there is no message', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(screen.queryByRole('button', { name: '1. Send message' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send link' })).toBeInTheDocument();
  });

  it('lets the message be written while the venue is still being checked', async () => {
    let finish: (result: SharedVenueResult) => void = () => undefined;
    mocks.identifySharedVenue.mockReturnValueOnce(new Promise<SharedVenueResult>(resolve => { finish = resolve; }));
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} />));
    const box = screen.getByRole('textbox', { name: 'Write a message' });
    fireEvent.change(box, { target: { value: 'Can we try this?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Venue name' }));
    await act(async () => finish({ venue, candidates: [candidate] }));
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toHaveValue('Can we try this? [venue name]');
  });

  it('cycles the preset message with the shuffle button', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Quick Share' }));
    expect(screen.getByRole('button', { name: "Let's check this out! 🤩" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Shuffle message' }));
    expect(screen.getByRole('button', { name: '🤤🤤🤤' })).toBeInTheDocument();
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

  it('does not pre-tick a Google-confirmed venue the post never names, and says why', async () => {
    const guessed = { venue: { ...venue, name: 'Ame', lat: 1, lon: 2 }, verified: true, mentioned: false };
    mocks.identifySharedVenue.mockResolvedValueOnce({ rows: [alpha, guessed], candidates: [] });
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} />));
    expect(box('Alpha')).toHaveAttribute('aria-checked', 'true');
    expect(box('Ame')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText("Not mentioned in the post. Check it's the right place before saving.")).toBeInTheDocument();
    // Only the named venue says Confirmed on Google Maps.
    expect(screen.getAllByText('Confirmed on Google Maps')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Save selected (1)' })).toBeEnabled();
  });

  it('ticks a venue when any part of its card is tapped, not only the box', async () => {
    await startRows();
    expect(box('Beta')).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByText('2 Test St, Sydney NSW'));
    expect(box('Beta')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByText('Beta'));
    expect(box('Beta')).toHaveAttribute('aria-checked', 'false');
    // A venue with no address cannot be ticked from its card either.
    fireEvent.click(screen.getByText('This venue cannot be saved without an address.'));
    expect(box('Gamma')).toHaveAttribute('aria-checked', 'false');
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

describe('Picking up where it stopped, and keeping tags', () => {
  beforeEach(() => vi.resetAllMocks());
  const needsReview = { stage: 'verify' as const, retryable: false, reason: 'needs_review' as const };

  it('continues from the progress kept for this link instead of starting over', async () => {
    const earlier = { candidates: [{ ...candidate, tags: ['pizza'] }], searched: true };
    store.readProgress.mockResolvedValue(earlier);
    mocks.identifySharedVenue.mockResolvedValueOnce({ venue, candidates: [candidate] });
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} />));
    expect(store.readProgress).toHaveBeenCalledWith(link);
    expect(mocks.identifySharedVenue.mock.calls[0][1]).toBe(earlier);
    expect(store.writeProgress).toHaveBeenCalledWith(link, earlier);
  });

  it('does not read kept progress when the caller already gave progress', async () => {
    mocks.identifySharedVenue.mockResolvedValueOnce({ venue, candidates: [candidate] });
    const given = { candidates: [candidate] };
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} initialProgress={given} />));
    expect(store.readProgress).not.toHaveBeenCalled();
    expect(mocks.identifySharedVenue.mock.calls[0][1]).toBe(given);
  });

  it('saves the tags AI Save read with the Google place the user confirmed', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    const places = [{ ...candidate, name: 'Real Cafe', lat: 3, lon: 4 }];
    mocks.identifySharedVenue.mockResolvedValueOnce({ candidates: places, choices: places, issue: { stage: 'verify', retryable: false, reason: 'no_match' } });
    const given = { candidates: [{ ...candidate, tags: ['pizza', 'vegan'] }] };
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} initialProgress={given} />));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Real Cafe', tags: ['pizza', 'vegan'] });
  });

  it('keeps the tags for the same venue', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    const given = { candidates: [{ ...candidate, tags: ['pizza'] }] };
    mocks.identifySharedVenue.mockResolvedValueOnce({ candidates: [{ ...candidate, lat: null, lon: null }], issue: needsReview });
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} initialProgress={given} />));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Test cafe', tags: ['pizza'] });
  });

  it('drops the tags when the venue name is typed over by hand', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    const given = { candidates: [{ ...candidate, tags: ['pizza'] }] };
    mocks.identifySharedVenue.mockResolvedValueOnce({ candidates: [{ ...candidate, lat: null, lon: null }], issue: needsReview });
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} initialProgress={given} />));
    fireEvent.change(screen.getByLabelText('Venue name'), { target: { value: 'A different place' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save without verification' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'A different place', tags: [] });
  });
});

describe('Asking Google on its own when nothing could be confirmed', () => {
  beforeEach(() => vi.resetAllMocks());
  const needsReview = { stage: 'verify' as const, retryable: false, reason: 'needs_review' as const };
  const found = [{ name: 'Real Cafe', address: '9 Real St, Sydney NSW', lat: 3, lon: 4, type: 'food' as const }];
  const render_ = async (result: SharedVenueResult, progress?: object) => {
    mocks.identifySharedVenue.mockResolvedValueOnce(result);
    await act(async () => render(<AiSaveDialog link={link} onClose={vi.fn()} onPlan={vi.fn()} initialProgress={progress} />));
  };
  const named = { candidates: [{ ...candidate, address: 'Chatswood, NSW', lat: null, lon: null }] };

  it('searches Google once by the venue name and its place, and offers the results to tap', async () => {
    places.search.mockResolvedValue(found);
    await render_({ ...named, issue: needsReview }, { candidates: named.candidates });
    expect(places.search).toHaveBeenCalledTimes(1);
    expect(places.search.mock.calls[0][0]).toBe('Test cafe, Chatswood, NSW');
    expect(screen.getByRole('button', { name: /Real Cafe/ })).toBeInTheDocument();
    // The message already on screen stays: nothing was confirmed yet.
    expect(screen.getByRole('alert')).toHaveTextContent('could not confirm it automatically');
    expect(mocks.saveSharedVenue).not.toHaveBeenCalled();
  });

  it('keeps what the AI read in the form when Google finds nothing, and says nothing extra', async () => {
    places.search.mockResolvedValue([]);
    await render_({ ...named, issue: needsReview }, { candidates: named.candidates });
    expect(places.search).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Venue name')).toHaveValue('Test cafe');
    expect(screen.queryByRole('group', { name: 'Places found' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).not.toHaveTextContent('found nothing');
  });

  it('keeps going when the automatic search fails', async () => {
    places.search.mockRejectedValue(new Error('offline'));
    await render_({ ...named, issue: needsReview }, { candidates: named.candidates });
    expect(screen.getByLabelText('Venue name')).toHaveValue('Test cafe');
    expect(screen.getByRole('alert')).toHaveTextContent('could not confirm it automatically');
  });

  it('never searches from the creator handle, when the post named no venue', async () => {
    await render_({ candidates: [], issue: { stage: 'identify', retryable: true } },
      { identification: { metadata: { handle: 'wanlineating' } } });
    expect(places.search).not.toHaveBeenCalled();
  });

  it('does not search when the service is the problem, when Google already offered places, or when a venue was confirmed', async () => {
    await render_({ ...named, issue: { stage: 'verify', retryable: true, reason: 'unavailable' } }, { candidates: named.candidates });
    expect(places.search).not.toHaveBeenCalled();
    const choices = [{ ...candidate, name: 'Real Cafe', lat: 3, lon: 4 }];
    await render_({ candidates: choices, choices, issue: { stage: 'verify', retryable: false, reason: 'no_match' } }, { candidates: named.candidates });
    expect(places.search).not.toHaveBeenCalled();
    await render_({ venue, candidates: [candidate] }, { candidates: named.candidates });
    expect(places.search).not.toHaveBeenCalled();
  });

  it('lets the user tap a found place and save it with its coordinates', async () => {
    places.search.mockResolvedValue(found);
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await render_({ ...named, issue: needsReview }, { candidates: [{ ...named.candidates[0], tags: ['pizza'] }] });
    fireEvent.click(screen.getByRole('button', { name: /Real Cafe/ }));
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save this place' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Real Cafe', address: '9 Real St, Sydney NSW', lat: 3, lon: 4, tags: ['pizza'] });
  });
});

describe('Linking saves to the shared venue', () => {
  beforeEach(() => vi.resetAllMocks());
  const google = { ...candidate, name: 'Real Cafe', address: '9 Real St, Sydney NSW 2000', lat: 3, lon: 4, venueToken: 'stamp-real' };
  const review = { candidates: [google], issue: { stage: 'verify' as const, retryable: false, reason: 'needs_review' as const } };

  it('passes the stamp of a verified venue to the save', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start({ venue: { ...venue, venueToken: 'stamp-verified' }, candidates: [candidate] });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save Venue' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ venueToken: 'stamp-verified' });
  });

  it('passes the stamp of the place chosen under Confirm the venue', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    const choices = [{ ...google, order: 1 }];
    await start({ candidates: choices, choices, issue: { stage: 'verify', retryable: false, reason: 'no_match' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Confirm & Save' })));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Real Cafe', venueToken: 'stamp-real' });
  });

  it('passes the stamp of a Google place picked in the form, but not once the address is edited', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start(review);
    fireEvent.click(screen.getByRole('button', { name: /Real Cafe/ }));
    await act(async () => fireEvent.submit(screen.getByLabelText('Address').closest('form')!));
    expect(mocks.saveSharedVenue.mock.calls[0][0]).toMatchObject({ name: 'Real Cafe', venueToken: 'stamp-real' });
  });

  it('saves an edited address without a stamp', async () => {
    mocks.saveSharedVenue.mockResolvedValue(saved);
    await start(review);
    fireEvent.click(screen.getByRole('button', { name: /Real Cafe/ }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '10 Real St, Sydney NSW 2000' } });
    await act(async () => fireEvent.submit(screen.getByLabelText('Address').closest('form')!));
    expect(mocks.saveSharedVenue.mock.calls[0][0].venueToken).toBeUndefined();
  });
});
