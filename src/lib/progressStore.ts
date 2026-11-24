import { supabase } from './supabase';
import { fingerprint } from './attemptId';
import type { SharedVenueProgress } from './aiSave';

/**
 * What AI Save already worked out for a link, kept on this phone for a short while.
 *
 * Switching to Google Maps to check a venue closes the share overlay, and sharing the same
 * link again used to start over (and spend the AI and Google calls again). With this, sharing
 * the same link again within 20 minutes picks up where it stopped. It is the same account only,
 * never sent anywhere, and every failure here is silent: storage may be unavailable.
 */
export const PROGRESS_REUSE_MS = 20 * 60 * 1000;
const PREFIX = 'unsaved:ai-save-progress:';
const SIZE_LIMIT = 60_000;

async function storageKey(link: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return `${PREFIX}${session?.user.id ?? 'signed-out'}:${fingerprint(link)}`;
}

/** Page text is the bulky part; the caption, handle and location (what verification needs) are kept. */
function lighter(progress: SharedVenueProgress): SharedVenueProgress {
  const metadata = progress.identification?.metadata;
  if (!metadata) return progress;
  return { ...progress, identification: { ...progress.identification, metadata: { ...metadata, rawText: null, jsonLd: null, oembedHtml: null } } };
}

export async function writeProgress(link: string, progress: SharedVenueProgress): Promise<void> {
  try {
    if (!progress.candidates && !progress.rows && !progress.verified && !progress.identification?.metadata) return;
    // The attempt id has its own, shorter-lived store; "saved" is looked up again on return.
    const rest: SharedVenueProgress = { ...progress };
    delete rest.attemptId;
    delete rest.checkedSaved;
    let value = JSON.stringify({ at: Date.now(), progress: rest });
    if (value.length > SIZE_LIMIT) value = JSON.stringify({ at: Date.now(), progress: lighter(rest) });
    if (value.length > SIZE_LIMIT) return;
    localStorage.setItem(await storageKey(link), value);
  } catch { /* storage unavailable or full: AI Save just starts over next time */ }
}

export async function readProgress(link: string): Promise<SharedVenueProgress | undefined> {
  try {
    const stored = JSON.parse(localStorage.getItem(await storageKey(link)) ?? 'null') as { at?: unknown; progress?: SharedVenueProgress } | null;
    if (!stored || typeof stored.at !== 'number' || Date.now() - stored.at > PROGRESS_REUSE_MS || !stored.progress) return undefined;
    return stored.progress;
  } catch {
    return undefined;
  }
}
