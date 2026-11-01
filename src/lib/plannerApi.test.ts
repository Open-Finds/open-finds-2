import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ createPlan: vi.fn(), createStops: vi.fn(), fetchStops: vi.fn(), fetchPlan: vi.fn(), updatePlan: vi.fn(), updateStop: vi.fn(), insertStop: vi.fn(), deleteStop: vi.fn(), reorderStops: vi.fn() }));
vi.mock('./supabase', () => api);
import { confirmPlannerEvent, savePlannerEdits } from './plannerApi';
import { emptyDraft, plannerReducer, venueKey, type PlannerDraft } from './planner';
const draft = (): PlannerDraft => ({ ...plannerReducer(emptyDraft(), { type: 'add', venue: { id: 'v', name: 'Test café', address: '1 Test St', category: 'food', source: 'saved', link: null, lat: null, lon: null, tags: [], entityKind: 'venue' } }), name: 'Test event' });
beforeEach(() => { Object.values(api).forEach((fn) => fn.mockReset()); api.createPlan.mockResolvedValue({ id: 'plan' }); api.fetchStops.mockResolvedValue([]); api.createStops.mockResolvedValue([]); });
describe('planner confirmation boundary', () => {
  it('persists an explicit overnight end without deriving it from itinerary stops', async () => {
    await confirmPlannerEvent({ ...draft(), endTime: '02:00', endNextDay: true, date: '2026-12-31' }, 'Host', vi.fn());
    expect(api.createPlan).toHaveBeenCalledWith(expect.objectContaining({ end_time: '02:00', end_date: '2027-01-01' }));
  });
  it('creates the event only through explicit confirmation, then persists stops', async () => {
    const remember = vi.fn(); expect(api.createPlan).not.toHaveBeenCalled();
    expect(await confirmPlannerEvent(draft(), 'Host', remember)).toBe('plan');
    expect(remember).toHaveBeenCalledWith('plan'); expect(api.createStops).toHaveBeenCalledWith('plan', [expect.objectContaining({ name: 'Test café', time: '19:00', sort_order: 0 })]);
  });
  it('does not create invalid/empty events', async () => {
    await expect(confirmPlannerEvent(emptyDraft(), 'Host', vi.fn())).rejects.toThrow(); expect(api.createPlan).not.toHaveBeenCalled();
  });
  it('reuses a pending event after a stop failure without creating duplicates', async () => {
    api.createStops.mockRejectedValueOnce(new Error('offline'));
    let d = draft();
    await expect(confirmPlannerEvent(d, 'Host', (id) => { d = { ...d, pendingPlanId: id }; })).rejects.toThrow('offline');
    await confirmPlannerEvent(d, 'Host', vi.fn()); expect(api.createPlan).toHaveBeenCalledTimes(1);
  });
  it('does not reinsert stops after a lost successful response', async () => {
    const d = { ...draft(), pendingPlanId: 'plan' };
    api.fetchStops.mockResolvedValue([{ ...d.stops[0], id: 'stop' }]);
    await confirmPlannerEvent(d, 'Host', vi.fn()); expect(api.createPlan).not.toHaveBeenCalled(); expect(api.createStops).not.toHaveBeenCalled();
  });
  it('rejects ambiguous partial persistence rather than overwriting it', async () => {
    api.fetchStops.mockResolvedValue([{ name: 'Other venue', address: '2 Other St', time: '19:00' }]);
    await expect(confirmPlannerEvent({ ...draft(), pendingPlanId: 'plan' }, 'Host', vi.fn())).rejects.toThrow('partly saved'); expect(api.createStops).not.toHaveBeenCalled();
  });
  it('reuses a removed stop slot when replacing a full itinerary', async () => {
    api.fetchPlan.mockResolvedValue({ id: 'plan', owner_id: 'me' });
    api.fetchStops.mockResolvedValue([{ id: 'old', name: 'Old', address: 'Old address' }]);
    await savePlannerEdits({ ...draft(), editPlanId: 'plan' }, 'me');
    expect(api.updateStop).toHaveBeenCalledWith('old', expect.objectContaining({ name: draft().stops[0].name, vibe_link: null, venue_partner_id: null }));
    expect(api.insertStop).not.toHaveBeenCalled(); expect(api.deleteStop).not.toHaveBeenCalled();
    expect(api.reorderStops).toHaveBeenCalledWith('plan', ['old']);
  });
  it('rejects stop IDs belonging to a different event before writes', async () => {
    api.fetchPlan.mockResolvedValue({ id: 'plan', owner_id: 'me' });
    const d = draft(); d.stops[0].existingStopId = 'foreign';
    await expect(savePlannerEdits({ ...d, editPlanId: 'plan' }, 'me')).rejects.toThrow('event changed');
    expect(api.updatePlan).not.toHaveBeenCalled();
  });
  it('refuses non-host editing before any write', async () => {
    api.fetchPlan.mockResolvedValue({ id: 'plan', owner_id: 'other' });
    await expect(savePlannerEdits({ ...draft(), editPlanId: 'plan' }, 'me')).rejects.toThrow('Only the event host');
    expect(api.updatePlan).not.toHaveBeenCalled(); expect(api.deleteStop).not.toHaveBeenCalled();
  });
  it('edits the same event, preserving its identity and existing stop IDs after reordering', async () => {
    api.fetchPlan.mockResolvedValue({ id: 'same-plan', owner_id: 'me', share_link: 'existing-share', end_time: null });
    const d = draft();
    d.stops[0].existingStopId = 'stop-a';
    d.stops.push({ ...d.stops[0], id: 'venue-b', existingStopId: 'stop-b', name: 'Second venue', address: '2 Test St', time: '20:30' });
    api.fetchStops.mockResolvedValue(d.stops.map((s) => ({ ...s, id: s.existingStopId })));
    const reordered = plannerReducer({ ...d, editPlanId: 'same-plan' }, { type: 'reorder', keys: d.stops.map(venueKey).reverse() });
    expect(await savePlannerEdits(reordered, 'me')).toBe('same-plan');
    expect(api.createPlan).not.toHaveBeenCalled(); expect(api.createStops).not.toHaveBeenCalled();
    expect(api.updatePlan).toHaveBeenCalledWith('same-plan', expect.not.objectContaining({ share_link: expect.anything(), owner_id: expect.anything() }));
    expect(api.reorderStops).toHaveBeenCalledWith('same-plan', ['stop-b', 'stop-a']);
    expect(api.insertStop).not.toHaveBeenCalled(); expect(api.deleteStop).not.toHaveBeenCalled();
  });
});
