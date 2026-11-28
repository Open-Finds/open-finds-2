import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  describeLink, foundByFrom, likeRate, percent, recordAiSaveResult, rightFirstTimeRate, summarize, testSetRows, verdictOf,
  type AiSaveResult, type AiSaveResultInput,
} from './aiSaveResults';

const db = vi.hoisted(() => ({ session: { user: { id: 'user-1' } } as { user: { id: string } } | null, upsert: vi.fn(), select: vi.fn() }));
vi.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: db.session } }) },
    from: () => ({ upsert: db.upsert, select: db.select }),
  },
}));

beforeEach(() => { db.session = { user: { id: 'user-1' } }; db.upsert.mockReset().mockResolvedValue({ error: null }); });

const input: AiSaveResultInput = {
  attemptId: 'a1000000-0000-4000-8000-000000000001', platform: 'tiktok', postKind: 'video', link: 'https://vt.tiktok.com/ZSx/',
  outcome: 'confirmed', foundBy: 'shared_text', venueName: 'Ocean Royale', edited: false, usedNoneOfThese: false, usedPastedCaption: false, durationMs: 14200,
};

const row = (over: Partial<AiSaveResult> = {}): AiSaveResult => ({
  user_id: 'u', attempt_id: crypto.randomUUID(), created_at: '2026-11-25T10:00:00Z', updated_at: '2026-11-25T10:00:00Z',
  platform: 'tiktok', post_kind: 'video', link: 'https://www.tiktok.com/@a/video/1', outcome: 'confirmed', found_by: 'caption', venue_name: 'Ocean Royale',
  venue_count: 1, saved_venue_id: null, edited: false, used_none_of_these: false, used_pasted_caption: false, duration_ms: 9000, rating: null, reason: null, note: null, ...over,
});

describe('describeLink', () => {
  it.each([
    ['https://www.tiktok.com/@a/video/123', 'tiktok', 'video'],
    ['https://www.tiktok.com/@a/photo/456', 'tiktok', 'photo'],
    ['https://vt.tiktok.com/ZSsFTaXA9/', 'tiktok', 'unknown'],
    ['https://www.instagram.com/reel/abc/', 'instagram', 'video'],
    ['https://www.instagram.com/p/abc/', 'instagram', 'post'],
    ['https://www.instagram.com/someone/reel/abc/', 'instagram', 'video'],
    ['https://youtu.be/xyz', 'youtube', 'video'],
    ['https://maps.app.goo.gl/abc', 'maps', 'unknown'],
    ['https://www.google.com/maps/place/x', 'maps', 'unknown'],
    ['https://example.com/best-cafes', 'website', 'unknown'],
    ['https://nottiktok.com/x', 'website', 'unknown'],
    ['not a link', 'other', 'unknown'],
  ])('%s is %s %s', (link, platform, postKind) => expect(describeLink(link)).toEqual({ platform, postKind }));
});

describe('foundByFrom', () => {
  it('says where the caption came from', () => {
    expect(foundByFrom({ oembedTitle: 'Best yum cha' }, '', false)).toBe('caption');
    expect(foundByFrom({ oembedTitle: 'Best yum cha' }, 'Best yum cha', false)).toBe('shared_text');
    expect(foundByFrom({ ogDescription: 'x' }, 'x', true)).toBe('pasted_caption');
    expect(foundByFrom(undefined, '', false)).toBe('ai');
    expect(foundByFrom({ oembedTitle: '  ' }, 'something', false)).toBe('ai');
  });
});

describe('recordAiSaveResult', () => {
  it('writes the row for the signed-in person, keyed by their attempt so a rating updates it', async () => {
    await expect(recordAiSaveResult(input)).resolves.toBe(true);
    const [payload, options] = db.upsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'user_id,attempt_id' });
    expect(payload).toMatchObject({
      user_id: 'user-1', attempt_id: input.attemptId, platform: 'tiktok', post_kind: 'video', outcome: 'confirmed', found_by: 'shared_text',
      venue_name: 'Ocean Royale', venue_count: 1, edited: false, used_none_of_these: false, used_pasted_caption: false, duration_ms: 14200,
    });
  });

  it('leaves out what it was not given, so a later write cannot clear an earlier rating', async () => {
    await recordAiSaveResult(input);
    expect(db.upsert.mock.calls[0][0].rating).toBeUndefined();
    await recordAiSaveResult({ ...input, rating: 'like' });
    expect(db.upsert.mock.calls[1][0].rating).toBe('like');
  });

  it('keeps a reason and a note only for a thumbs down, and trims them', async () => {
    await recordAiSaveResult({ ...input, rating: 'like', reason: 'wrong_venue', note: 'x' });
    expect(db.upsert.mock.calls[0][0]).toMatchObject({ reason: undefined, note: undefined });
    await recordAiSaveResult({ ...input, rating: 'dislike', reason: 'wrong_venue', note: `  ${'n'.repeat(300)}  ` });
    expect(db.upsert.mock.calls[1][0].reason).toBe('wrong_venue');
    expect(db.upsert.mock.calls[1][0].note).toHaveLength(200);
  });

  it('keeps numbers and text inside what the database accepts', async () => {
    await recordAiSaveResult({ ...input, venueCount: 99, durationMs: 99_999_999.7, venueName: 'v'.repeat(500), link: 'https://x.test/' + 'a'.repeat(3000) });
    const payload = db.upsert.mock.calls[0][0];
    expect(payload.venue_count).toBe(20);
    expect(payload.duration_ms).toBe(3_600_000);
    expect(payload.venue_name).toHaveLength(200);
    expect(payload.link).toHaveLength(2048);
  });

  it('does nothing when signed out, and never throws when the database refuses or fails', async () => {
    db.session = null;
    await expect(recordAiSaveResult(input)).resolves.toBe(false);
    expect(db.upsert).not.toHaveBeenCalled();
    db.session = { user: { id: 'user-1' } };
    db.upsert.mockResolvedValueOnce({ error: { code: '54000', message: 'cap' } });
    await expect(recordAiSaveResult(input)).resolves.toBe(false);
    db.upsert.mockRejectedValueOnce(new Error('offline'));
    await expect(recordAiSaveResult(input)).resolves.toBe(false);
  });
});

describe('the success rate', () => {
  it('counts the thumbs first, then (as an estimate) saves that needed no help', () => {
    expect(verdictOf(row({ rating: 'like', edited: true }))).toBe('right');
    expect(verdictOf(row({ rating: 'dislike' }))).toBe('wrong');
    expect(verdictOf(row())).toBe('right');
    expect(verdictOf(row({ outcome: 'chosen' }))).toBe('right');
    expect(verdictOf(row({ edited: true }))).toBe('helped');
    expect(verdictOf(row({ used_none_of_these: true }))).toBe('helped');
    expect(verdictOf(row({ used_pasted_caption: true }))).toBe('helped');
    expect(verdictOf(row({ outcome: 'unconfirmed' }))).toBe('helped');
    expect(verdictOf(row({ outcome: 'manual' }))).toBe('helped');
    expect(verdictOf(row({ outcome: 'not_saved' }))).toBe('unknown');
    expect(verdictOf(row({ outcome: 'multiple' }))).toBe('unknown');
  });

  it('summarises by site and kind, and by how the venue was found', () => {
    const rows = [
      row({ rating: 'like' }), row({ rating: 'dislike', found_by: 'ai' }), row(), row({ edited: true }),
      row({ platform: 'instagram', post_kind: 'video' }), row({ platform: 'website', post_kind: 'unknown', found_by: 'ai', outcome: 'unconfirmed' }),
    ];
    const summary = summarize(rows);
    expect(summary.all).toMatchObject({ total: 6, likes: 1, dislikes: 1, right: 3, wrong: 1, helped: 2 });
    expect(likeRate(summary.all)).toBe(50);
    expect(rightFirstTimeRate(summary.all)).toBe(50);
    expect(Object.keys(summary.byGroup).sort()).toEqual(['instagram video', 'tiktok video', 'website']);
    expect(summary.byGroup['tiktok video']).toMatchObject({ total: 4, likes: 1, dislikes: 1 });
    expect(summary.byFoundBy.ai.total).toBe(2);
  });

  it('gives no percentage when there is nothing to divide by', () => {
    expect(percent(0, 0)).toBeNull();
    expect(likeRate(summarize([row()]).all)).toBeNull();
    expect(percent(1, 3)).toBe(33);
  });
});

describe('testSetRows', () => {
  it('turns each thumbs-down with a link into a row for the test-set file, and quotes what needs it', () => {
    const lines = testSetRows([
      row({ rating: 'like' }),
      row({ rating: 'dislike', reason: 'wrong_venue', note: 'It saved "Oyama Ramen", not Ocean Royale', venue_name: 'Oyama Ramen', link: 'https://vt.tiktok.com/ZSx/' }),
      row({ rating: 'dislike', link: null }),
      row({ rating: 'dislike', reason: null, platform: 'instagram', link: 'https://www.instagram.com/reel/a/' }),
    ], 22);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('22,https://vt.tiktok.com/ZSx/,tiktok,wrong_venue,,,,"2026-11-25 saved Oyama Ramen (confirmed, caption)","It saved ""Oyama Ramen"", not Ocean Royale"');
    expect(lines[1].startsWith('23,https://www.instagram.com/reel/a/,instagram,disliked,')).toBe(true);
  });
});
