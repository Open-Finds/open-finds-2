import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Open mode (STAGING_PROVIDER_ACCESS=open): any signed-in user, with a testing
 * allowance of AI Save attempts claimed in the database. These tests run the
 * wrapper against an in-test model of claim_ai_save_attempt that follows the SQL
 * rules (supabase/tests/10_ai_save_attempts.sql checks the SQL itself), so they
 * show how the wrapper counts, refuses and fails, including under concurrent
 * requests. They do not exercise the database's per-user lock.
 */
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), rpc: vi.fn() }));
vi.mock('./auth.ts', () => ({ requireUser: mocks.auth, serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('./ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));

const STAGING = 'https://crpkzysdtnoomzimibhe.supabase.co';
const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const openEnv: Record<string, string> = {
  SUPABASE_URL: STAGING, ALLOWED_ORIGINS: 'https://app.test', STAGING_PROVIDER_ENABLED: 'false',
  STAGING_ANDROID_PROVIDERS_ENABLED: 'true', STAGING_RESOLVE_PLACE_ENABLED: 'true', STAGING_PROVIDER_ACCESS: 'open',
};
type Module = typeof import('./stagingProviders');
type Variant = 'RESOLVE_PLACE' | 'AI_PROXY' | 'EXTRACT_VENUE_META' | 'GEOCODE' | 'DISCOVER_VENUES';

async function load(env: Record<string, string | undefined>, variant: Variant = 'RESOLVE_PLACE'): Promise<Module> {
  vi.resetModules();
  vi.stubGlobal('Deno', { env: { get: (name: string) => env[name] }, serve: vi.fn() });
  const module = await import('./stagingProviders');
  module.configureStagingProviders(module[variant]);
  return module;
}

const attempt = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const post = (body: unknown, headers: Record<string, string> = {}) => new Request('https://f.test/x', {
  method: 'POST', headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
const PLACES = 'https://places.googleapis.com/v1/places:searchText';
const GEOCODE = 'https://maps.googleapis.com/maps/api/geocode/json?address=x';
const PAGE = 'https://example.com/page';
const ok = async () => Response.json({ ok: true });

/** Calls providers like a function handler: errors are caught and turned into a 500, as the real handlers do. */
const calls = (m: Module, urls: string[], init: RequestInit = { method: 'POST', body: '{}' }) => async () => {
  try {
    for (const url of urls) await m.providerFetch(url, init);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
};

/** The database function's rules, in memory. */
function attemptsModel() {
  const rows = new Map<string, { at: number; requests: number }>();
  const log: { user: string; attempt: string; result: Record<string, unknown> }[] = [];
  let now = 0;
  const claim = (a: { p_user: string; p_attempt: string; p_limit: number; p_window_seconds: number; p_max_requests: number }) => {
    const window = a.p_window_seconds * 1000;
    const key = a.p_user + ':' + a.p_attempt;
    const existing = rows.get(key);
    let result: Record<string, unknown>;
    if (existing) {
      if (existing.at <= now - window) result = { allowed: false, code: 'attempt_expired' };
      else if (existing.requests >= a.p_max_requests) result = { allowed: false, code: 'attempt_request_limit' };
      else { existing.requests++; result = { allowed: true, counted: false, requests: existing.requests }; }
    } else {
      const inWindow = [...rows].filter(([k, r]) => k.startsWith(a.p_user + ':') && r.at > now - window).map(([, r]) => r.at).sort((x, y) => x - y);
      if (inWindow.length >= a.p_limit) {
        const oldest = inWindow[inWindow.length - a.p_limit];
        result = { allowed: false, code: 'testing_limit', retry_after: Math.max(1, Math.ceil((oldest + window - now) / 1000)) };
      } else {
        rows.set(key, { at: now, requests: 1 });
        result = { allowed: true, counted: true, requests: 1, remaining: a.p_limit - inWindow.length - 1 };
      }
    }
    log.push({ user: a.p_user, attempt: a.p_attempt, result });
    return result;
  };
  return {
    claim, log, rows,
    advance: (seconds: number) => { now += seconds * 1000; },
    counted: (user = USER) => [...rows.keys()].filter((k) => k.startsWith(user + ':')).length,
    claims: () => mocks.rpc.mock.calls.filter(([name]) => name === 'claim_ai_save_attempt').map(([, args]) => args),
  };
}

/** Fixed-window counters, like consume_rate_limit. */
function limiter() {
  const counts = new Map<string, number>();
  mocks.limit.mockImplementation(async (bucket: string, subject: string, limit: number) => {
    const key = bucket + ':' + subject;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return { available: true, allowed: count <= limit, remaining: Math.max(limit - count, 0), retryAfter: 3 };
  });
  return { reset: () => counts.clear() };
}

let db: ReturnType<typeof attemptsModel>;
let window: ReturnType<typeof limiter>;
const ledgerCalls = () => mocks.rpc.mock.calls.filter(([name]) => name === 'staging_provider_control');

beforeEach(() => {
  vi.clearAllMocks();
  db = attemptsModel();
  window = limiter();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: USER } });
  mocks.rpc.mockImplementation(async (name: string, args: never) =>
    name === 'claim_ai_save_attempt' ? { data: db.claim(args), error: null } : { data: { allowed: true }, error: null });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ places: [], status: 'OK', results: [], choices: [] })));
});

describe('open mode admission', () => {
  it.each([
    ['RESOLVE_PLACE', 'resolve-place', { verify: true }],
    ['AI_PROXY', 'ai-proxy', { purpose: 'extract' }],
    ['EXTRACT_VENUE_META', 'extract-venue-meta', { url: PAGE }],
  ] as const)('%s admits an ordinary signed-in user without touching the ledger', async (variant, operation, body) => {
    const m = await load(openEnv, variant);
    const handler = vi.fn(calls(m, [PLACES]));
    const response = await m.withStagingProviderControls(operation, handler)(post({ ...body, attempt_id: attempt(1) }));
    expect(response.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
    expect(ledgerCalls()).toHaveLength(0);
    expect(db.counted()).toBe(1);
  });

  it('is off unless the setting is exactly "open", and then behaves as before', async () => {
    for (const value of [undefined, '', 'closed', 'OPEN', 'true', ' open']) {
      const m = await load({ ...openEnv, STAGING_PROVIDER_ACCESS: value, STAGING_PROVIDER_USERS: OTHER, STAGING_PROVIDER_CAMPAIGN: 'camp_1' });
      const response = await m.withStagingProviderControls('resolve-place', ok)(post({ attempt_id: attempt(1) }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'synthetic_user_required' });
    }
    expect(db.claims()).toHaveLength(0);
  });

  it.each(['GEOCODE', 'DISCOVER_VENUES'] as const)('never opens %s, even with the setting on', async (variant) => {
    const m = await load({ ...openEnv, STAGING_PROVIDER_USERS: OTHER, STAGING_PROVIDER_CAMPAIGN: 'camp_1' }, variant);
    const response = await m.withStagingProviderControls(variant === 'GEOCODE' ? 'geocode' : 'discover-venues', ok)(post({ attempt_id: attempt(1) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'synthetic_user_required' });
  });

  it('does not open ai-proxy to anything but extraction, and still refuses credit spending', async () => {
    const m = await load(openEnv, 'AI_PROXY');
    const wrapped = m.withStagingProviderControls('ai-proxy', ok);
    for (const body of [{ purpose: 'discover' }, {}]) {
      const response = await wrapped(post({ ...body, attempt_id: attempt(1) }));
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: 'staging_extraction_only' });
    }
    const credit = await wrapped(post({ purpose: 'extract', use_credit: true, attempt_id: attempt(1) }));
    expect(credit.status).toBe(400);
    expect(await credit.json()).toMatchObject({ code: 'staging_credit_spending_disabled' });
  });

  it.each([
    ['RESOLVE_PLACE', 'resolve-place', 'STAGING_RESOLVE_PLACE_ENABLED'],
    ['AI_PROXY', 'ai-proxy', 'STAGING_ANDROID_PROVIDERS_ENABLED'],
    ['EXTRACT_VENUE_META', 'extract-venue-meta', 'STAGING_ANDROID_PROVIDERS_ENABLED'],
  ] as const)('%s keeps its kill switch (%s)', async (variant, operation, flag) => {
    // (An empty value would stop extract-venue-meta booting at all, as deployed.)
    for (const value of ['false', undefined]) {
      const m = await load({ ...openEnv, [flag]: value }, variant);
      const response = await m.withStagingProviderControls(operation, ok)(post({ purpose: 'extract', attempt_id: attempt(1) }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'staging_providers_disabled' });
    }
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(db.claims()).toHaveLength(0);
  });

  it('keeps authentication and origin checks, before any database call', async () => {
    const m = await load(openEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', ok);
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'A signed-in user session is required' });
    const anonymous = await wrapped(post({ attempt_id: attempt(1) }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'A signed-in user session is required' });
    mocks.auth.mockResolvedValue({ ok: true, user: { id: USER } });
    for (const origin of ['', 'https://evil.test']) {
      expect((await wrapped(post({ attempt_id: attempt(1) }, { Origin: origin }))).status).toBe(403);
    }
    const wildcard = await load({ ...openEnv, ALLOWED_ORIGINS: '*' });
    expect((await wildcard.withStagingProviderControls('resolve-place', ok)(post({ attempt_id: attempt(1) }))).status).toBe(403);
    expect(mocks.limit).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses unlisted methods and keeps preflight working', async () => {
    const m = await load(openEnv);
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const wrapped = m.withStagingProviderControls('resolve-place', handler);
    expect((await wrapped(new Request('https://f.test/x', { method: 'OPTIONS', headers: { Origin: 'https://app.test' } }))).status).toBe(204);
    expect((await wrapped(new Request('https://f.test/x', { method: 'GET', headers: { Origin: 'https://app.test' } }))).status).toBe(405);
  });
});

describe('attempt ids', () => {
  it.each([undefined, null, 42, '', 'not-a-uuid', 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'])(
    'refuses %s before the handler, the allowance or any provider call', async (value) => {
      const m = await load(openEnv);
      const handler = vi.fn(calls(m, [PLACES]));
      const response = await m.withStagingProviderControls('resolve-place', handler)(post({ verify: true, attempt_id: value }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'attempt_id_required' });
      expect(handler).not.toHaveBeenCalled();
      expect(db.claims()).toHaveLength(0);
      expect(fetch).not.toHaveBeenCalled();
    });

  it('refuses a rebuilt-app-less request (no attempt id) so an old app cannot spend the allowance per request', async () => {
    const m = await load(openEnv);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ url: 'https://maps.app.goo.gl/x', verify: true }));
    expect(response.status).toBe(400);
    expect(db.counted()).toBe(0);
  });
});

describe('what counts as an attempt', () => {
  it('claims once per request, at the first paid call, with the configured rules', async () => {
    const m = await load(openEnv);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [PAGE, PLACES, GEOCODE, PLACES]))(post({ attempt_id: attempt(1) }));
    expect(response.status).toBe(200);
    expect(db.claims()).toEqual([{ p_user: USER, p_attempt: attempt(1), p_limit: 20, p_window_seconds: 1800, p_max_requests: 12 }]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('claims before the first paid call is dispatched', async () => {
    const m = await load(openEnv);
    const order: string[] = [];
    mocks.rpc.mockImplementation(async (name: string, args: never) => { order.push('claim'); return { data: db.claim(args), error: null }; });
    vi.mocked(fetch).mockImplementation(async () => { order.push('fetch'); return Response.json({ places: [] }); });
    await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ attempt_id: attempt(1) }));
    expect(order).toEqual(['claim', 'fetch']);
  });

  it('does not count free metadata fetches', async () => {
    const m = await load(openEnv, 'EXTRACT_VENUE_META');
    const response = await m.withStagingProviderControls('extract-venue-meta', calls(m, [PAGE, PAGE + '2', PAGE + '3'], {}))(post({ url: PAGE, attempt_id: attempt(1) }));
    expect(response.status).toBe(200);
    expect(db.claims()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('counts one attempt across the functions it calls, and the first paid call is the one that claims', async () => {
    const extract = await load(openEnv, 'EXTRACT_VENUE_META');
    await extract.withStagingProviderControls('extract-venue-meta', calls(extract, [PAGE], {}))(post({ url: PAGE, attempt_id: attempt(1) }));
    const ai = await load(openEnv, 'AI_PROXY');
    await ai.withStagingProviderControls('ai-proxy', calls(ai, ['https://openrouter.ai/api/v1/chat/completions'], {
      method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    }))(post({ purpose: 'extract', attempt_id: attempt(1) }));
    const resolve = await load(openEnv, 'RESOLVE_PLACE');
    await resolve.withStagingProviderControls('resolve-place', calls(resolve, [PLACES]))(post({ verify: true, attempt_id: attempt(1) }));
    expect(db.counted()).toBe(1);
    expect(db.log.map((entry) => entry.result.counted)).toEqual([true, false]);
    expect(db.rows.get(USER + ':' + attempt(1))?.requests).toBe(2);
  });

  it.each([
    ['the handler refuses the request itself', async () => Response.json({ error: 'bad' }, { status: 400 })],
    ['the handler throws before any provider call', async () => { throw new Error('boom'); }],
  ])('does not count a request where %s', async (_label, handler) => {
    const m = await load(openEnv);
    await m.withStagingProviderControls('resolve-place', handler)(post({ attempt_id: attempt(1) }));
    expect(db.claims()).toHaveLength(0);
  });

  it.each([
    ['an unapproved Google endpoint', 'https://maps.googleapis.com/maps/api/place/photo?x=1', {}],
    ['an unapproved Places endpoint', 'https://places.googleapis.com/v1/places:autocomplete', {}],
    ['an insecure address', 'http://example.com/x', {}],
    ['an AI call that is too large', 'https://openrouter.ai/api/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(9000) }] }) }],
  ])('does not count %s, which is refused before dispatch', async (_label, url, init) => {
    const m = await load(openEnv);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [url], init))(post({ attempt_id: attempt(1) }));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(db.claims()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the eight-call limit, and the ninth paid call neither claims again nor dispatches', async () => {
    const m = await load(openEnv);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, Array.from({ length: 9 }, () => PLACES)))(post({ attempt_id: attempt(1) }));
    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(8);
    expect(db.claims()).toHaveLength(1);
  });

  it('claims once even when paid calls run at the same time', async () => {
    const m = await load(openEnv);
    const handler = async () => {
      await Promise.all([m.providerFetch(PLACES, { method: 'POST', body: '{}' }), m.providerFetch(GEOCODE), m.providerFetch(PLACES, { method: 'POST', body: '{}' })]);
      return Response.json({ ok: true });
    };
    expect((await m.withStagingProviderControls('resolve-place', handler)(post({ attempt_id: attempt(1) }))).status).toBe(200);
    expect(db.claims()).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('refusals reach the person, even though handlers swallow errors', () => {
  const run = async (m: Module, attemptId = attempt(1)) =>
    m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ attempt_id: attemptId }));

  it('refuses the 21st attempt with the wait, in the body and the header, without any provider call', async () => {
    const m = await load(openEnv);
    for (let i = 1; i <= 20; i++) {
      window.reset();
      expect((await run(m, attempt(i))).status).toBe(200);
      db.advance(60);
    }
    vi.mocked(fetch).mockClear();
    const refused = await run(m, attempt(21));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({
      error: "You've reached the testing limit. Try again in 10 minutes.", code: 'testing_limit', retry_after_seconds: 600,
    });
    expect(refused.headers.get('Retry-After')).toBe('600');
    expect(fetch).not.toHaveBeenCalled();
    expect(db.counted()).toBe(20);
  });

  it.each([
    [1, 'less than a minute'], [59, 'less than a minute'], [60, '1 minute'], [61, '2 minutes'], [723, '13 minutes'], [1800, '30 minutes'],
  ])('words a %i second wait as "%s"', async (seconds, text) => {
    const m = await load(openEnv);
    mocks.rpc.mockResolvedValue({ data: { allowed: false, code: 'testing_limit', retry_after: seconds }, error: null });
    const body = await (await run(m)).json();
    expect(body.error).toBe(`You've reached the testing limit. Try again in ${text}.`);
    expect(body.retry_after_seconds).toBe(seconds);
  });

  it('refuses an expired attempt id and an attempt that made too many requests', async () => {
    const m = await load(openEnv);
    mocks.rpc.mockResolvedValueOnce({ data: { allowed: false, code: 'attempt_expired' }, error: null });
    const expired = await run(m);
    expect(expired.status).toBe(410);
    expect(await expired.json()).toMatchObject({ code: 'attempt_expired' });
    mocks.rpc.mockResolvedValueOnce({ data: { allowed: false, code: 'attempt_request_limit' }, error: null });
    window.reset();
    const capped = await run(m);
    expect(capped.status).toBe(429);
    expect(await capped.json()).toMatchObject({ code: 'attempt_request_limit' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('if the database cannot answer, nothing is spent', () => {
  it.each([
    ['rejects', () => mocks.rpc.mockRejectedValue(new Error('connection refused'))],
    ['returns an error', () => mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } })],
    ['returns nothing usable', () => mocks.rpc.mockResolvedValue({ data: { nope: 1 }, error: null })],
    ['reports invalid settings', () => mocks.rpc.mockResolvedValue({ data: { allowed: false, code: 'invalid_claim' }, error: null })],
  ])('the allowance check that %s fails closed with a 503 and no provider call', async (_label, arrange) => {
    arrange();
    const m = await load(openEnv);
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [PLACES, GEOCODE]))(post({ attempt_id: attempt(1) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'usage_control_unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('the burst guard and the duplicate guard also fail closed', async () => {
    const m = await load(openEnv);
    const handler = vi.fn(calls(m, [PLACES]));
    mocks.limit.mockResolvedValueOnce({ available: false, allowed: false, remaining: 0, retryAfter: 60 });
    expect((await m.withStagingProviderControls('resolve-place', handler)(post({ attempt_id: attempt(1) }))).status).toBe(503);
    mocks.limit.mockResolvedValueOnce({ available: true, allowed: true, remaining: 5, retryAfter: 0 })
      .mockResolvedValueOnce({ available: false, allowed: false, remaining: 0, retryAfter: 60 });
    expect((await m.withStagingProviderControls('resolve-place', handler)(post({ attempt_id: attempt(2) }))).status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a metadata-only request needs no allowance check, so it does not depend on the claim function', async () => {
    mocks.rpc.mockRejectedValue(new Error('connection refused'));
    const m = await load(openEnv, 'EXTRACT_VENUE_META');
    expect((await m.withStagingProviderControls('extract-venue-meta', calls(m, [PAGE], {}))(post({ url: PAGE, attempt_id: attempt(1) }))).status).toBe(200);
  });
});

describe('the five-second duplicate guard', () => {
  const guardCalls = () => mocks.limit.mock.calls.filter(([bucket]) => bucket === 'staging-duplicate');

  it('refuses an identical request from the same user and attempt, without a second handler run or claim', async () => {
    const m = await load(openEnv);
    const handler = vi.fn(calls(m, [PLACES]));
    const wrapped = m.withStagingProviderControls('resolve-place', handler);
    expect((await wrapped(post({ verify: true, name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(200);
    const second = await wrapped(post({ name: 'Cafe', attempt_id: attempt(1), verify: true }));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'request_in_progress', retry_after_seconds: 3 });
    expect(handler).toHaveBeenCalledOnce();
    expect(db.claims()).toHaveLength(1);
    expect(db.rows.get(USER + ':' + attempt(1))?.requests).toBe(1);
  });

  it('lets different requests through: other content, other attempt, other user, other function', async () => {
    const m = await load(openEnv);
    const handler = vi.fn(calls(m, [PLACES]));
    const wrapped = m.withStagingProviderControls('resolve-place', handler);
    expect((await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(200);
    expect((await wrapped(post({ name: 'Other cafe', attempt_id: attempt(1) }))).status).toBe(200);
    expect((await wrapped(post({ name: 'Cafe', attempt_id: attempt(2) }))).status).toBe(200);
    mocks.auth.mockResolvedValue({ ok: true, user: { id: OTHER } });
    expect((await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(200);
    mocks.auth.mockResolvedValue({ ok: true, user: { id: USER } });
    const ai = await load(openEnv, 'AI_PROXY');
    expect((await ai.withStagingProviderControls('ai-proxy', ok)(post({ purpose: 'extract', name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(4);
  });

  it('allows the same request again once the window has passed', async () => {
    const m = await load(openEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', calls(m, [PLACES]));
    expect((await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(200);
    expect((await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(409);
    window.reset();
    expect((await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }))).status).toBe(200);
  });

  it('keys the guard to the user and request, one per five seconds', async () => {
    const m = await load(openEnv);
    await m.withStagingProviderControls('resolve-place', ok)(post({ attempt_id: attempt(1) }));
    const [bucket, subject, limit, seconds, options] = guardCalls()[0];
    expect([bucket, limit, seconds, options]).toEqual(['staging-duplicate', 1, 5, { failClosed: true }]);
    expect(subject).toMatch(new RegExp('^' + USER + ':[0-9a-f]{64}$'));
  });

  it('counts a refused duplicate against the burst guard only, never the allowance', async () => {
    const m = await load(openEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', calls(m, [PLACES]));
    await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }));
    await wrapped(post({ name: 'Cafe', attempt_id: attempt(1) }));
    expect(db.counted()).toBe(1);
    expect(mocks.limit.mock.calls.filter(([bucket]) => bucket === 'staging-provider-entry')).toHaveLength(2);
  });
});

describe('the burst guard and settings', () => {
  it('allows 30 requests a minute per user by default, failing closed', async () => {
    const m = await load(openEnv);
    await m.withStagingProviderControls('resolve-place', ok)(post({ attempt_id: attempt(1) }));
    expect(mocks.limit).toHaveBeenCalledWith('staging-provider-entry', USER, 30, 60, { failClosed: true });
  });

  it('refuses the 31st request in a minute with a wait, before the handler and the allowance', async () => {
    const m = await load(openEnv);
    const handler = vi.fn(ok);
    const wrapped = m.withStagingProviderControls('resolve-place', handler);
    for (let i = 1; i <= 30; i++) expect((await wrapped(post({ n: i, attempt_id: attempt(1) }))).status).toBe(200);
    const refused = await wrapped(post({ n: 31, attempt_id: attempt(1) }));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ code: 'user_rate_limit', retry_after_seconds: 3 });
    expect(handler).toHaveBeenCalledTimes(30);
  });

  it('passes the configured allowance rules to the database', async () => {
    const m = await load({ ...openEnv, STAGING_TESTING_ATTEMPTS: '5', STAGING_TESTING_WINDOW_SECONDS: '600', STAGING_ATTEMPT_MAX_REQUESTS: '4', STAGING_OPEN_REQUESTS_PER_MINUTE: '10' });
    await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ attempt_id: attempt(1) }));
    expect(db.claims()[0]).toMatchObject({ p_limit: 5, p_window_seconds: 600, p_max_requests: 4 });
    expect(mocks.limit).toHaveBeenCalledWith('staging-provider-entry', USER, 10, 60, { failClosed: true });
  });

  it.each([
    ['STAGING_TESTING_ATTEMPTS', '0'], ['STAGING_TESTING_ATTEMPTS', '101'], ['STAGING_TESTING_WINDOW_SECONDS', '59'],
    ['STAGING_TESTING_WINDOW_SECONDS', '86401'], ['STAGING_ATTEMPT_MAX_REQUESTS', '0'], ['STAGING_ATTEMPT_MAX_REQUESTS', '51'],
    ['STAGING_OPEN_REQUESTS_PER_MINUTE', '0'], ['STAGING_OPEN_REQUESTS_PER_MINUTE', '121'], ['STAGING_TESTING_ATTEMPTS', 'many'],
  ])('refuses to run with %s=%s', async (name, value) => {
    const m = await load({ ...openEnv, [name]: value });
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ attempt_id: attempt(1) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'staging_configuration_invalid' });
    expect(db.claims()).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('failed providers and retries', () => {
  it('counts an attempt whose provider call failed, but retries of it are free', async () => {
    const m = await load(openEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', calls(m, [PLACES]));
    vi.mocked(fetch).mockResolvedValueOnce(new Response('x', { status: 500 }));
    const failed = await wrapped(post({ verify: true, attempt_id: attempt(1) }));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: 'provider_unavailable' });
    window.reset();
    expect((await wrapped(post({ verify: true, attempt_id: attempt(1) }))).status).toBe(200);
    expect(db.counted()).toBe(1);
    expect(db.log.map((entry) => entry.result.counted)).toEqual([true, false]);
  });

  it('reports each provider failure as a generic provider error, not as an allowance problem', async () => {
    const m = await load(openEnv);
    for (const bad of [new Response('x', { status: 500 }), new Response('<<>>', { status: 200 }), Response.json({ error: 'quota' })]) {
      vi.mocked(fetch).mockResolvedValueOnce(bad);
      window.reset();
      const response = await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ attempt_id: attempt(1) }));
      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: 'provider_unavailable' });
    }
  });

  it('never reports a refused retry as a new attempt in the log', async () => {
    const m = await load(openEnv);
    const wrapped = m.withStagingProviderControls('resolve-place', calls(m, [PLACES]));
    for (let i = 0; i < 3; i++) { window.reset(); await wrapped(post({ attempt_id: attempt(1) })); }
    expect(db.log.filter((entry) => entry.result.counted).length).toBe(1);
  });
});

describe('concurrent requests', () => {
  const requests = (m: Module, count: number, attemptFor: (i: number) => string, user = USER) => Promise.all(
    Array.from({ length: count }, (_, i) => {
      mocks.auth.mockResolvedValue({ ok: true, user: { id: user } });
      return m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ n: i, attempt_id: attemptFor(i) }));
    }));

  it('25 simultaneous new attempts from one user: exactly 20 are admitted, 5 refused with the wait', async () => {
    const m = await load(openEnv);
    const responses = await requests(m, 25, (i) => attempt(100 + i));
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
    expect(db.counted()).toBe(20);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(20);
  });

  it('15 simultaneous requests of one attempt: exactly 12 are admitted, 3 refused, one allowance used', async () => {
    const m = await load(openEnv);
    const responses = await requests(m, 15, () => attempt(7));
    const bodies = await Promise.all(responses.map(async (r) => ({ status: r.status, body: r.status === 200 ? null : await r.json() })));
    expect(bodies.filter((b) => b.status === 200)).toHaveLength(12);
    expect(bodies.filter((b) => b.status === 429 && b.body.code === 'attempt_request_limit')).toHaveLength(3);
    expect(db.counted()).toBe(1);
    expect(db.rows.get(USER + ':' + attempt(7))?.requests).toBe(12);
  });

  it('two users at the same time do not use each other\'s allowance', async () => {
    const m = await load(openEnv);
    const [a, b] = await Promise.all([requests(m, 20, (i) => attempt(200 + i), USER), requests(m, 20, (i) => attempt(300 + i), OTHER)]);
    expect([...a, ...b].every((r) => r.status === 200)).toBe(true);
    expect(db.counted(USER)).toBe(20);
    expect(db.counted(OTHER)).toBe(20);
  });
});

describe('legacy mode is untouched by open mode', () => {
  it('still uses the test-account list and the ledger when the setting is off, ignoring attempt ids', async () => {
    const m = await load({ ...openEnv, STAGING_PROVIDER_ACCESS: undefined, STAGING_PROVIDER_USERS: USER, STAGING_PROVIDER_CAMPAIGN: 'camp_1' });
    const response = await m.withStagingProviderControls('resolve-place', calls(m, [PLACES]))(post({ verify: true, attempt_id: attempt(1) }));
    expect(response.status).toBe(200);
    expect(ledgerCalls().map(([, args]) => (args as { p_action: string }).p_action)).toEqual(['start', 'call', 'finish']);
    expect(db.claims()).toHaveLength(0);
  });

  it('keeps the old six-a-minute limit in legacy mode', async () => {
    const m = await load({ ...openEnv, STAGING_PROVIDER_ACCESS: undefined, STAGING_PROVIDER_USERS: USER, STAGING_PROVIDER_CAMPAIGN: 'camp_1' });
    await m.withStagingProviderControls('resolve-place', ok)(post({ a: 1 }));
    expect(mocks.limit).toHaveBeenCalledWith('staging-provider-entry', USER, 6, 60, { failClosed: true });
  });
});
