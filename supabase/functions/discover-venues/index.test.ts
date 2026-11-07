import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), key: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
vi.mock('../_shared/maps.ts', () => ({ getGoogleMapsApiKey: mocks.key }));
let handler: (req: Request) => Promise<Response>;
const body = { query: 'Japanese restaurants', origin: { lat: -33.8, lon: 151.2 } };
const request = (value = body) => handler(new Request('http://localhost/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => '' }, serve: vi.fn() });
  handler = (await import('./index')).handler;
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'qa' } }); mocks.limit.mockResolvedValue({ allowed: true, available: true }); mocks.key.mockResolvedValue('server-secret');
});
describe('external Places discovery boundary', () => {
  it('requires authentication and fail-closed quota before billable lookup', async () => {
    mocks.auth.mockResolvedValueOnce({ ok: false, error: 'Unauthorized', status: 401 }); expect((await request()).status).toBe(401);
    mocks.limit.mockResolvedValueOnce({ allowed: false, available: false }); expect((await request()).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('bounds query input before upstream lookup', async () => {
    expect((await request({ ...body, query: 'a'.repeat(401) })).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  });
  it('returns only deduplicated provider-backed records with identifiers, addresses and coordinates', async () => {
    const place = { id: 'provider-id', displayName: { text: 'Fixture verified café' }, formattedAddress: '1 Fixture Street', location: { latitude: -33.8, longitude: 151.2 }, types: ['cafe'] };
    vi.mocked(fetch).mockResolvedValue(Response.json({ places: [place, place, { ...place, id: 'closed', businessStatus: 'CLOSED_PERMANENTLY' }, { id: 'name-only', displayName: { text: 'No verified address' } }] }));
    const response = await request(); const text = await response.text();
    expect(JSON.parse(text).venues).toHaveLength(1); expect(text).not.toContain('server-secret');
    expect(JSON.parse(text).venues[0]).toMatchObject({ id: 'provider-id', lat: -33.8, lon: 151.2 });
    const options = vi.mocked(fetch).mock.calls[0][1]!;
    expect(JSON.parse(String(options.body)).pageSize).toBe(20);
    expect(new Headers(options.headers).get('X-Goog-FieldMask')).toContain('places.location');
    expect(mocks.limit).toHaveBeenCalledWith('discover-venues', 'qa', 20, 3600, { failClosed: true });
  });
  it('reports provider failure without fabricating a successful empty discovery', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('secret internal error', { status: 403 }));
    const response = await request(); expect(response.status).toBe(502); expect(await response.text()).not.toContain('secret internal error');
  });
});
