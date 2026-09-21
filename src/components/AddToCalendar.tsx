import { useState } from 'react';
import { CalendarPlus, ChevronDown } from 'lucide-react';
import type { Plan, Stop } from '../lib/supabase';
import { planToCalendarEvent, buildGoogleCalendarUrl, downloadIcs, prefersIcs } from '../lib/calendar';
import { cn } from '@/lib/utils';

/**
 * "Add to Calendar" that works on iPhone.
 *
 * Google Calendar is a link; Apple Calendar needs an .ics file. The primary
 * action follows the platform, and a small secondary menu offers the other so
 * an iPhone user who lives in Google Calendar (or vice versa) is not stuck.
 */
export function AddToCalendar({
  plan,
  stops,
  className,
}: {
  plan: Plan;
  stops: Stop[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ev = planToCalendarEvent(plan, stops);
  const googleUrl = buildGoogleCalendarUrl(ev);
  const appleFirst = prefersIcs();

  const addApple = () => {
    downloadIcs(ev, `${plan.title.replace(/[^\w\- ]+/g, '').trim() || 'plan'}.ics`);
    setOpen(false);
  };

  const primary = appleFirst
    ? { label: 'Add to Calendar', onClick: addApple }
    : { label: 'Add to Calendar', href: googleUrl };

  return (
    <div className={cn('relative', className)}>
      <div className="flex">
        {primary.href ? (
          <a
            href={primary.href}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary flex flex-1 items-center justify-center gap-2 rounded-r-none"
          >
            <CalendarPlus size={18} /> {primary.label}
          </a>
        ) : (
          <button
            type="button"
            onClick={primary.onClick}
            className="btn-secondary flex flex-1 items-center justify-center gap-2 rounded-r-none"
          >
            <CalendarPlus size={18} /> {primary.label}
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Other calendar options"
          className="btn-secondary flex w-11 items-center justify-center rounded-l-none border-l-0 px-0"
        >
          <ChevronDown size={16} className={cn('transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-card border border-gold/20 bg-surface shadow-lg"
        >
          <a
            role="menuitem"
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="block px-4 py-3 text-sm text-white hover:bg-gold/10"
          >
            Google Calendar
          </a>
          <button
            role="menuitem"
            type="button"
            onClick={addApple}
            className="block w-full px-4 py-3 text-left text-sm text-white hover:bg-gold/10"
          >
            Apple Calendar / Outlook (.ics)
          </button>
        </div>
      )}
    </div>
  );
}
