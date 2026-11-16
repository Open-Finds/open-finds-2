import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTEMPT_REUSE_MS, attemptIdFor, forgetAttempt } from './attemptId';

const session = vi.hoisted(() => ({ id: 'user-1' as string | undefined }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: session.id ? { user: { id: session.id } } : null } }) } },
}));

const link = 'https://www.instagram.com/reel/abc/';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => { session.id = 'user-1'; localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('attempt ids', () => {
  it('are new random UUIDs, then the same until forgotten', async () => {
    const first = await attemptIdFor(link);
    expect(first).toMatch(uuid);
    expect(await attemptIdFor(link)).toBe(first);
    await forgetAttempt(link);
    const next = await attemptIdFor(link);
    expect(next).toMatch(uuid);
    expect(next).not.toBe(first);
  });

  it('are per link and per account', async () => {
    const a = await attemptIdFor(link);
    expect(await attemptIdFor(link + '?x=1')).not.toBe(a);
    session.id = 'user-2';
    expect(await attemptIdFor(link)).not.toBe(a);
    session.id = 'user-1';
    expect(await attemptIdFor(link)).toBe(a);
  });

  it('are reused for less than the window the server accepts, with a margin', async () => {
    expect(ATTEMPT_REUSE_MS).toBeLessThan(30 * 60 * 1000);
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const first = await attemptIdFor(link);
    vi.setSystemTime(1_000_000 + ATTEMPT_REUSE_MS - 1);
    expect(await attemptIdFor(link)).toBe(first);
    vi.setSystemTime(1_000_000 + ATTEMPT_REUSE_MS);
    const later = await attemptIdFor(link);
    expect(later).not.toBe(first);
    // The new id starts its own clock.
    vi.setSystemTime(1_000_000 + ATTEMPT_REUSE_MS + 60_000);
    expect(await attemptIdFor(link)).toBe(later);
  });

  it('do not write the link into storage', async () => {
    await attemptIdFor(link);
    const stored = Object.keys(localStorage).concat(Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? '')).join(' ');
    expect(stored).not.toContain('instagram');
    expect(stored).not.toContain('abc');
  });

  it('ignore damaged storage and start a new attempt', async () => {
    const first = await attemptIdFor(link);
    const key = Object.keys(localStorage)[0];
    for (const damaged of ['not json', '{"id":5,"at":1}', '{"id":"x"}', 'null']) {
      localStorage.setItem(key, damaged);
      const id = await attemptIdFor(link);
      expect(id).toMatch(uuid);
      expect(id).not.toBe(first);
    }
  });

  it('still give an id when storage is unavailable, and forgetting never throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(await attemptIdFor(link)).toMatch(uuid);
    await expect(forgetAttempt(link)).resolves.toBeUndefined();
  });

  it('work when signed out, under their own key', async () => {
    session.id = undefined;
    const id = await attemptIdFor(link);
    session.id = 'user-1';
    expect(await attemptIdFor(link)).not.toBe(id);
  });
});
