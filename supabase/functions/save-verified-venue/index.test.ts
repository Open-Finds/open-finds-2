import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn(), env: {} as Record<string, string> }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));

let handler: (req: Request) => Promise<Response>;
let sign: typeof import('../_shared/venueToken').signVenueToken;
const request = (body: unknown, method = 'POST') => handler(new Request('http://localhost/save-verified-venue', {
  method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
}));
const place = {
  google_place_id: 'ChIJtestplace01', name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000, Australia',
  suburb: 'Sydney', lat: -33.8, lon: 151.2, category: null,
};
const row = { id: 'saved-1', name: 'Test Cafe', venue_id: 'venue-1' };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.env = { SUPABASE_SERVICE_ROLE_KEY: 'service-secret' };
  vi.stubGlobal('Deno', { env: { get: (key: string) => mocks.env[key] ?? '' }, serve: (fn: typeof handler) => { handler = fn; } });
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'user-1' } });
  mocks.limit.mockResolvedValue({ available: true, allowed: true, remaining: 5, retryAfter: 0 });
  mocks.rpc.mockResolvedValue({ data: row, error: null });
  await import('./index');
  ({ signVenueToken: sign } = await import('../_shared/venueToken'));
});

describe('save-verified-venue', () => {
  it('saves Google\'s details for the signed-in person, scoped to their id', async () => {
    const venueToken = await sign(place, 'user-1');
    const response = await request({
      venueToken, name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000', type: 'food', link: 'https://www.instagram.com/reel/x', category: 'cafe',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(row);
    expect(mocks.rpc).toHaveBeenCalledWith('save_verified_venue', {
      p_user: 'user-1',
      // Google gave no category, so the saver's choice sets it.
      p_place: { ...place, category: 'cafe' },
      p_save: { name: 'Test Cafe', address: '1 Test St, Sydney NSW 2000', type: 'food', link: 'https://www.instagram.com/reel/x' },
    });
  });

  it('keeps Google\'s category over the saver\'s', async () => {
    const venueToken = await sign({ ...place, category: 'bar' }, 'user-1');
    await request({ venueToken, category: 'cafe' });
    expect(mocks.rpc.mock.calls[0][1].p_place.category).toBe('bar');
  });

  it('requires a signed-in user', async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'Authentication required' });
    expect((await request({ venueToken: await sign(place, 'user-1') })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses a stamp issued to someone else, or none at all', async () => {
    expect((await request({ venueToken: await sign(place, 'user-2') })).status).toBe(400);
    expect((await request({})).status).toBe(400);
    expect((await request({ venueToken: 'forged.token' })).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('applies the rate limit, and fails closed when it cannot check it', async () => {
    const venueToken = await sign(place, 'user-1');
    mocks.limit.mockResolvedValueOnce({ available: true, allowed: false, remaining: 0, retryAfter: 30 });
    expect((await request({ venueToken })).status).toBe(429);
    mocks.limit.mockResolvedValueOnce({ available: false, allowed: false, remaining: 0, retryAfter: 60 });
    expect((await request({ venueToken })).status).toBe(503);
    expect(mocks.limit).toHaveBeenCalledWith('save-verified-venue', 'user-1', 120, 3600, { failClosed: true });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('drops unsafe save details', async () => {
    await request({ venueToken: await sign(place, 'user-1'), type: 'nonsense', link: 'http://insecure', name: ' ', address: 42 });
    expect(mocks.rpc.mock.calls[0][1].p_save).toEqual({ name: null, address: null, type: null, link: null });
  });

  it('reports a failed save without detail', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'Invalid venue details' } });
    const response = await request({ venueToken: await sign(place, 'user-1') });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not save this venue' });
  });

  it('only accepts POST', async () => {
    expect((await request(undefined, 'GET')).status).toBe(405);
  });
});
