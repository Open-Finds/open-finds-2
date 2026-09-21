/**
 * Draft persistence for the plan wizard.
 *
 * The wizard is a single component holding its progress in React state. On a
 * phone, tapping "check the vibes" opens Instagram, the browser backgrounds,
 * and iOS routinely evicts the tab — so coming back reloaded the page and the
 * half-built plan was gone. Users read that as "switching apps cancels the
 * plan". This keeps a draft in localStorage so a reload resumes where they
 * were.
 *
 * Only user-entered state is saved. Loading flags, fetched lists and errors are
 * recomputed on resume.
 */

const KEY = 'onlyfinds_plan_draft';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const VERSION = 1;

export type PlanDraft = {
  v: number;
  savedAt: number;
  page: string;
  eventName: string;
  eventDate: string;
  selectedVibes: string[];
  location: string;
  originCoord: { lat: number; lon: number } | null;
  travelTime: number;
  stopTimes: Record<string, string>;
  planId: string | null;
  discoveredVenues: unknown[];
  savedVenueSelectedIds: string[];
  adHocDietaryFilters: string[];
  qa: {
    name: string;
    address: string;
    type: string;
    tags: string[];
    collection: string;
  };
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // Safari private mode
  }
}

export function loadPlanDraft(): PlanDraft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as PlanDraft;
    if (d.v !== VERSION) return null;
    if (Date.now() - d.savedAt > MAX_AGE_MS) {
      s.removeItem(KEY);
      return null;
    }
    // A draft parked on the landing screen carries nothing worth restoring.
    if (d.page === 'hero') return null;
    return d;
  } catch {
    return null;
  }
}

export function savePlanDraft(draft: Omit<PlanDraft, 'v' | 'savedAt'>): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(KEY, JSON.stringify({ ...draft, v: VERSION, savedAt: Date.now() }));
  } catch {
    // quota or private mode — the draft is a convenience, not a requirement
  }
}

export function clearPlanDraft(): void {
  try {
    storage()?.removeItem(KEY);
  } catch { /* ignore */ }
}
