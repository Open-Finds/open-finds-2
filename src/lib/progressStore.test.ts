import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRESS_REUSE_MS, readProgress, writeProgress } from './progressStore';

const session = vi.hoisted(() => ({ id: 'user-1' }));
vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: session.id } } } }) } },
}));

const link = 'https://www.instagram.com/reel/abc/';
const candidate = { name: 'Cafe', address: '1 Test St, Sydney', type: 'food' as const, order: 1, tags: ['pizza'] };

beforeEach(() => { localStorage.clear(); session.id = 'user-1'; });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('AI Save progress kept for a link', () => {
  it('picks up where it stopped when the same link is shared again', async () => {
    await writeProgress(link, { candidates: [candidate], searched: true, attemptId: 'attempt', checkedSaved: true });
    const back = await readProgress(link);
    expect(back).toMatchObject({ candidates: [candidate], searched: true });
    // The attempt id has its own store, and "saved" is looked up again on return.
    expect(back).not.toHaveProperty('attemptId');
    expect(back).not.toHaveProperty('checkedSaved');
  });

  it('forgets it after 20 minutes', async () => {
    vi.useFakeTimers();
    await writeProgress(link, { candidates: [candidate] });
    vi.advanceTimersByTime(PROGRESS_REUSE_MS - 1000);
    expect(await readProgress(link)).toBeDefined();
    vi.advanceTimersByTime(2000);
    expect(await readProgress(link)).toBeUndefined();
  });

  it("keeps one account's progress away from another, and one link's from another", async () => {
    await writeProgress(link, { candidates: [candidate] });
    expect(await readProgress(link + 'other')).toBeUndefined();
    session.id = 'user-2';
    expect(await readProgress(link)).toBeUndefined();
  });

  it('stores nothing when there is nothing worked out yet', async () => {
    await writeProgress(link, { checkedSaved: true });
    expect(localStorage.length).toBe(0);
  });

  it('drops the bulky page text when the progress is large, and nothing when it is still too large', async () => {
    const metadata = { platform: 'website', contentType: 'website', url: link, fetched: true, ogDescription: 'caption', rawText: 'x'.repeat(70_000), jsonLd: null, oembedHtml: null } as never;
    await writeProgress(link, { candidates: [candidate], identification: { metadata } });
    const back = await readProgress(link);
    expect(back?.identification?.metadata).toMatchObject({ ogDescription: 'caption', rawText: null });
    await writeProgress(link + 'big', { candidates: Array.from({ length: 300 }, () => ({ ...candidate, address: 'y'.repeat(300) })) });
    expect(await readProgress(link + 'big')).toBeUndefined();
  });

  it('never fails when storage is unavailable or holds something unreadable', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    await expect(writeProgress(link, { candidates: [candidate] })).resolves.toBeUndefined();
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue('not json');
    await expect(readProgress(link)).resolves.toBeUndefined();
  });
});
