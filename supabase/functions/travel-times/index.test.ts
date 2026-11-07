import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), key: vi.fn(), geocode: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
vi.mock('../_shared/maps.ts', () => ({ getGoogleMapsApiKey: mocks.key, geocodeAU: mocks.geocode, logGoogleError: vi.fn(), mapLimit: async <T, R>(items: T[], _n: number, fn: (item: T) => Promise<R>) => Promise.all(items.map(fn)) }));
let handler: (req: Request) => Promise<Response>;
const origin = { lat: -33.8, lon: 151.2 };
const destination = { address: '1 Fixture Street', lat: -33.9, lon: 151.3 };
const request = (body: unknown) => handler(new Request('http://localhost/travel-times', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'qa' } });
  mocks.limit.mockResolvedValue({ allowed: true, available: true }); mocks.key.mockResolvedValue('test-key-never-returned');
  mocks.geocode.mockResolvedValue({ coord: origin, formattedAddress: 'Fixture', types: ['street_address'] });
  vi.stubGlobal('Deno', { env: { get: () => '' }, serve: (fn: typeof handler) => { handler = fn; } });
  await import('./index');
});
describe('routing provider boundary', () => {
  it('authenticates before provider access', async () => {
    mocks.auth.mockResolvedValue({ ok: false, error: 'Unauthorized', status: 401 });
    expect((await request({ origin, destinations: [destination] })).status).toBe(401); expect(fetch).not.toHaveBeenCalled();
  });
  it('exposes supported modes without a route request or secret', async () => {
    const response = await request({ action: 'capabilities' });
    expect(await response.json()).toEqual({ modes: ['driving', 'walking', 'transit'], provider: 'Google Maps', liveTraffic: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['driving', 'walking', 'transit'])('passes %s to the real matrix without claiming live traffic', async (mode) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ status: 'OK', rows: [{ elements: [{ status: 'OK', duration: { value: 480 } }] }] }));
    const response = await request({ origin, destinations: [destination], mode });
    expect(await response.json()).toMatchObject({ mode, liveTraffic: false, distances: [{ durationSeconds: 480, error: false }] });
    const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]));
    expect(url.searchParams.get('mode')).toBe(mode);
    expect(url.searchParams.has('departure_time')).toBe(mode === 'transit');
    expect(url.searchParams.has('traffic_model')).toBe(false);
    expect(mocks.limit).toHaveBeenCalledWith('travel-times', 'qa', 60, 3600, { failClosed: true });
  });
  it.each([{ mode: 'teleport' }, { origin: { lat: 99, lon: 151 } }, { destinations: Array(101).fill(destination) }])('rejects invalid input without upstream spend', async (patch) => {
    expect((await request({ origin, destinations: [destination], ...patch })).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('does not treat a locality geocode or unreachable route as a venue journey', async () => {
    mocks.geocode.mockResolvedValue({ coord: origin, types: ['locality'] });
    const response = await request({ origin, destinations: [{ address: 'Sydney' }] });
    expect((await response.json()).distances[0].durationSeconds).toBeNull(); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects negative provider durations and preserves missing routes', async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ status: 'OK', rows: [{ elements: [{ status: 'OK', duration: { value: -1 } }, { status: 'ZERO_RESULTS' }] }] }));
    const response = await request({ origin, destinations: [destination, destination] });
    expect((await response.json()).distances.every((r: { durationSeconds: number | null }) => r.durationSeconds === null)).toBe(true);
  });
  it('fails closed when quota enforcement is unavailable', async () => {
    mocks.limit.mockResolvedValue({ allowed: false, available: false, retryAfter: 60 });
    expect((await request({ origin, destinations: [destination] })).status).toBe(429); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects locality-only matches for an itinerary venue origin', async () => {
    mocks.geocode.mockResolvedValue({ coord: origin, types: ['locality'], status: 'OK' });
    const response = await request({ origin: 'Sydney', originIsVenue: true, destinations: [destination] });
    expect((await response.json()).originError).toBe('unavailable'); expect(fetch).not.toHaveBeenCalled();
  });

});
