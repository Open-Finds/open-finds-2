import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));

let handler: (req: Request) => Promise<Response>;
const USER = '11111111-1111-4111-8111-111111111111';
const STAGING_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://crpkzysdtnoomzimibhe.supabase.co', ALLOWED_ORIGINS: 'https://app.test', STAGING_PROVIDER_USERS: USER,
  STAGING_PROVIDER_CAMPAIGN: 'camp_1', STAGING_ANDROID_PROVIDERS_ENABLED: 'true', STAGING_PROVIDER_ENABLED: 'false',
};

async function boot(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => env[name] ?? '' }, serve: (fn: typeof handler) => { handler = fn; },
    resolveDns: async (_host: string, family: string) => (family === 'A' ? ['93.184.216.34'] : []),
  });
  await import('./index');
}
const request = (url: string, headers: Record<string, string> = {}) => handler(new Request('http://localhost/extract', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ url }),
}));
const fetched = () => vi.mocked(fetch).mock.calls.map(([url]) => String(url));
const answer = (routes: Record<string, () => Response>) => vi.mocked(fetch).mockImplementation(async (input) => {
  const url = String(input);
  const hit = Object.keys(routes).find((fragment) => url.includes(fragment));
  return hit ? routes[hit]() : new Response('nope', { status: 500 });
});
const html = (body: string) => new Response(body, { status: 200 });
const reel = 'https://www.instagram.com/reel/CODE123/';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: USER } });
  mocks.limit.mockResolvedValue({ available: true, allowed: true, remaining: 5, retryAfter: 0 });
  mocks.rpc.mockResolvedValue({ data: { allowed: true }, error: null });
});

describe('extract-venue-meta', () => {
  beforeEach(() => boot());

  it('uses the public caption embed for an Instagram post or reel, without scraping the page', async () => {
    answer({ '/p/CODE123/embed/captioned/': () => html('<div class="Caption">Try <b>Test Cafe</b> at 1 Test St, Sydney</div>') });
    const response = await request(reel);
    expect(await response.json()).toEqual({
      platform: 'instagram', contentType: 'reel', url: reel, handle: null, ogDescription: 'Try Test Cafe at 1 Test St, Sydney', fetched: true,
    });
    expect(fetched()).toEqual(['https://www.instagram.com/p/CODE123/embed/captioned/']);
  });

  it('falls back to the oEmbed and page scrape when the embed has no caption', async () => {
    answer({
      '/embed/captioned/': () => html('<div class="Other">x</div>'),
      'graph.facebook.com': () => Response.json({ html: '<blockquote data-instgrm-permalink="https://www.instagram.com/p/CODE123/"></blockquote>' }),
      '/reel/CODE123/': () => html('<html><head><meta property="og:title" content="Test Cafe on Instagram"><meta property="og:description" content="Great food"></head></html>'),
    });
    const body = await (await request(reel)).json();
    expect(body).toMatchObject({ platform: 'instagram', contentType: 'reel', ogTitle: 'Test Cafe on Instagram', ogDescription: 'Great food', fetched: true });
    expect(fetched().some((url) => url.includes('graph.facebook.com'))).toBe(true);
  });

  it('retries a reel page up to three ways outside staging', async () => {
    answer({});
    await request(reel);
    expect(fetched().filter((url) => url.includes('/reel/CODE123/'))).toHaveLength(3);
    expect(fetched().some((url) => url.endsWith('?__d=1'))).toBe(true);
  });

  it('refuses private addresses, anonymous callers and callers over their limit before fetching anything', async () => {
    expect((await request('http://169.254.169.254/latest/meta-data')).status).toBe(400);
    mocks.auth.mockResolvedValueOnce({ ok: false, status: 401, error: 'Authentication required' });
    expect((await request(reel)).status).toBe(401);
    mocks.limit.mockResolvedValueOnce({ available: true, allowed: false, remaining: 0, retryAfter: 30 });
    const limited = await request(reel);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('30');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('extract-venue-meta on staging', () => {
  beforeEach(() => boot(STAGING_ENV));
  const staged = (url: string) => request(url, { Origin: 'https://app.test' });

  it('tries each reel page once, because every fetch is a counted provider call', async () => {
    answer({});
    const response = await staged(reel);
    expect(response.status).toBe(200);
    expect(fetched().filter((url) => url.includes('/reel/CODE123/'))).toHaveLength(1);
  });

  it('asks TikTok once instead of four times', async () => {
    answer({});
    const response = await staged('https://www.tiktok.com/@user/video/123');
    expect(response.status).toBe(200);
    expect(fetched().filter((url) => url.includes('tiktok.com/oembed'))).toHaveLength(1);
  });

  it('is refused for anyone who is not a listed test account', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: '22222222-2222-4222-8222-222222222222' } });
    const response = await staged(reel);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'synthetic_user_required' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
