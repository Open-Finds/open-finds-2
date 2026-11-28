import { supabase } from './supabase';

/**
 * AI Save results: one row per attempt, so the success rate can be tracked (table `ai_save_results`).
 * It records what AI Save did, how the venue was found, the signals that need no tap (the person edited the result, used
 * "None of these match", pasted a caption) and the person's own 👍 or 👎. The post's caption is never stored.
 * Writing a result must never get in the way of saving a venue, so every failure here is swallowed.
 */

export type Platform = 'tiktok' | 'instagram' | 'facebook' | 'youtube' | 'maps' | 'website' | 'other';
export type PostKind = 'video' | 'photo' | 'post' | 'unknown';
export type Outcome = 'confirmed' | 'chosen' | 'searched' | 'unconfirmed' | 'manual' | 'multiple' | 'not_saved';
export type FoundBy = 'caption' | 'shared_text' | 'pasted_caption' | 'ai' | 'manual';
export type Rating = 'like' | 'dislike';
export type Reason = 'wrong_venue' | 'wrong_address' | 'missing_venue' | 'other';

export const REASON_LABELS: Record<Reason, string> = {
  wrong_venue: 'Wrong venue', wrong_address: 'Wrong address', missing_venue: 'Missed a venue', other: 'Something else',
};

/** A row as the database holds it. */
export type AiSaveResult = {
  user_id: string;
  attempt_id: string;
  created_at: string;
  updated_at: string;
  platform: Platform;
  post_kind: PostKind;
  link: string | null;
  outcome: Outcome;
  found_by: FoundBy;
  venue_name: string | null;
  venue_count: number;
  saved_venue_id: string | null;
  edited: boolean;
  used_none_of_these: boolean;
  used_pasted_caption: boolean;
  duration_ms: number | null;
  rating: Rating | null;
  reason: Reason | null;
  note: string | null;
};

/** What the app sends. Fields left out are left as they are (so a later write cannot clear an earlier thumbs up). */
export type AiSaveResultInput = {
  attemptId: string;
  platform: Platform;
  postKind: PostKind;
  link?: string;
  outcome: Outcome;
  foundBy: FoundBy;
  venueName?: string;
  venueCount?: number;
  savedVenueId?: string;
  edited: boolean;
  usedNoneOfThese: boolean;
  usedPastedCaption: boolean;
  durationMs?: number;
  rating?: Rating;
  reason?: Reason;
  note?: string;
};

/** Which site a link is on, and whether it is a video, a photo post or unknown (a short link does not say). */
export function describeLink(link: string): { platform: Platform; postKind: PostKind } {
  let url: URL;
  try { url = new URL(link); } catch { return { platform: 'other', postKind: 'unknown' }; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.toLowerCase();
  const on = (domain: string) => host === domain || host.endsWith('.' + domain);
  if (on('tiktok.com')) return { platform: 'tiktok', postKind: path.includes('/photo/') ? 'photo' : path.includes('/video/') ? 'video' : 'unknown' };
  if (on('instagram.com')) return { platform: 'instagram', postKind: /^\/(?:[^/]+\/)?(?:reels?|tv)\//.test(path) ? 'video' : /^\/(?:[^/]+\/)?p\//.test(path) ? 'post' : 'unknown' };
  if (on('facebook.com') || host === 'fb.watch' || host === 'fb.me') return { platform: 'facebook', postKind: path.includes('/reel') || path.includes('/watch') || host === 'fb.watch' ? 'video' : 'unknown' };
  if (on('youtube.com') || host === 'youtu.be') return { platform: 'youtube', postKind: 'video' };
  if (host === 'maps.app.goo.gl' || (on('google.com') && path.startsWith('/maps')) || host === 'goo.gl') return { platform: 'maps', postKind: 'unknown' };
  return { platform: 'website', postKind: 'unknown' };
}

type PostText = { ogDescription?: string | null; metaDescription?: string | null; oembedTitle?: string | null } | undefined;

/** Where the caption AI Save worked from came from: the server read it, TikTok sent it with the share, or the person pasted it. */
export function foundByFrom(meta: PostText, sharedCaption: string, pasted: boolean): FoundBy {
  if (pasted) return 'pasted_caption';
  const text = [meta?.ogDescription, meta?.oembedTitle, meta?.metaDescription].find(value => !!value?.trim())?.trim();
  if (!text) return 'ai';
  return sharedCaption && sharedCaption.trim() === text ? 'shared_text' : 'caption';
}

function clip(value: string | undefined, max: number): string | undefined {
  const text = value?.trim();
  return text ? text.slice(0, max) : undefined;
}

/** Saves (or updates) this attempt's result. True when it was written; never throws. */
export async function recordAiSaveResult(input: AiSaveResultInput): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const row = {
      user_id: session.user.id,
      attempt_id: input.attemptId,
      platform: input.platform,
      post_kind: input.postKind,
      link: clip(input.link, 2048),
      outcome: input.outcome,
      found_by: input.foundBy,
      venue_name: clip(input.venueName, 200),
      venue_count: Math.max(0, Math.min(20, input.venueCount ?? 1)),
      saved_venue_id: input.savedVenueId,
      edited: input.edited,
      used_none_of_these: input.usedNoneOfThese,
      used_pasted_caption: input.usedPastedCaption,
      duration_ms: input.durationMs === undefined ? undefined : Math.max(0, Math.min(3_600_000, Math.round(input.durationMs))),
      rating: input.rating,
      reason: input.rating === 'dislike' ? input.reason : undefined,
      note: input.rating === 'dislike' ? clip(input.note, 200) : undefined,
    };
    const { error } = await supabase.from('ai_save_results').upsert(row, { onConflict: 'user_id,attempt_id' });
    if (error) { console.warn('[ai-save] result not recorded', error.code ?? error.message); return false; }
    return true;
  } catch (cause) {
    console.warn('[ai-save] result not recorded', cause);
    return false;
  }
}

/** The latest results, newest first, for the admin page (the database only lets an admin read everyone's). */
export async function fetchAiSaveResults(limit = 1000): Promise<AiSaveResult[]> {
  const { data, error } = await supabase.from('ai_save_results').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as AiSaveResult[];
}

/** How one result counts: the person's own thumb, else (an estimate) whether AI Save got it right without help. */
export type Verdict = 'right' | 'wrong' | 'helped' | 'unknown';

export function verdictOf(row: Pick<AiSaveResult, 'rating' | 'outcome' | 'edited' | 'used_none_of_these' | 'used_pasted_caption'>): Verdict {
  if (row.rating === 'like') return 'right';
  if (row.rating === 'dislike') return 'wrong';
  if (row.outcome === 'not_saved' || row.outcome === 'multiple') return 'unknown';
  if ((row.outcome === 'confirmed' || row.outcome === 'chosen') && !row.edited && !row.used_none_of_these && !row.used_pasted_caption) return 'right';
  return 'helped';
}

export type Tally = { total: number; likes: number; dislikes: number; right: number; helped: number; wrong: number; unknown: number };

const emptyTally = (): Tally => ({ total: 0, likes: 0, dislikes: 0, right: 0, helped: 0, wrong: 0, unknown: 0 });

function add(tally: Tally, row: AiSaveResult) {
  tally.total++;
  if (row.rating === 'like') tally.likes++;
  if (row.rating === 'dislike') tally.dislikes++;
  tally[verdictOf(row)]++;
}

/** The share of `part` in `whole`, as a whole percent, or null when there is nothing to divide by. */
export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** Of the results that were rated, how many were 👍. */
export const likeRate = (tally: Tally) => percent(tally.likes, tally.likes + tally.dislikes);

/** An estimate over all results: right without help, out of those that are not unknown. Includes the thumbs. */
export const rightFirstTimeRate = (tally: Tally) => percent(tally.right, tally.right + tally.helped + tally.wrong);

export type Summary = { all: Tally; byGroup: Record<string, Tally>; byFoundBy: Record<string, Tally> };

export function summarize(rows: AiSaveResult[]): Summary {
  const summary: Summary = { all: emptyTally(), byGroup: {}, byFoundBy: {} };
  for (const row of rows) {
    add(summary.all, row);
    const group = row.post_kind === 'unknown' ? row.platform : `${row.platform} ${row.post_kind}`;
    add(summary.byGroup[group] ??= emptyTally(), row);
    add(summary.byFoundBy[row.found_by] ??= emptyTally(), row);
  }
  return summary;
}

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * The 👎 results as rows for docs/save-venues-test-set.csv (id,link,platform,case_type,expected_venues,
 * expected_location_from_founder,category,seen_on_staging,notes), so a failure becomes a test case. The expected venue
 * is left for the founder to fill in.
 */
export function testSetRows(rows: AiSaveResult[], firstId = 1): string[] {
  return rows.filter(row => row.rating === 'dislike' && row.link).map((row, index) => [
    String(firstId + index), row.link ?? '', row.platform, row.reason ?? 'disliked', '', '', '',
    `${row.created_at.slice(0, 10)} saved ${row.venue_name ?? 'nothing'} (${row.outcome}, ${row.found_by})`,
    row.note ?? '',
  ].map(csvCell).join(','));
}
