import type { Plan, Stop } from './supabase';
import { formatTime } from './time';

/**
 * Calendar export for a plan.
 *
 * Two targets, because "add to calendar" means different things per platform:
 * - Google Calendar: a prefilled web link, which is what the app offered before.
 * - Apple Calendar / Outlook / anything else: an .ics file. On iPhone, opening
 *   one prompts "Add to Calendar" natively — there is no URL scheme that does
 *   the equivalent, so a file is the only path to the built-in calendar.
 */

const DEFAULT_START = '19:00';
const DEFAULT_DURATION_HOURS = 3;

type CalendarEvent = {
  title: string;
  start: Date;
  end: Date;
  location: string;
  description: string;
  /** Used as the iCalendar UID so re-importing updates rather than duplicates. */
  uid: string;
};

/**
 * Derives the calendar event from a plan. Starts at the first stop's time
 * (or 7pm), ends after the last stop's time (or three hours later).
 */
export function planToCalendarEvent(plan: Plan, stops: Stop[]): CalendarEvent {
  const ordered = [...stops].sort((a, b) => a.sort_order - b.sort_order || a.time.localeCompare(b.time));
  const firstTime = ordered[0]?.time ?? DEFAULT_START;
  const lastTime = ordered[ordered.length - 1]?.time ?? null;

  const start = new Date(`${plan.date}T${firstTime}:00`);
  let end: Date;
  if (lastTime && lastTime > firstTime) {
    // Give the final stop an hour rather than ending the event the minute it starts.
    end = new Date(`${plan.date}T${lastTime}:00`);
    end = new Date(end.getTime() + 60 * 60 * 1000);
  } else {
    end = new Date(start.getTime() + DEFAULT_DURATION_HOURS * 60 * 60 * 1000);
  }

  const description = ordered.length
    ? ordered.map((s, i) => `${i + 1}. ${formatTime(s.time)} — ${s.name}, ${s.address}`).join('\n')
    : '';

  return {
    title: plan.title,
    start,
    end,
    location: ordered[0]?.address ?? plan.location ?? '',
    description,
    uid: `plan-${plan.id}@openfinds`,
  };
}

/** UTC timestamp in the compact form both Google and iCalendar accept. */
function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildGoogleCalendarUrl(ev: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${stamp(ev.start)}/${stamp(ev.end)}`,
    details: ev.description,
    location: ev.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Escapes the characters iCalendar treats as structural (RFC 5545 §3.3.11). */
function icsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines at 75 octets as the spec requires; long descriptions otherwise break some parsers. */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function buildIcs(ev: CalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Open Finds//Plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(ev.start)}`,
    `DTEND:${stamp(ev.end)}`,
    `SUMMARY:${icsText(ev.title)}`,
    `LOCATION:${icsText(ev.location)}`,
    `DESCRIPTION:${icsText(ev.description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** True on iPhone/iPad/Mac, where the built-in calendar only accepts a file. */
export function prefersIcs(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  const isMac = /Macintosh/.test(ua);
  return isIOS || isMac;
}

/**
 * Hands the .ics to the browser. iOS Safari opens it straight into the
 * Add-to-Calendar sheet; desktop browsers save it and the OS calendar opens it.
 */
export function downloadIcs(ev: CalendarEvent, filename = 'open-finds-plan.ics'): void {
  const blob = new Blob([buildIcs(ev)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the navigation a tick before revoking, or Safari can lose the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
