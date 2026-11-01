import { createPlan, createStops, fetchStops, fetchPlan, updatePlan, updateStop, insertStop, deleteStop, reorderStops } from './supabase';
import { venueKey, type PlannerDraft } from './planner';
import { endFields, isDate, isTime } from './eventTiming';

export function validateEventDraft(d: PlannerDraft): void {
  if (!d.name.trim() || !isDate(d.date) || !isTime(d.startTime)) throw new Error('Add an event name, valid date and start time.');
  endFields(d);
  if (!d.stops.length || d.stops.length > 6) throw new Error('Choose between one and six stops.');
  if (new Set(d.stops.map(venueKey)).size !== d.stops.length) throw new Error('Remove duplicate venues before confirming.');
  if (d.stops.some((s) => !s.name.trim() || !s.address.trim() || !isTime(s.time))) throw new Error('Every stop needs a name, address and valid time.');
}
const rows = (d: PlannerDraft) => d.stops.map((s, i) => ({ name: s.name, address: s.address, time: s.time,
  vibe_link: s.link, sort_order: i, venue_partner_id: s.partnerId ?? null }));

/** Called only from the final confirmation action. A saved pending ID is
 * reused on retry; an ambiguous/partial stop write never creates a second plan. */
export async function confirmPlannerEvent(d: PlannerDraft, host: string, onCreated: (id: string) => void): Promise<string> {
  validateEventDraft(d);
  let id = d.pendingPlanId;
  if (!id) {
    const plan = await createPlan({ title: d.name.trim(), date: d.date, location: d.location.trim() || null,
      host_name: host, type: [...new Set(d.stops.map((s) => s.category))].join(','), status: 'active', ...endFields(d) });
    id = plan.id; onCreated(id);
  }
  const existing = await fetchStops(id);
  if (existing.length) {
    const expected = rows(d);
    if (existing.length !== expected.length || existing.some((s, i) => venueKey(s) !== venueKey(expected[i]) || s.time !== expected[i].time)) {
      throw new Error('This event was partly saved. Open it from Events to review it before trying again.');
    }
  } else await createStops(id, rows(d));
  return id;
}
export async function savePlannerEdits(d: PlannerDraft, ownerId: string): Promise<string> {
  validateEventDraft(d);
  if (!d.editPlanId) throw new Error('No event to edit.');
  const plan = await fetchPlan(d.editPlanId);
  if (!plan || plan.owner_id !== ownerId) throw new Error('Only the event host can edit this plan.');
  const existing = await fetchStops(plan.id);
  const retained = new Set(d.stops.map((s) => s.existingStopId).filter(Boolean));
  // Existing stop IDs must be in this event; never trust a persisted draft ID.
  if ([...retained].some((id) => !existing.some((s) => s.id === id))) throw new Error('The event changed. Reopen it before editing.');
  await updatePlan(plan.id, { title: d.name.trim(), date: d.date, location: d.location.trim() || null,
    type: d.originalType ?? [...new Set(d.stops.map((s) => s.category))].join(','),
    ...(d.endTime ? endFields(d) : plan.end_time ? { end_time: null, end_date: null } : {}) });
  // Reuse removed slots for replacements so full itineraries stay within
  // the backend cap throughout an edit.
  const reusable = existing.filter((s) => !retained.has(s.id));
  const reused = new Set<string>();
  const order: string[] = [];
  for (const [i, stop] of d.stops.entries()) {
    if (stop.existingStopId) {
      await updateStop(stop.existingStopId, { name: stop.name, address: stop.address, time: stop.time, sort_order: i });
      order.push(stop.existingStopId);
    } else {
      const slot = reusable.shift();
      if (slot) {
        await updateStop(slot.id, rows(d)[i]);
        reused.add(slot.id); order.push(slot.id);
      } else order.push((await insertStop(plan.id, rows(d)[i])).id);
    }
  }
  for (const stop of existing) if (!retained.has(stop.id) && !reused.has(stop.id)) await deleteStop(stop.id);
  await reorderStops(plan.id, order);
  return plan.id;
}
