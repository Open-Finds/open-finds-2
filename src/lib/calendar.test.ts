import { describe, it, expect } from 'vitest';
import { buildGoogleCalendarUrl, buildOutlookCalendarUrl, planToCalendarEvent } from './calendar';
import type { Plan, Stop } from './supabase';

const plan = { id: 'p1', title: 'Friday Night', date: '2026-10-09', location: 'Sydney' } as Plan;
const stops = [
  { name: 'Mr Wong', address: '3 Bridge Ln, Sydney', time: '18:30', sort_order: 1 },
  { name: 'Baxter Inn', address: '152 Clarence St, Sydney', time: '21:00', sort_order: 2 },
] as Stop[];

describe('calendar links', () => {
  it('exports the explicit overnight end and never derives the end from the last stop', () => {
    const explicit = planToCalendarEvent({ ...plan, end_time: '02:00:00', end_date: '2026-10-10' }, stops);
    expect(explicit.end).toEqual(new Date('2026-10-10T02:00:00'));
    const without = planToCalendarEvent(plan, stops);
    expect(without.end.getTime() - without.start.getTime()).toBe(3 * 60 * 60 * 1000);
    expect(plan).not.toHaveProperty('end_time');
  });
  const ev = planToCalendarEvent(plan, stops);

  it('Outlook opens a new event with the plan filled in', () => {
    const url = new URL(buildOutlookCalendarUrl(ev));
    expect(url.origin + url.pathname).toBe('https://outlook.live.com/calendar/0/deeplink/compose');
    expect(url.searchParams.get('subject')).toBe('Friday Night');
    expect(url.searchParams.get('startdt')).toBe(ev.start.toISOString());
    expect(url.searchParams.get('enddt')).toBe(ev.end.toISOString());
    expect(url.searchParams.get('location')).toBe('3 Bridge Ln, Sydney');
    expect(url.searchParams.get('body')).toContain('Baxter Inn');
  });

  it('Google gets the same event', () => {
    const url = new URL(buildGoogleCalendarUrl(ev));
    expect(url.searchParams.get('text')).toBe('Friday Night');
    expect(url.searchParams.get('location')).toBe('3 Bridge Ln, Sydney');
  });
});
