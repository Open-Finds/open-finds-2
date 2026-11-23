import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), key: vi.fn(), geocode: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: vi.fn() }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
vi.mock('../_shared/maps.ts', () => ({ getGoogleMapsApiKey: mocks.key, geocodeAU: mocks.geocode, logGoogleError: vi.fn() }));

let handler: (req: Request) => Promise<Response>;
const request = (body: unknown) => handler(new Request('http://localhost/resolve', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const place = (over: Record<string, unknown> = {}) => ({
  id: 'ChIJtestplace01', displayName: { text: 'Test Cafe' }, formattedAddress: '1 Test St, Sydney NSW 2000, Australia',
  location: { latitude: -33.8, longitude: 151.2 }, types: ['cafe'], primaryType: 'cafe', ...over,
});
// A fresh Response per call: a body can only be read once.
const places = (...items: unknown[]) => vi.mocked(fetch).mockImplementation(async () => Response.json({ places: items }));
const EMPTY = { name: null, address: null, lat: null, lon: null };
const mapsLink = 'https://www.google.com/maps/place/Test+Cafe/@-33.8,151.2,17z/data=!3d-33.8!4d151.2';
const details = { verify: true, name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000', addressFromSource: true };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  // No staging settings: the staging control layer is a pass-through here.
  vi.stubGlobal('Deno', { env: { get: () => '' }, serve: (fn: typeof handler) => { handler = fn; } });
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'user-1' } });
  mocks.limit.mockResolvedValue({ available: true, allowed: true, remaining: 5, retryAfter: 0 });
  mocks.key.mockResolvedValue('server-secret');
  await import('./index');
});

/**
 * The APK's contract: a verified venue is `verified: true` plus name, address
 * and coordinates. Anything that is not exactly one confirmed place is the
 * empty result (a 200 with no `verified`), never a guess.
 */
describe('resolve-place verification', () => {
  it('verifies a Maps link by its pin and returns the Google place', async () => {
    places(place());
    const response = await request({ verify: true, url: mapsLink });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000, Australia', lat: -33.8, lon: 151.2, type: 'food', verified: true,
      placeId: 'ChIJtestplace01',
    });
  });

  it('verifies a link by Google place id', async () => {
    places(place({ location: { latitude: -33.9, longitude: 151.3 } }));
    const link = 'https://www.google.com/maps/place/Test+Cafe/?query_place_id=ChIJtestplace01';
    expect(await (await request({ verify: true, url: link })).json()).toMatchObject({ verified: true, lat: -33.9 });
    places(place({ id: 'ChIJanotherplace' }));
    expect(await (await request({ verify: true, url: link })).json()).toEqual(EMPTY);
  });

  it('verifies a name and full street address, asking Google for a handful of candidates', async () => {
    places(place());
    expect(await (await request(details)).json()).toMatchObject({ verified: true, name: 'Test Cafe' });
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ textQuery: 'Test Cafe, 1 Test St, Sydney NSW 2000', pageSize: 5, regionCode: 'AU' });
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('X-Goog-FieldMask')).toContain('places.id');
  });

  it.each([
    ['a different street number', place({ formattedAddress: '2 Test St, Sydney NSW 2000, Australia' })],
    ['a different suburb', place({ formattedAddress: '1 Test St, Newtown NSW 2042, Australia' })],
    ['a different venue name', place({ displayName: { text: 'Other Cafe' } })],
    ['no address in the result', place({ formattedAddress: undefined })],
    ['no coordinates in the result', place({ location: undefined })],
  ])('does not verify when Google returns %s', async (_label, result) => {
    places(result);
    expect(await (await request(details)).json()).toMatchObject(EMPTY);
  });

  it('treats two same-named results as ambiguous unless the address came from the source', async () => {
    const sameNameElsewhere = place({ id: 'ChIJelsewhere01', formattedAddress: '99 Other Rd, Newtown NSW 2042, Australia' });
    places(place(), sameNameElsewhere);
    expect(await (await request({ ...details, addressFromSource: false })).json()).toMatchObject(EMPTY);
    expect(await (await request({ ...details, addressFromSource: true })).json()).toMatchObject({ verified: true, address: '1 Test St, Sydney NSW 2000, Australia' });
  });

  it('does not verify when two results match the same name and address', async () => {
    places(place(), place({ id: 'ChIJtwin0000001' }));
    expect(await (await request(details)).json()).toMatchObject(EMPTY);
  });

  it('verifies when only one of several results has the name', async () => {
    places(place(), place({ id: 'ChIJother00001', displayName: { text: 'Other Cafe' }, formattedAddress: '99 Other Rd, Newtown NSW 2042, Australia' }));
    expect(await (await request({ ...details, addressFromSource: false })).json()).toMatchObject({ verified: true, name: 'Test Cafe' });
  });

  it('searches Google for a suburb-only address, and verifies only one place that fits the name and the suburb', async () => {
    const chatswood = place({ displayName: { text: 'Test Cafe' }, formattedAddress: '5 Victoria Ave, Chatswood NSW 2067, Australia' });
    places(chatswood);
    const input = { ...details, address: 'Chatswood, NSW' };
    expect(await (await request(input)).json()).toMatchObject({ verified: true, address: '5 Victoria Ave, Chatswood NSW 2067, Australia' });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The same name in another suburb is not the place.
    places(place({ formattedAddress: '5 King St, Newtown NSW 2042, Australia' }));
    expect(await (await request(input)).json()).toMatchObject(EMPTY);
  });

  it('reads a state written out in full the same as Google\'s short form, in both directions', async () => {
    places(place({ displayName: { text: 'Test Cafe' }, formattedAddress: '5 Victoria Ave, Chatswood NSW 2067, Australia' }));
    const input = { ...details, address: 'Chatswood, New South Wales, Australia' };
    expect(await (await request(input)).json()).toMatchObject({ verified: true, address: '5 Victoria Ave, Chatswood NSW 2067, Australia' });
    // Another suburb, or the same suburb name in another state, is still not the place.
    places(place({ formattedAddress: '5 King St, Newtown NSW 2042, Australia' }));
    expect(await (await request(input)).json()).toMatchObject(EMPTY);
    places(place({ formattedAddress: '5 High St, Chatswood VIC 3000, Australia' }));
    expect(await (await request(input)).json()).toMatchObject(EMPTY);
    places(place({ formattedAddress: '5 High St, Chatswood NSW 2067, Australia' }));
    expect(await (await request({ ...details, address: 'Chatswood, Victoria, Australia' })).json()).toMatchObject(EMPTY);
  });

  it('does not treat a venue called Victoria Park as a state', async () => {
    places(place({ displayName: { text: 'Victoria Park Cafe' }, formattedAddress: 'Victoria Park, Zetland NSW 2017, Australia' }));
    expect(await (await request({ verify: true, name: 'Victoria Park Cafe', address: 'Victoria Park, Zetland NSW' })).json())
      .toMatchObject({ verified: true });
  });

  it('does not verify a suburb-only match when two places fit', async () => {
    places(place({ formattedAddress: '5 Victoria Ave, Chatswood NSW 2067, Australia' }),
      place({ id: 'ChIJsecond00001', formattedAddress: '88 Archer St, Chatswood NSW 2067, Australia' }));
    const body = await (await request({ ...details, address: 'Chatswood, NSW', addressFromSource: false })).json();
    expect(body).not.toHaveProperty('verified');
    expect(body.candidates).toHaveLength(2);
  });

  it('accepts the name Google adds a branch or descriptor to, when the place agrees', async () => {
    const heytea = place({ displayName: { text: 'heytea bake lab+ Chatswood Store' }, formattedAddress: '420 Victoria Ave, Chatswood NSW 2067, Australia' });
    places(heytea);
    expect(await (await request({ verify: true, name: 'heytea bake lab+', address: 'Chatswood, NSW' })).json())
      .toMatchObject({ verified: true, name: 'heytea bake lab+ Chatswood Store' });
    places(place({ displayName: { text: 'Pour' }, formattedAddress: '1 Help St, Chatswood NSW 2067, Australia' }));
    expect(await (await request({ verify: true, name: 'Pour - Matcha cafe', address: 'Chatswood, NSW' })).json())
      .toMatchObject({ verified: true, name: 'Pour' });
  });

  it('works outside Australia: accents and street words do not matter, and Australia is not forced', async () => {
    places(place({ displayName: { text: 'Trần Pizza' }, formattedAddress: '215B Nguyễn Trãi, Phường Cầu Ông Lãnh, Quận 1, Thành phố Hồ Chí Minh, Vietnam' }));
    const body = await (await request({ verify: true, name: 'Tran Pizza', address: '215B Nguyen Trai, Cau Ong Lanh, Ho Chi Minh City, Vietnam' })).json();
    expect(body).toMatchObject({ verified: true, name: 'Trần Pizza' });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).not.toHaveProperty('regionCode', 'AU');
    places(place({ displayName: { text: 'Grilldog' }, formattedAddress: '29 Ngô Đức Kế, Phường Bến Nghé, Quận 1, Hồ Chí Minh, Vietnam' }));
    expect(await (await request({ verify: true, name: 'Grilldog', address: '29 Ngo Duc Ke, Ben Nghe Ward, District 1, Ho Chi Minh City, Vietnam' })).json())
      .toMatchObject({ verified: true, name: 'Grilldog' });
    places(place({ displayName: { text: 'Bò Nướng Lá Lốt' }, formattedAddress: '120 Phạm Văn Đồng, Phường 3, Gò Vấp, Hồ Chí Minh, Vietnam' }));
    expect(await (await request({ verify: true, name: 'Bo Nuong La Lot (Pham Van Dong)', address: '120 Pham Van Dong street, Ward 3, Go Vap district, Ho Chi Minh city, Vietnam' })).json())
      .toMatchObject({ verified: true });
  });

  it('keeps a different street number overseas as a choice, never as a verified place, best address first', async () => {
    places(place({ displayName: { text: 'TEA WHITE' }, formattedAddress: '315 Elizabeth St, Melbourne VIC 3000, Australia' }),
      place({ id: 'ChIJteawhite417', displayName: { text: 'TEA WHITE' }, formattedAddress: '417 Elizabeth St, Melbourne VIC 3000, Australia' }));
    const body = await (await request({ verify: true, name: 'TEA WHITE', address: '417 Elizabeth St, Melbourne', addressFromSource: true })).json();
    expect(body).toMatchObject({ verified: true, address: '417 Elizabeth St, Melbourne VIC 3000, Australia' });
    places(place({ displayName: { text: 'TEA WHITE' }, formattedAddress: '315 Elizabeth St, Melbourne VIC 3000, Australia' }));
    const wrong = await (await request({ verify: true, name: 'TEA WHITE', address: '417 Elizabeth St, Melbourne' })).json();
    expect(wrong).not.toHaveProperty('verified');
    expect(wrong.candidates[0]).toMatchObject({ address: '315 Elizabeth St, Melbourne VIC 3000, Australia' });
  });

  it('verifies a named outdoor place with no street number in the same locality', async () => {
    const park = place({ displayName: { text: 'Royal National Park' }, formattedAddress: 'Royal National Park NSW 2232, Australia', types: ['national_park'], primaryType: 'national_park' });
    const input = { verify: true, name: 'Royal National Park', address: 'Royal National Park, NSW', outdoor: true, addressFromSource: true };
    places(park);
    expect(await (await request(input)).json()).toMatchObject({ verified: true, type: 'activity', address: 'Royal National Park NSW 2232, Australia' });
    // Another state is never the same place.
    places(place({ displayName: { text: 'Royal National Park' }, formattedAddress: 'Royal National Park VIC 3000, Australia' }));
    expect(await (await request(input)).json()).toMatchObject(EMPTY);
  });

  it('answers a missing or malformed request with 400, and refuses to guess from a non-Maps link', async () => {
    for (const bad of [{ verify: true }, { verify: true, name: 'Cafe' }, { verify: true, name: ' ', address: 'x' },
      { verify: true, name: 'a'.repeat(201), address: '1 Test St' }]) {
      expect((await request(bad)).status).toBe(400);
    }
    expect(await (await request({ verify: true, url: 'https://www.instagram.com/reel/abc/' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports a failed Google lookup as an error, not as a no-match', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('quota', { status: 429 }));
    const response = await request(details);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('quota');
  });

  it('fails closed if the per-user limit cannot be checked, but only for verification', async () => {
    mocks.limit.mockResolvedValue({ available: false, allowed: false, remaining: 0, retryAfter: 60 });
    const response = await request(details);
    expect(response.status).toBe(503);
    expect(mocks.limit).toHaveBeenCalledWith('resolve-place', 'user-1', 60, 3600, { failClosed: true });
    expect(fetch).not.toHaveBeenCalled();
    mocks.limit.mockClear();
    mocks.limit.mockResolvedValue({ available: false, allowed: true, remaining: 60, retryAfter: 0 });
    await request({ url: 'https://example.com/not-maps' });
    expect(mocks.limit).toHaveBeenCalledWith('resolve-place', 'user-1', 60, 3600, undefined);
  });

  it('answers 429 with Retry-After when the limit is reached', async () => {
    mocks.limit.mockResolvedValue({ available: true, allowed: false, remaining: 0, retryAfter: 42 });
    const response = await request(details);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
  });

  it('requires a signed-in user before doing anything', async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required' });
    expect((await request(details)).status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only returns verification diagnostics to listed staging test accounts', async () => {
    places(place({ displayName: { text: 'Other Place' } }));
    const body = await (await request({ ...details, verificationDiagnostics: true })).json();
    expect(body).toMatchObject(EMPTY);
    expect(body).not.toHaveProperty('verificationDiagnostics');
  });
});

describe('resolve-place without verification (unchanged behaviour)', () => {
  it('ignores a link that is not a Maps link', async () => {
    expect(await (await request({ url: 'https://example.com/x' })).json()).toEqual(EMPTY);
    expect(await (await request({})).status).toBe(400);
  });

  it('resolves a Maps link to its place without a verified flag', async () => {
    places(place());
    const body = await (await request({ url: mapsLink })).json();
    expect(body).toEqual({ name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000, Australia', lat: -33.8, lon: 151.2, type: 'food' });
    expect(body).not.toHaveProperty('verified');
  });
});

/** Phase 4: outdoor names with a locality, chain branches, candidates and in-app search. */
describe('resolve-place Phase 4 verification', () => {
  const park = (over: Record<string, unknown> = {}) => place({
    displayName: { text: 'Sculpture by the Sea' }, types: ['park', 'tourist_attraction'], primaryType: 'park', ...over,
  });
  const sculpture = {
    verify: true, name: 'Sculpture by the Sea, Bondi', address: 'Bondi to Tamarama coastal walk, Sydney, NSW 2026, Australia',
    outdoor: true, addressFromSource: true,
  };

  it('verifies a venue whose name carries its locality, when Google confirms the locality and state', async () => {
    places(park({ formattedAddress: 'Marine Dr, Bondi Beach NSW 2026, Australia', location: { latitude: -33.89, longitude: 151.27 } }));
    expect(await (await request(sculpture)).json()).toMatchObject({ verified: true, name: 'Sculpture by the Sea', lat: -33.89 });
  });

  it('never accepts the same name in another state', async () => {
    places(park({ formattedAddress: 'Cottesloe WA 6011, Australia', location: { latitude: -31.99, longitude: 115.45 } }));
    const body = await (await request(sculpture)).json();
    expect(body).not.toHaveProperty('verified');
    expect(body).toMatchObject({ reason: 'no_match', candidates: [{ name: 'Sculpture by the Sea', address: 'Cottesloe WA 6011, Australia' }] });
  });

  it('asks the user to choose when two plausible places match, without saying "verified"', async () => {
    places(
      place({ displayName: { text: 'Test Cafe' }, id: 'a' }),
      place({ displayName: { text: 'Test Cafe' }, id: 'b', location: { latitude: -33.7, longitude: 151.1 } }),
    );
    const body = await (await request({ ...details, addressFromSource: false })).json();
    expect(body).not.toHaveProperty('verified');
    expect(body.reason).toBe('ambiguous');
    expect(body.candidates).toHaveLength(2);
  });

  it('picks the branch with the exact street address and offers the others as candidates only when nothing matches', async () => {
    places(
      place({ displayName: { text: 'Gelato Messina' }, formattedAddress: '2/10 George St, Sydney NSW 2000, Australia' }),
      place({ displayName: { text: 'Gelato Messina' }, id: 'other', formattedAddress: '45 Oxford St, Bondi Junction NSW 2022, Australia' }),
    );
    expect(await (await request({ ...details, name: 'Gelato Messina', address: '2/10 George St, Sydney NSW 2000' })).json())
      .toMatchObject({ verified: true, address: '2/10 George St, Sydney NSW 2000, Australia' });
  });

  it('answers an in-app search with up to five Google places and makes no verification decision', async () => {
    places(park({ formattedAddress: 'Marine Dr, Bondi Beach NSW 2026, Australia' }), park({ id: 'two' }));
    const body = await (await request({ search: true, query: 'Sculpture by the Sea Bondi' })).json();
    expect(body).toEqual({ candidates: expect.any(Array) });
    expect(body.candidates).toHaveLength(2);
    expect(body).not.toHaveProperty('verified');
    const sent = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ textQuery: 'Sculpture by the Sea Bondi', pageSize: 5 });
  });

  it('refuses an empty search and fails closed when the limit cannot be checked', async () => {
    expect((await request({ search: true, query: '  ' })).status).toBe(400);
    mocks.limit.mockResolvedValue({ available: false, allowed: false, remaining: 0, retryAfter: 0 });
    expect((await request({ search: true, query: 'Cafe' })).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});

/** Phase 4 "A": choices for the Confirm the venue sheet. */
describe('resolve-place choices for the user', () => {
  const kiddo = { verify: true, name: 'Kiddo Coffee', address: '84-86 Mary Street, Surry Hills NSW 2010', addressFromSource: true };
  const branch = (text: string, address: string, id: string) => place({ id, displayName: { text }, formattedAddress: address });

  it('still verifies the exact venue and branch without asking the user', async () => {
    places(branch('Kiddo Coffee', '84-86 Mary St, Surry Hills NSW 2010, Australia', 'a'),
      branch('Kiddo Coffee Redfern', '1 Lawson St, Redfern NSW 2016, Australia', 'b'));
    expect(await (await request(kiddo)).json()).toMatchObject({ verified: true, address: '84-86 Mary St, Surry Hills NSW 2010, Australia' });
  });

  it('offers branches whose names add a suburb, best first, when the exact one is not found', async () => {
    places(branch('Kiddo Coffee Potts Point', '15A Orwell St, Potts Point NSW 2011, Australia', 'c'),
      branch('Kiddo Coffee Redfern', '1 Lawson St, Redfern NSW 2016, Australia', 'b'),
      branch('Unrelated Hardware', '5 Other Rd, Newtown NSW 2042, Australia', 'z'));
    const body = await (await request(kiddo)).json();
    expect(body).not.toHaveProperty('verified');
    expect(body).toMatchObject({ reason: 'no_match' });
    expect(body).not.toHaveProperty('weak');
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual(['Kiddo Coffee Potts Point', 'Kiddo Coffee Redfern']);
  });

  it('puts the exact name before suffixed branches in the list', async () => {
    places(branch('Kiddo Coffee Redfern', '1 Lawson St, Redfern NSW 2016, Australia', 'b'),
      branch('Kiddo Coffee', '99 Other St, Surry Hills NSW 2010, Australia', 'a'));
    const body = await (await request(kiddo)).json();
    expect(body.candidates[0].name).toBe('Kiddo Coffee');
  });

  it('offers at most three choices', async () => {
    places(...['a', 'b', 'c', 'd', 'e'].map((id) => branch('Kiddo Coffee ' + id, `${id} Some St, Sydney NSW 2000, Australia`, id)));
    expect((await (await request(kiddo)).json()).candidates).toHaveLength(3);
  });

  it('labels Google\'s closest results as weak when nothing resembles the name, and still never verifies them', async () => {
    places(branch('Totally Different Place', '1 Elsewhere St, Sydney NSW 2000, Australia', 'z'));
    const body = await (await request(kiddo)).json();
    expect(body).not.toHaveProperty('verified');
    expect(body).toMatchObject({ reason: 'no_match', weak: true });
    expect(body.candidates).toHaveLength(1);
  });
});

describe('resolve-place closest results', () => {
  const vegas = place({ id: 'vegas', displayName: { text: 'Ayce Buffet' }, formattedAddress: '3655 S Las Vegas Blvd, Las Vegas, NV 89109, USA' });
  const sydneyOther = place({ id: 'syd', displayName: { text: 'Totally Different Place' }, formattedAddress: '1 Elsewhere St, Sydney NSW 2000, Australia' });
  const askSydney = { verify: true, name: 'Seoul Garden', address: 'Sydney NSW', addressFromSource: false };

  it('does not offer a Las Vegas place for a Sydney post when Google also returned Sydney places', async () => {
    places(vegas, sydneyOther);
    const body = await (await request(askSydney)).json();
    expect(body.reason).toBe('no_match');
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual(['Totally Different Place']);
  });

  it('still offers what Google found when nothing Australian came back', async () => {
    places(vegas);
    const body = await (await request(askSydney)).json();
    expect(body.candidates).toHaveLength(1);
  });

  it('does not filter anything for a post that is not in Australia', async () => {
    places(vegas);
    const body = await (await request({ ...askSydney, name: 'Seoul Garden', address: 'Seoul, South Korea' })).json();
    expect(body.candidates).toHaveLength(1);
  });
});

/** Universal venues: each Google place carries a signed stamp so the save can link the shared venue. */
describe('resolve-place venue stamps', () => {
  let verify: typeof import('../_shared/venueToken').verifyVenueToken;
  beforeEach(async () => {
    vi.resetModules();
    const env: Record<string, string> = { SUPABASE_SERVICE_ROLE_KEY: 'service-secret' };
    vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] ?? '' }, serve: (fn: typeof handler) => { handler = fn; } });
    await import('./index');
    ({ verifyVenueToken: verify } = await import('../_shared/venueToken'));
  });
  const withParts = (over: Record<string, unknown> = {}) => place({
    addressComponents: [{ longText: 'Sydney', types: ['locality', 'political'] }], ...over,
  });

  it('stamps a verified place with Google\'s details, suburb and category for this user only', async () => {
    places(withParts());
    const body = await (await request(details)).json();
    expect(body).toMatchObject({ verified: true, placeId: 'ChIJtestplace01', venueToken: expect.any(String) });
    expect(body).not.toHaveProperty('suburb');
    expect(body).not.toHaveProperty('category');
    expect(await verify(body.venueToken, 'user-1')).toEqual({
      google_place_id: 'ChIJtestplace01', name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000, Australia',
      suburb: 'Sydney', lat: -33.8, lon: 151.2, category: 'cafe',
    });
    expect(await verify(body.venueToken, 'user-2')).toBeNull();
    expect(new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get('X-Goog-FieldMask')).toContain('places.addressComponents');
  });

  it('stamps each place offered to choose from, and each search result', async () => {
    places(withParts(), withParts({ id: 'ChIJelsewhere01', formattedAddress: '99 Other Rd, Newtown NSW 2042, Australia' }));
    const choices = await (await request({ ...details, addressFromSource: false })).json();
    expect(choices.candidates.length).toBeGreaterThan(0);
    for (const candidate of choices.candidates) {
      expect(await verify(candidate.venueToken, 'user-1')).toMatchObject({ google_place_id: candidate.placeId });
      expect(candidate).not.toHaveProperty('suburb');
    }
    places(withParts());
    const search = await (await request({ search: true, query: 'Test Cafe Sydney' })).json();
    expect(await verify(search.candidates[0].venueToken, 'user-1')).toMatchObject({ google_place_id: 'ChIJtestplace01' });
  });

  it('does not stamp a place without a Google id', async () => {
    places(withParts({ id: undefined }));
    const body = await (await request(details)).json();
    expect(body).toMatchObject({ verified: true });
    expect(body).not.toHaveProperty('venueToken');
  });
});
