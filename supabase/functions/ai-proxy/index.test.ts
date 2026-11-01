import { beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../_tests/database';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), limit: vi.fn() }));
vi.mock('../_shared/auth.ts', () => ({ requireUser: mocks.auth, serviceClient: mocks.db }));
vi.mock('../_shared/ratelimit.ts', () => ({ consumeRateLimit: mocks.limit }));
let handler: (req: Request) => Promise<Response>;
const user = '11111111-1111-4111-8111-111111111111';
let db: ReturnType<typeof database>;
const request = (body: Record<string, unknown>) => handler(new Request('http://localhost/ai', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const messages = [{ role: 'user', content: 'Find a cafe' }];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  db = database({ profiles: [{ id: user, subscription_tier: 'free' }], app_settings: [] });
  mocks.db.mockReturnValue(db);
  mocks.auth.mockResolvedValue({ ok: true, user: { id: user } });
  mocks.limit.mockResolvedValue({ available: true, allowed: true, remaining: 2, retryAfter: 0 });
  vi.stubGlobal('Deno', { env: { get: () => 'fake-openrouter-key' }, serve: (fn: typeof handler) => { handler = fn; } });
  await import('./index');
});

describe('AI endpoint quota boundary', () => {
  it.each([undefined, null, '', 'other'])('rejects omitted/invalid purpose %s without billing', async (purpose) => {
    expect((await request({ messages, purpose })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated callers', async () => {
    mocks.auth.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' });
    expect((await request({ messages, purpose: 'extract' })).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['extract', 'discover'])('enforces both shared hourly and free daily limits for %s', async (purpose) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ choices: [{ message: { content: 'ok' } }] }));
    expect((await request({ messages, purpose })).status).toBe(200);
    expect(mocks.limit).toHaveBeenNthCalledWith(1, 'ai-total', user, 40, 3600, { failClosed: true });
    expect(mocks.limit).toHaveBeenNthCalledWith(2, 'ai-' + purpose, user, 3, 86400, { failClosed: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('blocks an exhausted daily allowance before upstream billing', async () => {
    mocks.limit.mockResolvedValueOnce({ available: true, allowed: true })
      .mockResolvedValueOnce({ available: true, allowed: false, retryAfter: 50 });
    const response = await request({ messages, purpose: 'discover' });
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'daily_limit' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('credits cannot bypass the shared hourly ceiling', async () => {
    mocks.limit.mockResolvedValue({ available: true, allowed: false, retryAfter: 50 });
    expect((await request({ messages, purpose: 'extract', use_credit: true })).status).toBe(429);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed if quota storage is unavailable', async () => {
    mocks.limit.mockResolvedValue({ available: false, allowed: false });
    expect((await request({ messages, purpose: 'extract' })).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves an earned-credit request and refunds upstream failure', async () => {
    mocks.limit.mockResolvedValueOnce({ available: true, allowed: true })
      .mockResolvedValueOnce({ available: true, allowed: false });
    db.rpc.mockResolvedValue({ data: 0, error: null });
    vi.mocked(fetch).mockResolvedValue(new Response('upstream failure', { status: 502 }));
    expect((await request({ messages, purpose: 'extract', use_credit: true })).status).toBe(502);
    expect(db.rpc).toHaveBeenCalledWith('spend_credit', { p_user: user, p_reason: 'extract' });
    expect(db.rpc).toHaveBeenCalledWith('refund_credit', { p_user: user });
  });
  it('rejects an expensive caller-selected model', async () => {
    expect((await request({ messages, purpose: 'extract', model: 'unapproved-model' })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
