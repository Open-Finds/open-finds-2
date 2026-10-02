import { useState } from 'react';
import { Apple, CalendarPlus } from 'lucide-react';
import type { Plan, Stop } from '../lib/supabase';
import { planToCalendarEvent, buildGoogleCalendarUrl, buildOutlookCalendarUrl, downloadIcs } from '../lib/calendar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { cn } from '@/lib/utils';

const TILE =
  'flex flex-col items-center justify-center gap-2 rounded-card border border-gold/25 bg-black/40 px-2 py-4 text-sm font-semibold text-white transition-all hover:border-gold/60 hover:bg-gold/10 active:scale-95';

function Letter({ children, className }: { children: string; className: string }) {
  return (
    <span aria-hidden="true" className={cn('flex h-10 w-10 items-center justify-center rounded-full text-lg font-black', className)}>
      {children}
    </span>
  );
}

/**
 * "Add to Calendar": one button, then the calendar you use. Google and
 * Outlook are prefilled web pages; Apple Calendar (and anything else) takes
 * an .ics file, which on iPhone opens straight into "Add to Calendar".
 * Works for guests too: nothing here needs an account.
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
  const fileName = `${plan.title.replace(/[^\w\- ]+/g, '').trim() || 'plan'}.ics`;
  const close = () => setOpen(false);
  const saveIcs = () => {
    downloadIcs(ev, fileName);
    close();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('btn-secondary flex w-full items-center justify-center gap-2', className)}
      >
        <CalendarPlus size={18} /> Add to Calendar
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">Add to Calendar</DialogTitle>
            <DialogDescription>Pick the calendar you use.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <a href={buildGoogleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" onClick={close} className={TILE}>
              <Letter className="bg-white text-[#4285F4]">G</Letter> Google
            </a>
            <button type="button" onClick={saveIcs} className={TILE}>
              <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-black">
                <Apple size={22} />
              </span>
              Apple
            </button>
            <a href={buildOutlookCalendarUrl(ev)} target="_blank" rel="noopener noreferrer" onClick={close} className={TILE}>
              <Letter className="bg-[#0078D4] text-white">O</Letter> Outlook
            </a>
          </div>
          <button type="button" onClick={saveIcs} className="text-xs text-ink-secondary underline-offset-2 hover:text-gold hover:underline">
            Another calendar? Download the .ics file
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
