import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), key: vi.fn(), db: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: () => mocks.db() }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
vi.mock('../_shared/maps.ts', () => ({ getGoogleMapsApiKey: mocks.key }));

let handler: (req: Request) => Promise<Response>;
const request = (body: unknown) => handler(new Request('http://localhost/venue-photo', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => '' }, serve: (fn: typeof handler) => { handler = fn; } });
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
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ places: [{ photos: [{ name: 'places/p1/photos/x' }] }] }))
      .mockResolvedValueOnce(Response.json({ photoUri: 'https://lh3.example/photo.jpg' })));
    const response = await request({ venue_id: 'v1' });
    expect(response.status).toBe(200);
    const [mediaUrl, mediaInit] = vi.mocked(fetch).mock.calls[1] as [string, RequestInit];
    expect(mediaUrl).not.toContain('server-secret');
    expect(mediaUrl).not.toContain('key=');
    expect(new Headers(mediaInit.headers).get('X-Goog-Api-Key')).toBe('server-secret');
    expect(await response.json()).toEqual({ url: 'https://lh3.example/photo.jpg' });
  });
});
