import { useEffect, useState } from 'react';
import { parseLocalDate } from '../lib/time';
import {
  fetchPlan,
  fetchStops,
  fetchRsvps,
  sortStops,
  sortStopsByTime,
  resequenceStopsByTime,
  type Plan,
  type Stop,
  type Rsvp,
} from '../lib/supabase';
import { mapsDirectionsUrl } from '../lib/maps';
import { useCountdown } from '../lib/countdown';
import { ChevronLeft, CalendarPlus, Clock, Check, X, Clock3, Navigation, Share2, Smartphone } from 'lucide-react';
import { StopCard } from '../components/StopCard';
import { AddToCalendar } from '../components/AddToCalendar';
import { HostBadge } from '../components/Shared';
import { InviteFriendsModal } from '../components/InviteFriendsModal';
import { ShareOnSocialDialog } from '../components/ShareOnSocial';
import { buildInviteMessage, getShareUrl } from '../lib/invite';
import { planToCalendarEvent } from '../lib/calendar';

export function DashboardPage({
  id,
  onBack,
}: {
  id: string;
  onBack: () => void;
  onEditPlan: (planId: string) => void;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);


  // Counts down to the first stop (or 7pm when there are no times), the same
  // start the calendar export uses.
  const event = plan ? planToCalendarEvent(plan, stops) : null;
  const countdown = useCountdown(event ? event.start.toISOString() : '2099-01-01');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, s, r] = await Promise.all([
          fetchPlan(id),
          fetchStops(id),
          fetchRsvps(id),
        ]);
        if (!active) return;
        setPlan(p);
        setStops(sortStops(s));
        setRsvps(r);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <p className="text-ink-secondary">Loading...</p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black px-6 text-center">
        <p className="text-danger">Plan not found.</p>
        <button onClick={onBack} className="mt-4 text-gold underline">
          Go back
        </button>
      </div>
    );
  }

  const confirmedCount = rsvps.filter((r) => r.status === 'in').length;

  const navUrl = mapsDirectionsUrl(stops.map((s) => s.address), plan.location) ?? '#';

  /**
   * A time edit changes the chronological order, so persist the new sequence
   * rather than only re-sorting on screen — sort_order is what the next load
   * reads back.
   */
  const handleStopSaved = async (updated: Stop) => {
    const next = stops.map((s) => (s.id === updated.id ? updated : s));
    setStops(sortStopsByTime(next));
    try {
      setStops(await resequenceStopsByTime(id, next));
    } catch {
      // Ordering is cosmetic if this fails; the edit itself already saved.
    }
  };

  return (
    <div className="relative min-h-screen overflow-y-auto bg-black px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-5 top-5 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full">
        {/* Header */}
        <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-5">
          <h1 className="text-2xl font-bold text-gold">{plan.title}</h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-secondary">
            <CalendarPlus size={14} className="text-gold/70" />
            {parseLocalDate(plan.date).toLocaleDateString('en-AU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Countdown */}
        <div className="mt-4 rounded-card border border-gold/20 bg-[#1a1a1a] p-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm text-ink-secondary">
            <Clock size={14} /> Countdown
          </p>
          {event && (
            <p className="mt-1 text-sm font-semibold text-white">
              {event.start.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}
              {event.start.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          <p className="mt-2 text-xl font-bold text-gold">
            {!countdown.isPast
              ? `${plural(countdown.days, 'day')}, ${plural(countdown.hours, 'hour')}, ${plural(countdown.minutes, 'minute')}`
              : event && Date.now() < event.end.getTime()
                ? "It's on now!"
                : 'This night has been and gone'}
          </p>
        </div>

        {/* Confirmed count */}
        <div className="mt-4 flex items-center justify-between rounded-card border border-gold/20 bg-[#1a1a1a] px-4 py-3">
          <span className="text-sm text-ink-secondary">Confirmed</span>
          <span className="text-lg font-bold text-gold">
            {confirmedCount}/{rsvps.length} confirmed
          </span>
        </div>

        {/* RSVP list */}
        <div className="mt-6">
          <h2 className="mb-3 text-lg font-semibold text-white">RSVP List</h2>
          {rsvps.length === 0 ? (
            <p className="text-sm text-ink-secondary">No RSVPs yet.</p>
          ) : (
            <ul className="space-y-2">
              {rsvps.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-gold/10 bg-black/40 px-4 py-3"
                >
                  <div>
                    <span className="font-medium text-white">{r.name}</span>
                    {r.is_host && <HostBadge />}
                    {r.status === 'declined' && r.decline_reason && (
                      <p className="text-xs text-ink-secondary">"{r.decline_reason}"</p>
                    )}
                  </div>
                  {r.status === 'in' && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                      <Check size={16} /> In
                    </span>
                  )}
                  {r.status === 'declined' && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-danger">
                      <X size={16} /> Can't make it
                    </span>
                  )}
                  {r.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-pending">
                      <Clock3 size={16} /> Pending
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Itinerary */}
        <div className="mt-6">
          <h2 className="mb-3 text-lg font-semibold text-white">Itinerary</h2>
          <div className="space-y-3">
            {stops.map((stop, i) => (
              <StopCard
                key={stop.id}
                stop={stop}
                index={i}
                onSaved={handleStopSaved}
              />
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-8 space-y-3">
          <a
            href={navUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98]"
          >
            <Navigation size={18} /> Open in Maps
          </a>
          <AddToCalendar plan={plan} stops={stops} />
          <button
            onClick={() => setInviteOpen(true)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
          >
            <Smartphone size={18} /> Invite Friends
          </button>
          <button
            onClick={() => setShareOpen(true)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
          >
            <Share2 size={18} /> Share on Social
          </button>
        </div>
      </div>

      <InviteFriendsModal open={inviteOpen} onClose={() => setInviteOpen(false)} planId={id} />
      <ShareOnSocialDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={plan.title}
        message={buildInviteMessage(plan)}
        url={getShareUrl(id)}
      />
    </div>
  );
}
