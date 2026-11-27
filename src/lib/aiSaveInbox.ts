import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { UserFacingError } from './openai';
import type { SharedVenueProgress, SharedVenueResult } from './aiSave';

/**
 * AI Save results waiting for the user to confirm, shown under Notifications. Kept on this phone, per account, with no time
 * limit: an entry goes when its venue is saved or the user removes it. The share screen and the app are separate screens of
 * the same app, so they read the same storage. Nothing is saved to My Venues from here without the user's tap. Every storage
 * failure is silent: AI Save still works without the list.
 */
export type AiSaveItem = {
  link: string;
  sharedText?: string;
  /** When the search started. */
  at: number;
  /** False while searching (or when the search was cut off before it finished). */
  finished: boolean;
  result?: SharedVenueResult;
  progress?: SharedVenueProgress;
  /** The wording of a problem the user can read, kept because an error object cannot be stored. */
  message?: string;
};

/** Android lets a search run in the background for about three minutes; after that an unfinished one has stopped. */
export const SEARCH_LIMIT_MS = 3.5 * 60 * 1000;
const PREFIX = 'unsaved:ai-save-inbox:';
const CHANGED = 'ai-save-inbox';

export function readInbox(owner: string): AiSaveItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(PREFIX + owner) ?? '[]');
    return Array.isArray(items) ? items.filter(item => typeof item?.link === 'string' && typeof item.at === 'number') : [];
  } catch {
    return [];
  }
}

async function change(link: string, next?: AiSaveItem): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const rest = readInbox(session.user.id).filter(item => item.link !== link);
    localStorage.setItem(PREFIX + session.user.id, JSON.stringify(next ? [next, ...rest] : rest));
    window.dispatchEvent(new Event(CHANGED));
  } catch { /* storage unavailable or full */ }
}

/** Page text is the bulky part and is not needed to show or confirm a result. */
function lighter(progress: SharedVenueProgress): SharedVenueProgress {
  const kept: SharedVenueProgress = { ...progress };
  // An attempt id expires after 30 minutes, and "already saved" is looked up again.
  delete kept.attemptId;
  delete kept.checkedSaved;
  const metadata = kept.identification?.metadata;
  if (metadata) kept.identification = { ...kept.identification, metadata: { ...metadata, rawText: null, jsonLd: null, oembedHtml: null } };
  return kept;
}

export function putInInbox(item: AiSaveItem): Promise<void> {
  const cause = item.result?.issue?.cause;
  return change(item.link, {
    ...item,
    progress: item.progress && lighter(item.progress),
    result: item.result?.issue ? { ...item.result, issue: { ...item.result.issue, cause: undefined } } : item.result,
    message: cause instanceof UserFacingError ? cause.message : item.message,
  });
}

export const removeFromInbox = (link: string): Promise<void> => change(link);

/** The stored result as AI Save first returned it. */
export function storedResult({ result, message }: AiSaveItem): SharedVenueResult | undefined {
  if (!result?.issue || !message) return result;
  return { ...result, issue: { ...result.issue, cause: new UserFacingError(message) } };
}

export function describeItem(item: AiSaveItem, now = Date.now()): { title: string; body: string; ready: boolean } {
  if (!item.finished) {
    return now - item.at < SEARCH_LIMIT_MS
      ? { title: 'AI Save is searching', body: 'The result will appear here.', ready: false }
      : { title: "AI Save didn't finish", body: 'Tap to search again.', ready: true };
  }
  const { venue, rows, choices } = item.result ?? {};
  if (venue) return { title: venue.name, body: 'Ready to check and save.', ready: true };
  if (rows?.length) return { title: `${rows.length} venues found`, body: 'Ready to choose and save.', ready: true };
  if (choices?.length) return { title: 'Confirm the venue', body: 'Choose the right place to save.', ready: true };
  // The post names a venue that still needs checking: say so, not "No venue found".
  const named = item.result?.issue?.reason === 'needs_review' ? item.result.candidates?.[0] : undefined;
  if (named) return { title: named.name, body: 'Check the details, then save.', ready: true };
  return { title: 'No venue found', body: 'Tap to search for it yourself.', ready: true };
}

export function useAiSaveInbox(owner: string | undefined): AiSaveItem[] {
  const read = useCallback(() => (owner ? readInbox(owner) : []), [owner]);
  const [items, setItems] = useState(read);
  useEffect(() => {
    const refresh = () => setItems(read());
    refresh();
    // The share screen writes from outside this screen, so also look again on return and every so often.
    window.addEventListener(CHANGED, refresh);
    window.addEventListener('storage', refresh);
    document.addEventListener('visibilitychange', refresh);
    const timer = setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener(CHANGED, refresh);
      window.removeEventListener('storage', refresh);
      document.removeEventListener('visibilitychange', refresh);
      clearInterval(timer);
    };
  }, [read]);
  return items;
}
