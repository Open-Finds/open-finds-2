/**
 * What a signed-out visitor was doing on a venue page when they were asked to
 * log in, so it carries on afterwards. Kept in localStorage because Google
 * and Facebook sign-in leave the app and come back to "/".
 */
export type VenueAction = 'save' | 'plan';
const KEY = 'unsaved:pending-venue';
const MAX_AGE = 60 * 60 * 1000;

export function rememberVenueAction(id: string, action: VenueAction | null) {
  try { localStorage.setItem(KEY, JSON.stringify({ id, action, at: Date.now() })); } catch { /* private mode */ }
}

/** The waiting venue and action, if fresh. Leaves it in place. */
export function pendingVenueAction(): { id: string; action: VenueAction | null } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!raw || typeof raw.id !== 'string' || Date.now() - raw.at > MAX_AGE) return null;
    return { id: raw.id, action: raw.action === 'save' || raw.action === 'plan' ? raw.action : null };
  } catch { return null; }
}

export function clearVenueAction() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
