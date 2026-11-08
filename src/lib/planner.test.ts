import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDraft, plannerReducer as reduce, randomSaved, venueKey, readPlannerDraft, persistPlannerDraft, type PlannerVenue } from './planner';
const v = (n: number, category: PlannerVenue['category'] = 'food', source: PlannerVenue['source'] = 'saved'): PlannerVenue =>
  ({ id: String(n), name: `Test venue ${n}`, address: `${n} Test Road`, category, source, link: null, lat: -33.88, lon: 151.2, tags: [], entityKind: 'venue' });
beforeEach(() => localStorage.clear());
describe('single shared itinerary', () => {
  it('upgrades a five-category device draft without clearing its selections', () => {
    const d = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    const old = JSON.parse(JSON.stringify(d)); delete old.counts.outdoors; delete old.vibes; delete old.endTime; delete old.endNextDay;
    localStorage.setItem('unsaved:planner:legacy', JSON.stringify(old));
    const restored = readPlannerDraft('legacy');
    expect(restored.stops).toHaveLength(1); expect(restored.counts.outdoors).toBe(0); expect(restored.vibes).toEqual([]);
  });
  it('supports multiple outdoors stops without requiring one stop per category', () => {
    const d = { ...emptyDraft(), counts: { ...emptyDraft().counts, outdoors: 2 } };
    expect(randomSaved(d, [v(1, 'outdoors'), v(2, 'outdoors'), v(3, 'activity')])).toHaveLength(2);
  });
  it('keeps the displayed event start consistent with its first stop', () => {
    let d = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    d = reduce(d, { type: 'add', venue: v(2) });
    d = reduce(d, { type: 'patch', patch: { startTime: '20:00' } });
    expect(d.stops.map((s) => s.time)).toEqual(['20:00', '21:30']);
    d = reduce(d, { type: 'remove', key: venueKey(v(1)) });
    expect(d.startTime).toBe('21:30');
  });
  it('preserves venue order and times across every discovery mode', () => {
    let d = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    d = reduce(d, { type: 'time', key: venueKey(v(1)), time: '20:45' });
    for (const mode of ['random', 'saved', 'picks', 'ai'] as const) d = reduce(d, { type: 'patch', patch: { mode } });
    expect(d.stops).toHaveLength(1); expect(d.stops[0].time).toBe('20:45');
  });
  it('never exceeds six and deduplicates records across sources', () => {
    let d = emptyDraft();
    for (let n = 1; n <= 8; n++) d = reduce(d, { type: 'add', venue: v(n) });
    expect(d.stops).toHaveLength(6);
    const first = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    expect(reduce(first, { type: 'add', venue: { ...v(1), id: 'partner:1', source: 'partner', name: 'TEST VENUE 1' } }).stops).toHaveLength(1);
  });
  it('category preference changes never remove actual stops', () => {
    let d = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    for (let i = 0; i < 9; i++) d = reduce(d, { type: 'count', category: 'nightlife', delta: 1 });
    expect(d.counts.nightlife).toBe(6); expect(d.stops).toHaveLength(1);
    d = reduce(d, { type: 'count', category: 'food', delta: 1 }); expect(d.counts.food).toBe(0);
    for (let i = 0; i < 8; i++) d = reduce(d, { type: 'count', category: 'nightlife', delta: -1 });
    expect(d.counts.nightlife).toBe(0); expect(d.stops).toHaveLength(1);
  });
  it('reorders and removes only the requested stop', () => {
    let d = reduce(reduce(emptyDraft(), { type: 'add', venue: v(1) }), { type: 'add', venue: v(2) });
    d = reduce(d, { type: 'move', index: 1, delta: -1 }); expect(d.stops.map((s) => s.id)).toEqual(['2', '1']);
    d = reduce(d, { type: 'remove', key: venueKey(v(2)) }); expect(d.stops.map((s) => s.id)).toEqual(['1']);
  });
  it('Random Night never introduces partner or external records', () => {
    const d = emptyDraft();
    expect(randomSaved(d, [v(1), v(2, 'bar', 'partner')], () => 0)).toEqual([v(1)]);
    const shuffled = reduce(d, { type: 'random', venues: [v(1), v(2, 'bar', 'partner')] }); expect(shuffled.stops.map((s) => s.id)).toEqual(['1']);
  });
  it('shuffle preserves manual stops and reports only matching requested categories', () => {
    let d = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    d = reduce(d, { type: 'count', category: 'dessert', delta: 1 });
    const mix = randomSaved(d, [v(1), v(2), v(3, 'dessert')]);
    d = reduce(d, { type: 'random', venues: mix }); expect(d.stops.map((s) => s.id)).toEqual(['1', '3']);
  });
  it('does not infer routing durations or silently apply a legacy distance radius', () => {
    const d = { ...emptyDraft(), origin: { lat: -33.88, lon: 151.2 }, radiusKm: 1 };
    expect(randomSaved(d, [{ ...v(1), lat: 0, lon: 0 }])).toHaveLength(1);
  });
  it('accepts only a permutation for drag reorder and retains stop IDs and times', () => {
    let d = reduce(reduce(emptyDraft(), { type: 'add', venue: v(1) }), { type: 'add', venue: v(2) });
    const before = d;
    expect(reduce(d, { type: 'reorder', keys: [venueKey(v(1)), venueKey(v(1))] })).toBe(d);
    d = reduce(d, { type: 'reorder', keys: d.stops.map(venueKey).reverse() });
    expect(d.stops.map((s) => s.id)).toEqual([...before.stops].reverse().map((s) => s.id));
    expect(d.stops.map((s) => s.time)).toEqual(before.stops.map((s) => s.time));
  });
  it('requires explicit proposal application and caps merge at six without replacing manual stops', () => {
    const original = reduce(emptyDraft(), { type: 'add', venue: v(1) });
    const proposal = Array.from({ length: 6 }, (_, i) => v(i + 2));
    expect(original.stops.map((v) => v.id)).toEqual(['1']);
    const merged = reduce(original, { type: 'proposal', venues: proposal, replace: false });
    expect(merged.stops).toHaveLength(6); expect(merged.stops[0].id).toBe('1');
    const replaced = reduce(original, { type: 'proposal', venues: proposal, replace: true });
    expect(replaced.stops.map((v) => v.id)).toEqual(['2', '3', '4', '5', '6', '7']);
  });
  it('restores arbitrary integer travel limits and rejects out-of-range values', () => {
    for (const n of [1, 7, 23, 59, 60, 0, 61, 4.5]) { persistPlannerDraft('travel', { ...emptyDraft(), maxTravelMinutes: n }); expect(readPlannerDraft('travel').maxTravelMinutes).toBe(Number.isInteger(n) && n >= 1 && n <= 60 ? n : 20); }
  });
  it('keeps account drafts isolated and rejects expired/corrupt drafts', () => {
    const d = { ...emptyDraft(), name: 'Private draft' }; persistPlannerDraft('a', d);
    expect(readPlannerDraft('a').name).toBe('Private draft'); expect(readPlannerDraft('b').name).toBe('');
    persistPlannerDraft('a', { ...d, savedAt: Date.now() - 90000000 }); expect(readPlannerDraft('a').name).toBe('');
    localStorage.setItem('unsaved:planner:a', JSON.stringify({ version: 1, stops: [], savedAt: Date.now() }));
    expect(readPlannerDraft('a').name).toBe('');
  });
});
