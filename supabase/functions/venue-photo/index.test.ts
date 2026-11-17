import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), key: vi.fn(), db: vi.fn(), env: {} as Record<string, string> }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: () => mocks.db() }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
vi.mock('../_shared/maps.ts', () => ({ getGoogleMapsApiKey: mocks.key }));

const STAGING_URL = 'https://crpkzysdtnoomzimibhe.supabase.co';
let handler: (req: Request) => Promise<Response>;
const request = (body: unknown) => handler(new Request('http://localhost/venue-photo', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const mediaOk = () => vi.stubGlobal('fetch', vi.fn()
  .mockResolvedValueOnce(Response.json({ places: [{ photos: [{ name: 'places/p1/photos/x' }] }] }))
  .mockResolvedValueOnce(Response.json({ photoUri: 'https://lh3.example/photo.jpg' })));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.env = {};
  vi.stubGlobal('Deno', { env: { get: (key: string) => mocks.env[key] ?? '' }, serve: (fn: typeof handler) => { handler = fn; } });
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'user-1' } });
  mocks.limit.mockResolvedValue({ allowed: true, retryAfter: 0 });
  mocks.key.mockResolvedValue('server-secret');
  mocks.db.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'v1', name: 'Test Cafe', address: '1 Test St', photo_url: null, photo_checked_at: null } }) }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  });
  await import('./index');
});

describe('venue-photo API key handling', () => {
  it('sends the Google key in a header and never in the photo URL', async () => {
    mediaOk();
    const response = await request({ venue_id: 'v1' });
    expect(response.status).toBe(200);
    const [mediaUrl, mediaInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(mediaUrl).not.toContain('server-secret');
    expect(mediaUrl).not.toContain('key=');
    expect(new Headers(mediaInit.headers).get('X-Goog-Api-Key')).toBe('server-secret');
    expect(await response.json()).toEqual({ url: 'https://lh3.example/photo.jpg' });
  });

  it('on staging, uses the function environment key and not the database table', async () => {
    mocks.env = { SUPABASE_URL: STAGING_URL, GOOGLE_MAPS_API_KEY: 'staging-key' };
    mediaOk();
    expect((await request({ venue_id: 'v1' })).status).toBe(200);
    expect(mocks.key).not.toHaveBeenCalled();
    const [, searchInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(new Headers(searchInit.headers).get('X-Goog-Api-Key')).toBe('staging-key');
  });

  it('on staging with no key, fails closed without calling Google or the database table, and leaks no key', async () => {
    mocks.env = { SUPABASE_URL: STAGING_URL };
    vi.stubGlobal('fetch', vi.fn());
    const response = await request({ venue_id: 'v1' });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('key');
    expect(mocks.key).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
