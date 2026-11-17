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
    ['a different branch name', place({ displayName: { text: 'Test Cafe Newtown' } })],
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

  it('never calls Google for an address that is only an area', async () => {
    expect(await (await request({ ...details, address: 'Bondi Beach NSW 2026' })).json()).toMatchObject(EMPTY);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('verifies a named outdoor place with no street number, only as an outdoor listing in the same locality', async () => {
    const park = place({ displayName: { text: 'Royal National Park' }, formattedAddress: 'Royal National Park NSW 2232, Australia', types: ['national_park'], primaryType: 'national_park' });
    const input = { verify: true, name: 'Royal National Park', address: 'Royal National Park, NSW', outdoor: true, addressFromSource: true };
    places(park);
    expect(await (await request(input)).json()).toMatchObject({ verified: true, type: 'activity', address: 'Royal National Park NSW 2232, Australia' });
    places(place({ displayName: { text: 'Royal National Park' }, formattedAddress: 'Royal National Park NSW 2232, Australia', types: ['cafe'] }));
    expect(await (await request(input)).json()).toMatchObject(EMPTY);
    places(park);
    expect(await (await request({ ...input, outdoor: false })).json()).toMatchObject(EMPTY);
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
    expect(body).toEqual(EMPTY);
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
