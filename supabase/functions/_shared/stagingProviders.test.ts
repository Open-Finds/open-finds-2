import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Records what staging does today (see stagingProviders.ts and
 * docs/staging-reference/). These tests pin the deployed behaviour so it
 * cannot drift silently, and pin that nothing changes outside staging.
 */
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock('./auth.ts', () => ({ requireUser: mocks.auth, serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('./ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));

const STAGING = 'https://crpkzysdtnoomzimibhe.supabase.co';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const stagingEnv: Record<string, string> = {
  SUPABASE_URL: STAGING, ALLOWED_ORIGINS: 'https://app.test', STAGING_PROVIDER_USERS: USER, STAGING_PROVIDER_CAMPAIGN: 'camp_1',
  STAGING_PROVIDER_ENABLED: 'false', STAGING_ANDROID_PROVIDERS_ENABLED: 'true', STAGING_RESOLVE_PLACE_ENABLED: 'true',
};
type Module = typeof import('./stagingProviders');
type Variant = 'RESOLVE_PLACE' | 'AI_PROXY' | 'EXTRACT_VENUE_META' | 'GEOCODE' | 'DISCOVER_VENUES';

async function load(env: Record<string, string>, variant: Variant = 'RESOLVE_PLACE'): Promise<Module> {
  vi.resetModules();
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] }, serve: vi.fn() });
  const module = await import('./stagingProviders');
  module.configureStagingProviders(module[variant]);
  return module;
}

const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://f.test/x', {
  method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const ok = async () => Response.json({ ok: true });
const ledgerCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'staging_provider_control').map(([, args]) => args);
const ledgerAnswer = (answer: unknown) => mocks.rpc.mockResolvedValue({ data: answer, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: USER } });
  mocks.limit.mockResolvedValue({ available: true, allowed: true, remaining: 5, retryAfter: 0 });
  ledgerAnswer({ allowed: true });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ places: [], status: 'OK', results: [], choices: [] })));
});

describe('outside staging it changes nothing', () => {
  it('runs the handler directly and sends fetch straight through on the production project', async () => {
    const m = await load({ SUPABASE_URL: 'https://production.test' }, 'AI_PROXY');
    const handler = vi.fn(ok);
    const response = await m.withStagingProviderControls('ai-proxy', handler)(post({ anything: true }, { Origin: 'https://other.test' }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    await m.providerFetch('https://places.googleapis.com/v1/places:autocomplete', { method: 'POST', body: 'x' });
    expect(fetch).toHaveBeenCalledWith('https://places.googleapis.com/v1/places:autocomplete', { method: 'POST', body: 'x' });
    expect(m.isStagingControlled()).toBe(false);
  });

  it('is plain fetch for a function that never opted in, even on staging', async () => {
    vi.resetModules();
    vi.stubGlobal('Deno', { env: { get: (name: string) => stagingEnv[name] }, serve: vi.fn() });
    const m = await import('./stagingProviders');
    await m.providerFetch('https://example.com/x');
    expect(fetch).toHaveBeenCalledWith('https://example.com/x', {});
    expect(m.isStagingControlled()).toBe(false);
  });

  it.each(['RESOLVE_PLACE', 'AI_PROXY', 'EXTRACT_VENUE_META', 'GEOCODE', 'DISCOVER_VENUES'] as const)(
    'does not refuse to boot %s on a non-staging project with no staging settings', async (variant) => {
      await expect(load({ SUPABASE_URL: 'https://production.test' }, variant)).resolves.toBeDefined();
    });
});

describe('staging boot guards', () => {
  it('refuses to boot when staging is detected on any other project', async () => {
    await expect(load({ SUPABASE_URL: 'https://production.test', STAGING_PROVIDER_CAMPAIGN: 'camp' }))
      .rejects.toThrow('Staging deployment target mismatch');
    await expect(load({ SUPABASE_URL: 'https://production.test', APP_ENV: 'staging' }))
      .rejects.toThrow('Staging deployment target mismatch');
  });

  it.each(['RESOLVE_PLACE', 'AI_PROXY', 'GEOCODE', 'DISCOVER_VENUES'] as const)(
    '%s must boot with the general provider flag exactly "false"', async (variant) => {
      for (const value of [undefined, '', 'true', 'FALSE']) {
        const env = { ...stagingEnv, STAGING_PROVIDER_ENABLED: value as string };
        await expect(load(env, variant)).rejects.toThrow(/must remain disabled/);
      }
      await expect(load(stagingEnv, variant)).resolves.toBeDefined();
    });

  it('extract-venue-meta only accepts "true" or "false" (default false) for its activation flag', async () => {
    await expect(load({ ...stagingEnv, STAGING_ANDROID_PROVIDERS_ENABLED: 'yes' }, 'EXTRACT_VENUE_META'))
      .rejects.toThrow('Invalid Android staging activation');
    await expect(load({ ...stagingEnv, STAGING_ANDROID_PROVIDERS_ENABLED: undefined as unknown as string }, 'EXTRACT_VENUE_META'))
      .resolves.toBeDefined();
    await expect(load({ ...stagingEnv, STAGING_ANDROID_PROVIDERS_ENABLED: 'false' }, 'EXTRACT_VENUE_META')).resolves.toBeDefined();
  });
});

describe('staging admission, in the order the deployed code applies it', () => {
  it('only lets listed browsers through, before looking at who is calling', async () => {
    const m = await load(stagingEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', ok);
    for (const origin of ['', 'https://evil.test']) {
      const response = await wrapped(post({ a: 1 }, { Origin: origin }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'origin_not_allowed' });
    }
    const wildcard = await load({ ...stagingEnv, ALLOWED_ORIGINS: '*' });
    expect((await wildcard.withStagingProviderControls('resolve-place', ok)(post({ a: 1 }))).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it('passes preflight to the handler and refuses other methods', async () => {
    const m = await load(stagingEnv);
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const wrapped = m.withStagingProviderControls('resolve-place', handler);
    expect((await wrapped(new Request('https://f.test/x', { method: 'OPTIONS', headers: { Origin: 'https://app.test' } }))).status).toBe(204);
    const get = await wrapped(new Request('https://f.test/x', { method: 'GET', headers: { Origin: 'https://app.test' } }));
    expect(get.status).toBe(405);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('closes travel-times whatever else is true', async () => {
    const m = await load(stagingEnv);
    const response = await m.withStagingProviderControls('travel-times', ok)(post({}));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'routing_budget_not_approved' });
  });

  it('requires a signed-in user and passes that refusal through unchanged', async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'A signed-in user session is required' });
    const m = await load(stagingEnv);
    const response = await m.withStagingProviderControls('resolve-place', ok)(post({}));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'A signed-in user session is required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['a user who is not on the list', { ...stagingEnv }, OTHER],
    ['an empty list', { ...stagingEnv, STAGING_PROVIDER_USERS: '' }, USER],
    ['a list with a malformed entry', { ...stagingEnv, STAGING_PROVIDER_USERS: USER + ',not-a-uuid' }, USER],
  ])('refuses %s as a non-test account (403 synthetic_user_required)', async (_label, env, id) => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id } });
    const m = await load(env);
    const response = await m.withStagingProviderControls('resolve-place', ok)(post({}));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'synthetic_user_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['RESOLVE_PLACE', 'resolve-place', 'STAGING_RESOLVE_PLACE_ENABLED'],
    ['AI_PROXY', 'ai-proxy', 'STAGING_ANDROID_PROVIDERS_ENABLED'],
    ['EXTRACT_VENUE_META', 'extract-venue-meta', 'STAGING_ANDROID_PROVIDERS_ENABLED'],
    ['GEOCODE', 'geocode', 'STAGING_ANDROID_PROVIDERS_ENABLED'],
    ['DISCOVER_VENUES', 'discover-venues', 'STAGING_PROVIDER_ENABLED'],
  ] as const)('%s is admitted only while %s is "true"', async (variant, operation, flag) => {
    const body = { purpose: 'extract' };
    const off = await load({ ...stagingEnv, [flag]: 'false', STAGING_PROVIDER_ENABLED: flag === 'STAGING_PROVIDER_ENABLED' ? 'false' : 'false' }, variant);
    const refused = await off.withStagingProviderControls(operation, ok)(post(body));
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: 'staging_providers_disabled' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    if (flag !== 'STAGING_PROVIDER_ENABLED') {
      const on = await load(stagingEnv, variant);
      expect((await on.withStagingProviderControls(operation, ok)(post(body))).status).toBe(200);
    }
  });

  it('needs a valid campaign name and numeric settings in range', async () => {
    for (const env of [{ ...stagingEnv, STAGING_PROVIDER_CAMPAIGN: 'bad name!' }, { ...stagingEnv, STAGING_DAILY_AI_PER_USER: '99' },
      { ...stagingEnv, STAGING_DAILY_GOOGLE_PER_USER: '31' }, { ...stagingEnv, STAGING_REQUESTS_PER_MINUTE: '7' }]) {
      const m = await load(env);
      const response = await m.withStagingProviderControls('resolve-place', ok)(post({ a: 1 }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'staging_configuration_invalid' });
    }
  });

  it('limits each account to a few requests a minute, failing closed if that cannot be checked', async () => {
    const m = await load(stagingEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', ok);
    mocks.limit.mockResolvedValueOnce({ available: true, allowed: false, remaining: 0, retryAfter: 30 });
    const limited = await wrapped(post({ a: 1 }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toMatchObject({ code: 'user_rate_limit' });
    mocks.limit.mockResolvedValueOnce({ available: false, allowed: false, remaining: 0, retryAfter: 60 });
    const unavailable = await wrapped(post({ a: 1 }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ code: 'usage_control_unavailable' });
    expect(mocks.limit).toHaveBeenCalledWith('staging-provider-entry', USER, 6, 60, { failClosed: true });
  });

  it('rejects bodies that are not a JSON object', async () => {
    const m = await load(stagingEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', ok);
    for (const body of ['{nope', '[1]', 'null']) {
      const response = await wrapped(post(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'invalid_json' });
    }
  });
});

describe('the spending ledger', () => {
  it.each([
    ['duplicate_request', 409], ['campaign_busy', 409], ['budget_exhausted', 429], ['daily_limit', 429], ['invalid_reservation', 429],
    ['something_new', 503],
  ])('turns a "%s" refusal into HTTP %i', async (code, status) => {
    const m = await load(stagingEnv);
    ledgerAnswer({ allowed: false, code });
    const response = await m.withStagingProviderControls('resolve-place', ok)(post({ a: 1 }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code: status === 503 ? 'usage_control_unavailable' : code });
  });

  it('treats an unreadable or failing ledger as unavailable', async () => {
    const m = await load(stagingEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', ok);
    ledgerAnswer({ nope: 1 });
    expect((await wrapped(post({ a: 1 }))).status).toBe(503);
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('db down') });
    expect((await wrapped(post({ a: 1 }))).status).toBe(503);
  });

  it('reserves before the handler runs and releases after, naming the campaign, user and operation', async () => {
    const m = await load(stagingEnv);
    const order: string[] = [];
    mocks.rpc.mockImplementation(async (_name: string, args: { p_action: string }) => { order.push(args.p_action); return { data: { allowed: true }, error: null }; });
    const response = await m.withStagingProviderControls('resolve-place', async () => { order.push('handler'); return Response.json({ ok: true }); })(post({ a: 1 }));
    expect(response.status).toBe(200);
    expect(order).toEqual(['start', 'handler', 'finish']);
    expect(ledgerCalls()[0]).toMatchObject({ p_campaign: 'camp_1', p_user: USER, p_operation: 'resolve-place', p_conversation: null });
    expect(ledgerCalls()[0].p_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fails the request if the reservation cannot be released', async () => {
    const m = await load(stagingEnv);
    mocks.rpc.mockImplementation(async (_name: string, args: { p_action: string }) =>
      ({ data: args.p_action === 'finish' ? { allowed: false, code: 'invalid_reservation' } : { allowed: true }, error: null }));
    const response = await m.withStagingProviderControls('resolve-place', ok)(post({ a: 1 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'usage_control_unavailable' });
  });

  it('never returns provider detail when the handler throws', async () => {
    const m = await load(stagingEnv);
    const response = await m.withStagingProviderControls('resolve-place', async () => { throw new Error('secret-key-123'); })(post({ a: 1 }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret-key-123');
    expect(ledgerCalls().map((c) => c.p_action)).toEqual(['start', 'finish']);
  });
});

describe('provider calls inside a staging request', () => {
  const calls = (m: Module, urls: string[], init: RequestInit = { method: 'POST', body: '{}' }) => async () => {
    for (const url of urls) await m.providerFetch(url, init);
    return Response.json({ ok: true });
  };
  const PLACES = 'https://places.googleapis.com/v1/places:searchText';
  const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json?address=x';

  it('counts every call against the reservation by kind, with the daily limits', async () => {
    const m = await load(stagingEnv);
    await m.withStagingProviderControls('resolve-place', calls(m, [PLACES, GEOCODE, 'https://example.com/page']))(post({ a: 1 }));
    expect(ledgerCalls().filter((c) => c.p_action === 'call')).toMatchObject([
      { p_kind: 'places', p_daily_ai: 10, p_daily_google: 20 }, { p_kind: 'geocode' }, { p_kind: 'metadata' },
    ]);
  });

  it('allows at most eight calls per request', async () => {
    const m = await load(stagingEnv);
    const urls = Array.from({ length: 9 }, (_, i) => 'https://example.com/p' + i);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, urls))(post({ a: 1 }));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'request_call_limit' });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(8);
  });

  it.each([
    ['https://maps.googleapis.com/maps/api/place/photo?x=1', 503, 'provider_endpoint_not_approved'],
    ['https://places.googleapis.com/v1/places:autocomplete', 503, 'provider_endpoint_not_approved'],
    ['https://openrouter.ai/api/v1/models', 503, 'provider_endpoint_not_approved'],
    ['http://example.com/page', 400, 'provider_url_not_allowed'],
  ])('refuses %s without calling it', async (url, status, code) => {
    const m = await load(stagingEnv);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [url]))(post({ a: 1 }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a provider call made outside a request', async () => {
    const m = await load(stagingEnv);
    await expect(m.providerFetch(PLACES)).rejects.toMatchObject({ code: 'provider_context_required', status: 503 });
  });

  it('reports a refused or failing call as unavailable, and a daily limit as 429', async () => {
    const m = await load(stagingEnv);
    mocks.rpc.mockImplementation(async (_n: string, a: { p_action: string }) =>
      ({ data: a.p_action === 'call' ? { allowed: false, code: 'daily_limit' } : { allowed: true }, error: null }));
    const limited = await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ a: 1 }));
    expect(limited.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
    ledgerAnswer({ allowed: true });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x', { status: 500 }));
    expect((await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ a: 1 }))).status).toBe(502);
    vi.mocked(fetch).mockResolvedValueOnce(new Response('<<>>', { status: 200 }));
    expect((await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ a: 1 }))).status).toBe(502);
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ status: 'REQUEST_DENIED' }));
    expect((await m.withStagingProviderControls('resolve-place', calls(m, [GEOCODE]))(post({ a: 1 }))).status).toBe(502);
  });

  it('never follows redirects and always bounds the wait', async () => {
    const m = await load(stagingEnv);
    await m.withStagingProviderControls('resolve-place', calls(m, ['https://example.com/page']))(post({ a: 1 }));
    const options = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(options.redirect).toBe('manual');
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('what differs between the deployed functions', () => {
  const ai = (m: Module) => async () => {
    await m.providerFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model: 'expensive/model', temperature: 2, messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_object' } }),
    });
    return Response.json({ ok: true });
  };
  const sentBody = () => JSON.parse(String((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body));

  it('ai-proxy rewrites every AI call to the nano model with two web results, whatever the caller asked for', async () => {
    const m = await load(stagingEnv, 'AI_PROXY');
    expect((await m.withStagingProviderControls('ai-proxy', ai(m))(post({ purpose: 'extract' }))).status).toBe(200);
    expect(sentBody()).toEqual({
      model: 'openai/gpt-5-nano', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1024, reasoning: { effort: 'minimal' },
      plugins: [{ id: 'web', engine: 'exa', max_results: 2 }], provider: { allow_fallbacks: false }, response_format: { type: 'json_object' },
    });
  });

  it('ai-proxy sends a request for the plain mini model as asked: no nano, no web search', async () => {
    const m = await load(stagingEnv, 'AI_PROXY');
    const plain = async () => {
      await m.providerFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', body: JSON.stringify({ model: 'openai/gpt-4o-mini', temperature: 0, messages: [{ role: 'user', content: 'hi' }], response_format: { type: 'json_object' } }),
      });
      return Response.json({ ok: true });
    };
    expect((await m.withStagingProviderControls('ai-proxy', plain)(post({ purpose: 'extract' }))).status).toBe(200);
    expect(sentBody()).toEqual({
      model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 1024,
      provider: { allow_fallbacks: false }, response_format: { type: 'json_object' },
    });
    expect(sentBody()).not.toHaveProperty('plugins');
  });

  it('the other functions rewrite AI calls to the mini model at temperature 0', async () => {
    const m = await load(stagingEnv, 'GEOCODE');
    await m.withStagingProviderControls('geocode', ai(m))(post({ a: 1 }));
    expect(sentBody()).toEqual({
      model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], temperature: 0, max_tokens: 1024,
      provider: { allow_fallbacks: false }, response_format: { type: 'json_object' },
    });
  });

  it('refuses an AI call with too many or too large messages', async () => {
    const m = await load(stagingEnv, 'AI_PROXY');
    const big = (messages: unknown) => async () => { await m.providerFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages }) }); return Response.json({}); };
    const response = await m.withStagingProviderControls('ai-proxy', big([{ role: 'user', content: 'x'.repeat(9000) }]))(post({ purpose: 'extract' }));
    expect(response.status).toBe(413);
    const bad = await m.withStagingProviderControls('ai-proxy', big([{ role: 'tool', content: 'x' }]))(post({ purpose: 'extract' }));
    expect(bad.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('AI Save slide pictures', () => {
    const picture = (url: string) => ({ type: 'image_url', image_url: { url, detail: 'auto' } });
    const send = async (m: Module, content: unknown, role = 'user') => m.withStagingProviderControls('ai-proxy', async () => {
      await m.providerFetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', body: JSON.stringify({ model: 'openai/gpt-4o-mini', messages: [{ role, content }] }),
      });
      return Response.json({ ok: true });
    })(post({ purpose: 'extract' }));

    it('passes Instagram pictures through to the plain mini model', async () => {
      const m = await load(stagingEnv, 'AI_PROXY');
      vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [] }));
      const content = [{ type: 'text', text: 'Read the venues' }, picture('https://scontent.cdninstagram.com/a.jpg')];
      expect((await send(m, content)).status).toBe(200);
      expect(sentBody()).toMatchObject({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content }] });
    });

    it('passes shared screenshots (larger than the 8 KB text cap) through to the plain mini model', async () => {
      const m = await load(stagingEnv, 'AI_PROXY');
      vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [] }));
      const shot = picture('data:image/jpeg;base64,' + 'A'.repeat(200_000));
      const content = [{ type: 'text', text: 'Read the venues' }, shot, shot];
      expect((await send(m, content)).status).toBe(200);
      expect(sentBody()).toMatchObject({ model: 'openai/gpt-4o-mini', messages: [{ role: 'user', content }] });
    });

    it.each([
      ['a picture outside Instagram', [picture('https://evil.example.com/a.jpg')], 'user'],
      ['more than six pictures', Array.from({ length: 7 }, (_, i) => picture(`https://x.cdninstagram.com/${i}.jpg`)), 'user'],
      ['a screenshot that is not an image', [picture('data:text/html;base64,PGgxPg==')], 'user'],
      ['a screenshot over the size limit', [picture('data:image/jpeg;base64,' + 'A'.repeat(1_500_001))], 'user'],
      ['a long text hidden beside a screenshot', [{ type: 'text', text: 'x'.repeat(9000) }, picture('data:image/png;base64,AAAA')], 'user'],
      ['pictures in a system message', [picture('https://x.cdninstagram.com/a.jpg')], 'system'],
    ])('refuses %s', async (_name, content, role) => {
      const m = await load(stagingEnv, 'AI_PROXY');
      expect((await send(m, content, role)).status).toBe(413);
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('ai-proxy is open to extraction only, and never spends credits', async () => {
    const m = await load(stagingEnv, 'AI_PROXY');
    const wrapped = m.withStagingProviderControls('ai-proxy', ok);
    for (const body of [{ purpose: 'discover' }, {}, { purpose: 'other' }]) {
      const response = await wrapped(post(body, { 'x-staging-conversation-id': '33333333-3333-4333-8333-333333333333' }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'staging_extraction_only' });
    }
    const credit = await wrapped(post({ purpose: 'extract', use_credit: true }));
    expect(credit.status).toBe(400);
    expect(await credit.json()).toMatchObject({ code: 'staging_credit_spending_disabled' });
    expect((await wrapped(post({ purpose: 'extract' }))).status).toBe(200);
  });

  it('identical requests are refused as duplicates for resolve-place and geocode, never for ai-proxy and extract', async () => {
    const hashes = async (variant: Variant, operation: string) => {
      vi.clearAllMocks();
      ledgerAnswer({ allowed: true });
      const m = await load(stagingEnv, variant);
      const wrapped = m.withStagingProviderControls(operation, ok);
      await wrapped(post({ purpose: 'extract', url: 'https://x.test/a' }));
      await wrapped(post({ url: 'https://x.test/a', purpose: 'extract' }));
      return ledgerCalls().filter((c) => c.p_action === 'start').map((c) => c.p_hash as string);
    };
    for (const [variant, operation] of [['RESOLVE_PLACE', 'resolve-place'], ['GEOCODE', 'geocode']] as const) {
      const [a, b] = await hashes(variant, operation);
      expect(a).toBe(b);
    }
    for (const [variant, operation] of [['AI_PROXY', 'ai-proxy'], ['EXTRACT_VENUE_META', 'extract-venue-meta']] as const) {
      const [a, b] = await hashes(variant, operation);
      expect(a).not.toBe(b);
    }
  });

  it('a failed metadata fetch returns an empty 502 for extract-venue-meta, but ends the request for the others', async () => {
    const extract = await load(stagingEnv, 'EXTRACT_VENUE_META');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x', { status: 500 }));
    const seen: number[] = [];
    const response = await extract.withStagingProviderControls('extract-venue-meta', async () => {
      seen.push((await extract.providerFetch('https://example.com/page')).status);
      return Response.json({ ok: true });
    })(post({ url: 'https://example.com/page' }));
    expect(seen).toEqual([502]);
    expect(response.status).toBe(200);

    const resolve = await load(stagingEnv, 'RESOLVE_PLACE');
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x', { status: 500 }));
    const ended = await resolve.withStagingProviderControls('resolve-place', async () => {
      await resolve.providerFetch('https://example.com/page');
      return Response.json({ ok: true });
    })(post({ a: 1 }));
    expect(ended.status).toBe(502);
  });

  it('ai-proxy discover requests would need a conversation id (unreachable while extraction-only)', async () => {
    const m = await load(stagingEnv, 'RESOLVE_PLACE');
    const response = await m.withStagingProviderControls('ai-proxy', ok)(post({ purpose: 'discover' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'conversation_id_required' });
  });
});
