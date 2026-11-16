import { supabase } from './supabase';

/**
 * One AI Save attempt is one id, sent with every request it makes, so the
 * server counts it once however many functions it calls.
 *
 * The id outlives the dialog: closing it by accident and opening the same link
 * again continues the same attempt. It is forgotten when the venue is saved or
 * the server says it is spent, so the next intentional save is a new attempt.
 *
 * The server refuses an id after 30 minutes, so one is reused for less than
 * that. Browser storage may be unavailable; then the attempt lasts as long as
 * its dialog.
 */
export const ATTEMPT_REUSE_MS = 25 * 60 * 1000;
const PREFIX = 'unsaved:ai-save-attempt:';

/** A short, stable fingerprint of the link, so the link itself is not written into storage keys. */
function fingerprint(link: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < link.length; i++) {
    hash ^= link.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function storageKey(link: string): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return `${PREFIX}${session?.user.id ?? 'signed-out'}:${fingerprint(link)}`;
}

/** The attempt id for this link: the one in progress, or a new one. */
export async function attemptIdFor(link: string): Promise<string> {
  const key = await storageKey(link);
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? 'null') as { id?: unknown; at?: unknown } | null;
    if (stored && typeof stored.id === 'string' && typeof stored.at === 'number' && Date.now() - stored.at < ATTEMPT_REUSE_MS) {
      return stored.id;
    }
  } catch { /* unreadable or unavailable storage: start a new attempt */ }
  const id = crypto.randomUUID();
  try {
    localStorage.setItem(key, JSON.stringify({ id, at: Date.now() }));
  } catch { /* the attempt lasts as long as its dialog */ }
  return id;
}

/** Ends the attempt for this link: the next one starts fresh. */
export async function forgetAttempt(link: string): Promise<void> {
  try {
    localStorage.removeItem(await storageKey(link));
  } catch { /* nothing stored, or storage unavailable */ }
}
