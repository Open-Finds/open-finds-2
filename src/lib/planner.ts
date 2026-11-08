import type { TravelMode } from './apiKeys';
import type { SavedVenue, SponsoredVenue, Stop } from './supabase';
import { CATEGORIES, categoryOf, normalizeTags, type Category } from './taxonomy';
export { CATEGORIES, CATEGORY_LABELS, categoryOf } from './taxonomy';
export type { Category } from './taxonomy';
export type PlannerMode = 'random' | 'saved' | 'picks' | 'ai';
export const MODES: { id: PlannerMode; label: string; description: string }[] = [
  { id: 'random', label: 'Random Night', description: 'A little spontaneity, from your saved spots.' },
  { id: 'saved', label: 'Saved Venues', description: 'Your favourites. Your kind of plan.' },
  { id: 'picks', label: 'Our Picks', description: 'Meet the places onboarded by The Unsaved.' },
  { id: 'ai', label: 'AI Finds', description: 'Discover somewhere new, matched to your mood.' },
];
export type PlannerVenue = {
  id: string; name: string; address: string; category: Category; link: string | null;
  source: 'saved' | 'partner' | 'event' | 'external'; providerId?: string; attributions?: { provider: string; url?: string }[]; lat: number | null; lon: number | null;
  photo?: string | null; tags: string[]; partnerId?: string;
  // Future dated experiences remain distinct from permanent venues.
  entityKind: 'venue' | 'experience'; startsAt?: string; endsAt?: string; ticketUrl?: string;
};
export type DraftStop = PlannerVenue & { time: string; addedFrom: PlannerMode; existingStopId?: string };
export type PlannerDraft = {
  version: 1; name: string; date: string; startTime: string; location: string;
  origin: { lat: number; lon: number } | null; radiusKm: number; mood: string; travelMode: TravelMode; maxTravelMinutes: number;
  mode: PlannerMode; step: number; counts: Record<Category, number>; stops: DraftStop[];
  collectionId: string; pendingPlanId?: string; editPlanId?: string; originalType?: string; savedAt: number;
  endTime: string; endNextDay: boolean; vibes: string[];
};
export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function emptyDraft(): PlannerDraft {
  return { version: 1, name: '', date: localDate(), startTime: '19:00', location: '', origin: null,
    radiusKm: 10, mood: '', travelMode: 'driving', maxTravelMinutes: 20, mode: 'saved', step: 0, counts: { food: 0, dessert: 0, bar: 0, activity: 0, nightlife: 0, outdoors: 0 },
    endTime: '', endNextDay: false, vibes: [],
    stops: [], collectionId: '', savedAt: Date.now() };
}
export function savedCandidate(v: SavedVenue): PlannerVenue {
  return { id: v.id, name: v.name, address: v.address, category: categoryOf(v), link: v.link,
    source: 'saved', lat: v.lat, lon: v.lon, photo: v.photo_url, tags: normalizeTags(v.tags ?? []), entityKind: 'venue' };
}
export function partnerCandidate(v: SponsoredVenue): PlannerVenue {
  return { id: `partner:${v.id}`, partnerId: v.id, name: v.business_name, address: v.address,
    category: categoryOf({ type: v.type, tags: null, name: v.business_name }), link: v.instagram_link || v.website, source: 'partner', lat: v.lat, lon: v.lon,
    tags: [], entityKind: 'venue' };
}
export function venueKey(v: Pick<PlannerVenue, 'name' | 'address'>): string {
  return `${v.name}|${v.address}`.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
export function minutesAfter(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const n = ((h * 60 + m + minutes) % 1440 + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}
export type DraftAction = { type: 'patch'; patch: Partial<Omit<PlannerDraft, 'stops'>> }
  | { type: 'add'; venue: PlannerVenue } | { type: 'remove'; key: string }
  | { type: 'time'; key: string; time: string } | { type: 'move'; index: number; delta: number }
  | { type: 'count'; category: Category; delta: number } | { type: 'random'; venues: PlannerVenue[] }
  | { type: 'reorder'; keys: string[] } | { type: 'proposal'; venues: PlannerVenue[]; replace: boolean }
  | { type: 'reset'; draft?: PlannerDraft };
export function plannerReducer(d: PlannerDraft, a: DraftAction): PlannerDraft {
  if (a.type === 'reset') return a.draft ?? emptyDraft();
  const next = { ...d, savedAt: Date.now() };
  if (a.type === 'patch') {
    const changed = { ...next, ...a.patch };
    if (a.patch.startTime && a.patch.startTime !== d.startTime && d.stops.length) {
      const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      changed.stops = d.stops.map((s) => ({ ...s, time: minutesAfter(s.time, minutes(a.patch.startTime!) - minutes(d.startTime)) }));
    }
    return changed;
  }
  if (a.type === 'add') {
    if (d.stops.length >= 6 || d.stops.some((v) => venueKey(v) === venueKey(a.venue))) return d;
    return { ...next, stops: [...d.stops, { ...a.venue, time: minutesAfter(d.startTime, d.stops.length * 90), addedFrom: d.mode }] };
  }
  if (a.type === 'remove') {
    const stops = d.stops.filter((s) => venueKey(s) !== a.key);
    return { ...next, stops, startTime: stops[0]?.time ?? d.startTime };
  }
  if (a.type === 'time') {
    const stops = d.stops.map((s) => venueKey(s) === a.key ? { ...s, time: a.time } : s);
    return { ...next, stops, startTime: stops[0]?.time ?? d.startTime };
  }
  if (a.type === 'move') {
    const stops = [...d.stops]; const target = a.index + a.delta;
    if (a.index < 0 || a.index >= stops.length || target < 0 || target >= stops.length) return d;
    [stops[a.index], stops[target]] = [{ ...stops[target], time: stops[a.index].time }, { ...stops[a.index], time: stops[target].time }];
    return { ...next, stops, startTime: stops[0]?.time ?? d.startTime };
  }
  if (a.type === 'reorder') {
    if (a.keys.length !== d.stops.length || new Set(a.keys).size !== d.stops.length || a.keys.some((k) => !d.stops.some((s) => venueKey(s) === k))) return d;
    const stops = a.keys.map((k, i) => ({ ...d.stops.find((s) => venueKey(s) === k)!, time: d.stops[i].time }));
    return { ...next, stops, startTime: stops[0]?.time ?? d.startTime };
  }
  if (a.type === 'proposal') {
    let result = a.replace ? { ...next, stops: [] } : next;
    for (const v of a.venues) if (v.source === 'saved') result = plannerReducer(result, { type: 'add', venue: v });
    return result;
  }
  if (a.type === 'count') {
    const total = Object.values(d.counts).reduce((sum, n) => sum + n, 0);
    const value = d.counts[a.category] + a.delta;
    if (value < 0 || total + a.delta > 6) return d;
    return { ...next, counts: { ...d.counts, [a.category]: value } };
  }
  if (a.type === 'random') {
    // Shuffle only replaces stops contributed by Random Night. Manual, partner
    // and AI selections keep their order/times and are never overwritten.
    const retained = d.stops.filter((s) => s.addedFrom !== 'random');
    const keys = new Set(retained.map(venueKey));
    const added = a.venues.filter((v) => v.source === 'saved').filter((v) => {
      const key = venueKey(v); if (keys.has(key)) return false; keys.add(key); return true;
    }).slice(0, 6 - retained.length).map((v, i) => ({ ...v, addedFrom: 'random' as const,
      time: minutesAfter(d.startTime, (retained.length + i) * 90) }));
    return { ...next, stops: [...retained, ...added] };
  }
  return d;
}
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (n: number) => n * Math.PI / 180;
  const x = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function randomSaved(d: PlannerDraft, saved: PlannerVenue[], random = Math.random): PlannerVenue[] {
  const retained = d.stops.filter((s) => s.addedFrom !== 'random');
  const keys = new Set(retained.map(venueKey));
  const seen = new Set<string>();
  const pool = saved.filter((v) => v.source === 'saved' && !keys.has(venueKey(v))).filter((v) => { const k = venueKey(v); if (seen.has(k)) return false; seen.add(k); return true; });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const wanted = Object.values(d.counts).reduce((sum, n) => sum + n, 0);
  if (!wanted) {
    const varied = [...CATEGORIES.flatMap((c) => pool.find((v) => v.category === c) ?? [])];
    const keys = new Set(varied.map(venueKey));
    return [...varied, ...pool.filter((v) => !keys.has(venueKey(v)))].slice(0, Math.min(3, 6 - retained.length));
  }
  const results: PlannerVenue[] = [];
  for (const category of CATEGORIES) results.push(...pool.filter((v) => v.category === category)
    .slice(0, Math.max(0, d.counts[category] - retained.filter((v) => v.category === category).length)));
  return results.slice(0, 6 - retained.length);
}
export function draftFromStops(d: PlannerDraft, stops: Stop[], known: PlannerVenue[] = []): PlannerDraft {
  return { ...d, stops: stops.map((s) => ({ id: s.id, name: s.name, address: s.address,
    category: 'activity', source: s.venue_partner_id ? 'partner' : 'event', partnerId: s.venue_partner_id ?? undefined,
    link: s.vibe_link, lat: null, lon: null, tags: [], entityKind: 'venue',
    ...known.find((v) => venueKey(v) === venueKey(s)), existingStopId: s.id, time: s.time.slice(0, 5), addedFrom: 'saved' })) };
}
export function readPlannerDraft(owner: string): PlannerDraft {
  try {
    const d = JSON.parse(localStorage.getItem(`unsaved:planner:${owner}`) ?? 'null') as PlannerDraft | null;
    if (d?.version === 1) {
      // Upgrade old five-category drafts without losing details or stops.
      d.counts = { ...emptyDraft().counts, ...d.counts };
      d.travelMode = ['driving', 'walking', 'transit'].includes(d.travelMode) ? d.travelMode : 'driving';
      d.maxTravelMinutes = (Number.isInteger(d.maxTravelMinutes) && d.maxTravelMinutes >= 1 && d.maxTravelMinutes <= 60) ? d.maxTravelMinutes : 20;
      d.endTime ??= ''; d.endNextDay ??= false; d.vibes ??= [];
    }
    if (d?.version === 1 && typeof d.name === 'string' && typeof d.location === 'string'
      && typeof d.date === 'string' && typeof d.startTime === 'string' && typeof d.mood === 'string'
      && MODES.some((m) => m.id === d.mode) && Number.isInteger(d.step) && d.step >= 0 && d.step <= 3
      && d.counts && CATEGORIES.every((c) => Number.isInteger(d.counts[c]) && d.counts[c] >= 0)
      && Object.values(d.counts).reduce((sum, n) => sum + n, 0) <= 6
      && Array.isArray(d.stops) && d.stops.length <= 6 && d.stops.every((s) => typeof s.name === 'string' && typeof s.address === 'string' && typeof s.time === 'string')
      && typeof d.endTime === 'string' && typeof d.endNextDay === 'boolean' && Array.isArray(d.vibes)
      && Date.now() - d.savedAt < 86400000) return d;
  } catch { /* private mode / invalid or old draft */ }
  return emptyDraft();
}
export function persistPlannerDraft(owner: string, draft: PlannerDraft | null): void {
  try { if (draft) localStorage.setItem(`unsaved:planner:${owner}`, JSON.stringify(draft));
    else localStorage.removeItem(`unsaved:planner:${owner}`); } catch { /* optional persistence */ }
}
