import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const mocks = vi.hoisted(() => ({ saved: vi.fn(), picks: vi.fn(), confirm: vi.fn(), support: vi.fn(), premium: vi.fn(), timing: vi.fn(), discover: vi.fn(), save: vi.fn(), track: vi.fn(), publicReviews: vi.fn(), publicSave: vi.fn(), publicDelete: vi.fn(), routesBusy: false, routeSeconds: {} as Record<string, number>, modes: ['driving', 'walking'] as ('driving' | 'walking' | 'transit')[], routesUnavailable: false }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ session: { user: { id: 'qa' } }, displayName: 'QA', subscriptionTier: 'free', premiumUnlocked: true }) }));
vi.mock('../lib/supabase', () => ({ fetchSavedVenues: mocks.saved, insertSavedVenue: mocks.save, fetchCollections: async () => [],
  fetchCollectionVenueIds: async () => [], fetchSponsoredVenues: mocks.picks, recordSponsoredEvents: mocks.track,
  fetchVenueReviews: mocks.publicReviews, saveVenueReview: mocks.publicSave, deleteVenueReview: mocks.publicDelete, fetchMyCredits: async () => 3,
  fetchPlan: async () => null, fetchStops: async () => [], sortStops: (x: unknown) => x,
  hasPremium: mocks.premium, fetchPlannerSixStopSupport: mocks.support, fetchPlannerTimingSupport: mocks.timing }));
vi.mock('../lib/plannerApi', async (original) => ({ ...await original<typeof import('../lib/plannerApi')>(), confirmPlannerEvent: mocks.confirm, savePlannerEdits: vi.fn() }));
vi.mock('../lib/openai', () => ({ rankExistingVenues: async () => [] }));
vi.mock('../lib/apiKeys', () => ({ geocodeAddress: async () => ({ lat: -33.8, lon: 151.2 }) }));
vi.mock('../lib/discovery', () => ({ discoverVenues: mocks.discover }));
vi.mock('../lib/useTravel', () => ({ useTravelModes: () => mocks.modes, useDiscoveryTravel: (_owner: string, _origin: unknown, venues: import('../lib/planner').PlannerVenue[]) => ({ busy: mocks.routesBusy, seconds: mocks.routesUnavailable ? {} : Object.fromEntries(venues.map((v, i) => [venueKey(v), mocks.routeSeconds[v.id] ?? (i === 6 ? 2400 : 600)])), coords: {} }), useItineraryTravel: () => ({ busy: false, legs: [480, 720, 300, 180, 400] }) }));
import { emptyDraft, persistPlannerDraft, plannerReducer, venueKey, type PlannerVenue } from '../lib/planner';
import { UnifiedPlanner } from './UnifiedPlanner';
const saved = Array.from({ length: 7 }, (_, i) => ({ id: `v${i}`, name: `Fixture Café ${i}`, address: `${i + 1} Test Rd`, type: 'food', link: null,
  user_id: 'qa', lat: -33.8, lon: 151.2, tags: [], visited: false, personal_note: null, rating: null, collection: null, created_at: '' }));
const done = vi.fn();
beforeEach(() => { localStorage.clear(); mocks.routesUnavailable = false; mocks.routesBusy = false; mocks.routeSeconds = {}; mocks.modes = ['driving', 'walking']; mocks.track.mockReset().mockResolvedValue(undefined); mocks.publicSave.mockReset().mockResolvedValue(undefined); mocks.publicReviews.mockReset().mockResolvedValue([]); mocks.discover.mockReset(); mocks.discover.mockResolvedValue([]); mocks.save.mockReset(); mocks.timing.mockResolvedValue(true); HTMLElement.prototype.scrollIntoView = vi.fn(); mocks.premium.mockReturnValue(true); mocks.saved.mockResolvedValue(saved); mocks.picks.mockResolvedValue([{ id: 'p1', business_name: 'Fixture partner', address: '8 Test Rd', type: 'bar', lat: null, lon: null, review_count: 2, average_rating: 4.5, can_review: true, reviewed_by_me: false, instagram_link: null, website: null }]); mocks.confirm.mockResolvedValue('new-event'); mocks.support.mockResolvedValue(true); });
const renderPlanner = () => render(<UnifiedPlanner onDone={done} onCancel={vi.fn()} onDirty={vi.fn()} />);

it('preselects a shared venue in the itinerary without saving it to the library', async () => {
  await act(async () => render(<UnifiedPlanner onDone={done} onCancel={vi.fn()} onDirty={vi.fn()} seed={[{
    id: 'shared:test', name: 'Shared Cafe', address: '1 Test St', category: 'food', link: null,
    source: 'external', entityKind: 'venue', lat: 1, lon: 2, tags: [],
  }]} />));
  expect(within(screen.getByLabelText('Selected itinerary')).getByRole('button', { name: 'Remove Shared Cafe' })).toBeInTheDocument();
  await waitFor(() => expect(mocks.saved).toHaveBeenCalled());
  expect(mocks.save).not.toHaveBeenCalled();
});
it('keeps a full draft and lets the user make room for the shared venue', async () => {
  const shared: PlannerVenue = {
    id: 'shared:test', name: 'Shared Cafe', address: '1 Test St', category: 'food', link: null,
    source: 'external', entityKind: 'venue', lat: 1, lon: 2, tags: [],
  };
  let draft = emptyDraft();
  for (let i = 0; i < 6; i++) {
    draft = plannerReducer(draft, { type: 'add', venue: { ...shared, id: String(i), name: `Existing ${i}` } });
  }
  persistPlannerDraft('qa', draft);
  await act(async () => render(<UnifiedPlanner onDone={done} onCancel={vi.fn()} onDirty={vi.fn()} seed={[shared]} />));
  expect(screen.getByRole('button', { name: 'Add shared venue' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Existing 0' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add shared venue' }));
  expect(screen.getByRole('button', { name: 'Remove Shared Cafe' })).toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
});

async function start() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Event name'), 'QA night');

  await user.type(screen.getByLabelText('Starting location'), 'Sydney');
  await user.click(screen.getByRole('button', { name: 'Apply location' }));
  await user.click(screen.getByRole('textbox', { name: 'Search venues' }));
  await screen.findByText('Fixture Café 0'); return user;
}
describe('unified planner interactions', () => {
  it('renders all four sections in one document and scrolls only on request', async () => {
    renderPlanner(); const user = await start();
    expect(screen.getByRole('button', { name: 'Public Transport' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /View itinerary/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar', { name: 'Itinerary stop count' })).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveAttribute('min', '1');
    expect(screen.getByRole('slider')).toHaveAttribute('max', '60');
    expect(screen.getByRole('slider')).toHaveAttribute('step', '1');
    for (const name of ['Discover venues & vibes', 'Your itinerary', 'Make it your event', 'Ready for a good time?']) expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next step|Continue|Review itinerary|Final review|Confirm event/ })).not.toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Go to Itinerary' }));
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(screen.getByLabelText('Event name')).toHaveValue('QA night');
  });
  it('rotates exactly three curated chips on demand and preserves selections across rotations/modes', async () => {
    renderPlanner(); const user = await start();
    await user.click(screen.getByRole('button', { name: 'AI Finds' }));
    const chips = () => within(screen.getByLabelText('Vibe suggestions')).getAllByRole('button');
    expect(chips()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'Date night' }));
    await user.click(screen.getByRole('button', { name: 'More ideas' }));
    expect(chips().map((b) => b.textContent)).toEqual(['Vietnamese eats', 'Live music', 'Something spontaneous']);
    expect(screen.getByText(/Selected: Date night/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Live music' }));
    await user.click(screen.getByRole('button', { name: 'Saved Venues' }));
    await user.click(screen.getByRole('button', { name: 'AI Finds' }));
    expect(screen.getByRole('button', { name: 'Live music' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Live music' }));
    expect(screen.getByRole('button', { name: 'Live music' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('does not replace the itinerary when shuffling suggestions', async () => {
    renderPlanner(); const user = await start();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    await user.click(screen.getByRole('button', { name: 'Random Night' }));
    await user.click(screen.getByRole('button', { name: 'Randomise My Plan' }));
    expect(screen.getByText('1/6 stops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Fixture Café 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Merge into itinerary' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Merge into itinerary' }));
    expect(screen.getByRole('button', { name: 'Remove Fixture Café 0' })).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('validates overnight details and keeps the draft when backend timing support is absent', async () => {
    mocks.timing.mockResolvedValue(false); renderPlanner(); const user = await start();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    await user.type(screen.getByLabelText(/End time/), '02:00');
    await user.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('next day');
    await user.click(screen.getByLabelText('Ends the next day'));
    await user.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not enabled');
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Event name')).toHaveValue('QA night');
  });
  it('prevents a second creation while the first request is pending', async () => {
    mocks.confirm.mockReturnValue(new Promise(() => {})); renderPlanner(); const user = await start();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    await user.dblClick(screen.getByRole('button', { name: 'Create Event' }));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });
  it('allows a free account to confirm six stops when backend support is enabled', async () => {
    mocks.premium.mockReturnValue(false);
    renderPlanner(); const user = await start();
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum travel time' }), { target: { value: '45' } });
    for (let n = 0; n < 6; n++) await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' }).find((b) => !b.hasAttribute('disabled'))!);


    await user.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ stops: expect.any(Array) }), 'QA', expect.any(Function)));
    expect(mocks.confirm.mock.calls[0][0].stops).toHaveLength(6);
  });
  it('preserves selected venues across all four modes without creating an event', async () => {
    renderPlanner(); const user = await start();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    for (const name of ['Our Picks', 'AI Finds', 'Random Night', 'Saved Venues']) await user.click(screen.getByRole('button', { name }));
    expect(screen.getByText('1/6 stops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Selected · remove' })).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it('enforces six actual stops independently from preferences', async () => {
    renderPlanner(); const user = await start();
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum travel time' }), { target: { value: '45' } });
    for (let n = 0; n < 6; n++) await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' }).find((b) => !b.hasAttribute('disabled'))!);
    expect(screen.getByText('6/6 stops')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to itinerary' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Our Picks' }));
    await user.click(screen.getByRole('button', { name: 'More Nightlife & Music stops' }));
    expect(screen.getByText('6/6 stops')).toBeInTheDocument();
    expect(screen.getByText(/1\/6 preferences/)).toBeInTheDocument();
  });
  it('waits for the single Create Event action, then navigates to the persisted event', async () => {
    renderPlanner(); const user = await start(); await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);


    expect(mocks.confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Create Event' }));
    await waitFor(() => expect(done).toHaveBeenCalledWith('new-event'));
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
  });
  it('keeps six-stop drafts without creating partial events on an old backend', async () => {
    mocks.support.mockResolvedValue(false); renderPlanner(); const user = await start();
    fireEvent.change(screen.getByRole('slider', { name: 'Maximum travel time' }), { target: { value: '45' } });
    for (let n = 0; n < 6; n++) await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' }).find((b) => !b.hasAttribute('disabled'))!);

    await user.click(screen.getByRole('button', { name: 'Create Event' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('backend still has its previous 5-stop limit');
    expect(mocks.confirm).not.toHaveBeenCalled(); expect(screen.getByText('6/6 stops')).toBeInTheDocument();
  });
  it('shares origin and all sixty integer travel limits across modes while preserving the itinerary', async () => {
    renderPlanner(); const user = await start();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    expect(screen.queryByText('Fixture Café 6')).not.toBeInTheDocument();
    for (let minutes = 1; minutes <= 60; minutes++) {
      fireEvent.change(screen.getByRole('slider'), { target: { value: String(minutes) } });
      expect(screen.getByText(`Within ${minutes} min drive`)).toBeInTheDocument();
    }
    await user.click(screen.getByRole('button', { name: 'Walk' }));
    for (const mode of ['Our Picks', 'AI Finds', 'Random Night', 'Saved Venues']) {
      await user.click(screen.getByRole('button', { name: mode }));
      expect(screen.getByLabelText('Starting location')).toHaveValue('Sydney');
      expect(screen.getByText('Within 60 min walk')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Remove Fixture Café 0' })).toBeInTheDocument();
    }
    expect(within(screen.getByRole('heading', { name: 'Make it your event' }).closest('section')!).queryByLabelText('Starting location')).not.toBeInTheDocument();
  });
  it('supports keyboard reorder on drag handles and displays separate per-leg estimates', async () => {
    renderPlanner(); const user = await start();
    for (let i = 0; i < 2; i++) await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    expect(screen.getByText('↓ 8 min drive')).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: /Reorder Fixture Café 1,/ });
    handle.focus(); await user.keyboard('{ArrowUp}');
    const itinerary = screen.getByLabelText('Selected itinerary');
    expect(within(itinerary).getAllByRole('heading').map((h) => h.textContent)).toEqual(['1. Fixture Café 1', '2. Fixture Café 0']);
    expect(screen.queryByRole('button', { name: /Move .* up/ })).not.toBeInTheDocument();
  });
  it('handles denied geolocation without clearing selected stops or requesting permission on render', async () => {
    const locate = vi.fn((_ok, fail) => fail({ code: 1 }));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: locate } });
    renderPlanner(); const user = await start(); expect(locate).not.toHaveBeenCalled();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    await user.click(screen.getByRole('button', { name: 'Use My Location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Location was not shared');
    expect(screen.getByRole('button', { name: 'Remove Fixture Café 0' })).toBeInTheDocument();
  });
  it('handles granted geolocation only after the location button is tapped', async () => {
    const locate = vi.fn((ok) => ok({ coords: { latitude: -34, longitude: 151 } }));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: locate } });
    renderPlanner(); const user = await start();
    await user.click(screen.getByRole('button', { name: 'Use My Location' }));
    expect(screen.getByLabelText('Starting location')).toHaveValue('Current location');
    expect(locate).toHaveBeenCalledTimes(1);
  });
  it('does not substitute saved venues when external discovery is unavailable', async () => {
    mocks.discover.mockRejectedValue(new Error('External discovery unavailable'));
    renderPlanner(); const user = await start();
    await user.click(screen.getByRole('button', { name: 'AI Finds' }));
    await user.click(screen.getByRole('button', { name: 'Find Places' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('External discovery unavailable');
    expect(screen.queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
  });
  it('adds an external provider result without saving it, then saves it independently', async () => {
    const external = { id: 'google:real', name: 'New provider venue', address: '9 New Street', category: 'food', source: 'external', providerId: 'real', lat: -33.8, lon: 151.2, tags: ['google-place:real'], link: null, entityKind: 'venue' };
    mocks.discover.mockResolvedValue([external]);
    mocks.save.mockResolvedValue({ ...saved[0], ...external, id: 'saved-new', type: 'food' });
    renderPlanner(); const user = await start();
    await user.click(screen.getByRole('button', { name: 'AI Finds' }));
    await user.click(screen.getByRole('button', { name: 'Find Places' }));
    await user.click(await screen.findByRole('button', { name: 'Add to itinerary' }));
    expect(mocks.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save to library' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Remove New provider venue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved to library' })).toBeDisabled();
  });

  it('requires explicit consent for a distance fallback, and clears that consent when the origin changes', async () => {
    renderPlanner(); const user = await start();
    await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
    mocks.routesUnavailable = true;
    await user.click(screen.getByRole('button', { name: 'Our Picks' }));
    await user.click(screen.getByRole('button', { name: 'Saved Venues' }));
    expect(screen.queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
    expect(screen.getByText(/Routes unavailable/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Use straight-line distance fallback (not journey time)' }));
    expect(screen.getByText(/Distance fallback active by your choice/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add to itinerary' })).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Remove Fixture Café 0' })).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Starting location'));
    expect(screen.queryByText(/Distance fallback active by your choice/)).not.toBeInTheDocument();
  });

});

it('reveals filters with location text, mounts cards only on intent, and hides empty-itinerary utilities', async () => {
  renderPlanner(); const user = userEvent.setup();
  expect(screen.queryByRole('textbox', { name: 'Search venues' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Venue category' })).not.toBeInTheDocument();
  expect(screen.queryByText(/^Drag to reorder/)).not.toBeInTheDocument();
  await user.type(screen.getByLabelText('Starting location'), 'Sydney');
  expect(screen.getByRole('textbox', { name: 'Search venues' })).toBeInTheDocument();
  expect(screen.queryByText('Fixture Café 0')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Apply location' }));
  expect(screen.queryByText('Fixture Café 0')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show venues' }));
  await screen.findByText('Fixture Café 0');
  await user.click(screen.getAllByRole('button', { name: 'Add to itinerary' })[0]);
  expect(screen.getByText(/^Drag to reorder/)).toBeInTheDocument();
  expect(screen.getByLabelText('Time for Fixture Café 0')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Remove Fixture Café 0' }));
  expect(screen.queryByText(/^Drag to reorder/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Time for Fixture Café 0')).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText('Starting location'));
  expect(screen.queryByRole('textbox', { name: 'Search venues' })).not.toBeInTheDocument();
  expect(screen.queryByText('Fixture Café 0')).not.toBeInTheDocument();
});

const externalPlaces = [
  { id: 'external-food', name: 'Verified six-minute restaurant', address: '9 Verified Street', category: 'food', source: 'external', providerId: 'food-id', lat: -33.8, lon: 151.2, tags: [], link: null, entityKind: 'venue' },
  { id: 'external-bar', name: 'Verified twelve-minute bar', address: '10 Verified Street', category: 'bar', source: 'external', providerId: 'bar-id', lat: -33.8, lon: 151.2, tags: [], link: null, entityKind: 'venue' },
];
it('excludes six- and twelve-minute AI venues under a one-minute limit in both discovery surfaces', async () => {
  mocks.discover.mockResolvedValue(externalPlaces); mocks.routeSeconds = { 'external-food': 360, 'external-bar': 720 };
  renderPlanner(); const user = await start();
  await user.click(screen.getByRole('button', { name: 'AI Finds' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
  await user.click(screen.getByRole('button', { name: 'Find Places' }));
  await waitFor(() => expect(mocks.discover).toHaveBeenCalled());
  expect(screen.queryByRole('heading', { name: externalPlaces[0].name })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Expand discovery chat' }));
  const sheet = screen.getByRole('dialog');
  expect(within(sheet).queryByRole('heading', { name: externalPlaces[0].name })).not.toBeInTheDocument();
  expect(within(sheet).queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
  expect(within(sheet).getByRole('status')).toHaveTextContent('No places match');
});
it('applies the same category filter in AI chat and fails closed while routing is pending or unavailable', async () => {
  mocks.discover.mockResolvedValue(externalPlaces);
  renderPlanner(); const user = await start();
  await user.click(screen.getByRole('button', { name: 'AI Finds' }));
  await user.click(screen.getByRole('button', { name: 'Find Places' }));
  await screen.findByRole('heading', { name: externalPlaces[0].name });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Venue category' }), 'bar');
  expect(screen.queryByRole('heading', { name: externalPlaces[0].name })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Expand discovery chat' }));
  const sheet = screen.getByRole('dialog');
  expect(within(sheet).queryByRole('heading', { name: externalPlaces[0].name })).not.toBeInTheDocument();
  await user.click(within(sheet).getByRole('button', { name: 'Add to itinerary' }));
  mocks.routesBusy = true;
  await user.type(within(sheet).getByLabelText('Your discovery preferences'), 'Chill');
  expect(within(sheet).queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
  expect(within(sheet).getByRole('status')).toHaveTextContent('Checking journey');
  mocks.routesBusy = false; mocks.routesUnavailable = true;
  await user.type(within(sheet).getByLabelText('Your discovery preferences'), ' night');
  expect(within(sheet).queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
  mocks.routesUnavailable = false; mocks.modes = [];
  await user.type(within(sheet).getByLabelText('Your discovery preferences'), '!');
  expect(within(sheet).queryByRole('heading', { name: externalPlaces[1].name })).not.toBeInTheDocument();
  await user.click(within(sheet).getByRole('button', { name: /^Close$/ }));
  expect(screen.getByRole('button', { name: 'Remove ' + externalPlaces[1].name })).toBeInTheDocument();
});
it('discards an in-flight AI response when its starting location changes', async () => {
  let resolve!: (places: typeof externalPlaces) => void;
  mocks.discover.mockReturnValue(new Promise(r => { resolve = r; }));
  renderPlanner(); const user = await start();
  await user.click(screen.getByRole('button', { name: 'AI Finds' }));
  await user.click(screen.getByRole('button', { name: 'Find Places' }));
  await waitFor(() => expect(mocks.discover).toHaveBeenCalled());
  await user.clear(screen.getByLabelText('Starting location'));
  await user.type(screen.getByLabelText('Starting location'), 'Melbourne');
  await user.click(screen.getByRole('button', { name: 'Apply location' }));
  await act(async () => { resolve(externalPlaces); });
  await user.click(screen.getByRole('button', { name: 'Expand discovery chat' }));
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
});
it('invalidates completed AI results after a new origin is applied and supports searching without a separate Apply action', async () => {
  mocks.discover.mockResolvedValue(externalPlaces);
  renderPlanner(); const user = userEvent.setup();
  await user.type(screen.getByLabelText('Starting location'), 'Sydney');
  await user.click(screen.getByRole('button', { name: 'AI Finds' }));
  await user.click(screen.getByRole('button', { name: 'Find Places' }));
  await screen.findByRole('heading', { name: externalPlaces[0].name });
  await user.clear(screen.getByLabelText('Starting location'));
  await user.type(screen.getByLabelText('Starting location'), 'Melbourne');
  await user.click(screen.getByRole('button', { name: 'Apply location' }));
  expect(screen.queryByRole('heading', { name: externalPlaces[0].name })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Expand discovery chat' }));
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Add to itinerary' })).not.toBeInTheDocument();
});
it('restores public partner reviews and deduplicates visible impressions across rerenders and mode switches', async () => {
  renderPlanner(); const user = await start();
  expect(mocks.track).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Our Picks' }));
  expect(mocks.track).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Show venues' }));
  expect(screen.getByText('4.5')).toBeInTheDocument();
  expect(screen.getByText('(2 reviews)')).toBeInTheDocument();
  await waitFor(() => expect(mocks.track).toHaveBeenCalledWith(['p1'], 'impression'));
  await user.click(screen.getByRole('button', { name: 'Fixture partner: reviews' }));
  const dialog = await screen.findByRole('dialog', { name: 'Fixture partner' });
  await user.click(within(dialog).getByRole('button', { name: 'Write a review · earn 1 credit' }));
  await user.click(within(dialog).getByRole('radio', { name: '5 stars' }));
  await user.type(within(dialog).getByLabelText('Your review'), 'A useful public partner review.');
  await user.click(within(dialog).getByRole('button', { name: 'Post review · +1 credit' }));
  await waitFor(() => expect(mocks.publicSave).toHaveBeenCalledWith('p1', 5, 'A useful public partner review.', undefined));
  expect(mocks.save).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: /^Close$/ }));
  await user.click(screen.getByRole('button', { name: 'Saved Venues' }));
  await user.click(screen.getByRole('button', { name: 'Our Picks' }));
  expect(mocks.track.mock.calls.filter(c => c[1] === 'impression')).toHaveLength(1);
});
it('attributes a partner save once only after successful confirmation, not selection or a failed attempt', async () => {
  renderPlanner(); const user = await start();
  await user.click(screen.getByRole('button', { name: 'Our Picks' }));
  await user.click(screen.getByRole('button', { name: 'Show venues' }));
  await user.click(screen.getByRole('button', { name: 'Add to itinerary' }));
  expect(mocks.track.mock.calls.filter(c => c[1] === 'saved')).toHaveLength(0);
  mocks.confirm.mockRejectedValueOnce(new Error('offline'));
  await user.click(screen.getByRole('button', { name: 'Create Event' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  expect(mocks.track.mock.calls.filter(c => c[1] === 'saved')).toHaveLength(0);
  await user.dblClick(screen.getByRole('button', { name: 'Create Event' }));
  await waitFor(() => expect(mocks.track.mock.calls.filter(c => c[1] === 'saved')).toEqual([[['p1'], 'saved', 'new-event']]));
});
it('does not count an impression for a partner excluded by the journey limit', async () => {
  renderPlanner(); const user = await start();
  await user.click(screen.getByRole('button', { name: 'Our Picks' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
  await user.click(screen.getByRole('button', { name: 'Show venues' }));
  expect(screen.queryByRole('button', { name: 'Fixture partner: reviews' })).not.toBeInTheDocument();
  expect(mocks.track).not.toHaveBeenCalled();
});
