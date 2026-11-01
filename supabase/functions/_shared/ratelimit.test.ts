import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('./auth.ts', () => ({ serviceClient: () => ({ rpc }) }));
import { consumeRateLimit } from './ratelimit';

beforeEach(() => { rpc.mockReset(); });
describe('security rate limit failures', () => {
  it.each([{ data: null, error: { message: 'offline' } }, { data: [], error: null },
    { data: { remaining: 20 }, error: null }])('fails closed on invalid storage result', async (result) => {
    rpc.mockResolvedValue(result);
    expect(await consumeRateLimit('test', 'user', 3, 60, { failClosed: true }))
      .toMatchObject({ allowed: false, available: false });
  });
  it('fails closed on an exception', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    expect(await consumeRateLimit('test', 'user', 3, 60, { failClosed: true }))
      .toMatchObject({ allowed: false, available: false });
  });
  it('retains the explicit availability policy for other existing callers', async () => {
    rpc.mockRejectedValue(new Error('offline'));
    expect(await consumeRateLimit('maps', 'user', 3, 60)).toMatchObject({ allowed: true, available: false });
  });
  it('passes a real quota denial through', async () => {
    rpc.mockResolvedValue({ data: [{ allowed: false, remaining: 0, retry_after: 10 }], error: null });
    expect(await consumeRateLimit('test', 'user', 3, 60, { failClosed: true }))
      .toEqual({ allowed: false, remaining: 0, retryAfter: 10, available: true });
  });
});
