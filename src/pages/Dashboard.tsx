import { lazy, Suspense, useEffect, useState } from 'react';
import { parseLocalDate } from '../lib/time';
import {
  fetchPlan,
  fetchStops,
  fetchRsvps,
  fetchSponsoredVenues,
  sortStops,
  sortStopsByTime,
  resequenceStopsByTime,
  type Plan,
  type Stop,
  type Rsvp,
  type SponsoredVenue,
} from '../lib/supabase';
import { mapsDirectionsUrl } from '../lib/maps';
import { useCountdown } from '../lib/countdown';
import { ChevronLeft, CalendarPlus, Clock, Check, X, Clock3, Navigation, Share2, Smartphone, Star } from 'lucide-react';
import { StopCard } from '../components/StopCard';
import { AddToCalendar } from '../components/AddToCalendar';
import { HostBadge } from '../components/Shared';
import { InviteFriendsModal } from '../components/InviteFriendsModal';
import { ShareOnSocialDialog } from '../components/ShareOnSocial';
import { buildInviteMessage, getShareUrl } from '../lib/invite';
import { planToCalendarEvent } from '../lib/calendar';

const VenueReviewsDialog = lazy(() => import('../components/SponsoredVenues').then((m) => ({ default: m.VenueReviewsDialog })));

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
  // Live sponsored venues: after the event, their stops can be reviewed for a credit.
  const [sponsored, setSponsored] = useState<SponsoredVenue[]>([]);
  const [reviewing, setReviewing] = useState<SponsoredVenue | null>(null);


  // Counts down to the first stop (or 7pm when there are no times), the same
  // start the calendar export uses.
  const event = plan ? planToCalendarEvent(plan, stops) : null;
  const countdown = useCountdown(event ? event.start.toISOString() : '2099-01-01');
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const isOver = !!event && Date.now() >= event.end.getTime();
  const sponsoredFor = (stop: Stop) =>
    sponsored.find((v) => v.id === stop.venue_partner_id)
    ?? (stop.venue_partner_id ? undefined : sponsored.find((v) => v.business_name.trim().toLowerCase() === stop.name.trim().toLowerCase()));
  const reviewable = isOver ? stops.map(sponsoredFor).filter((v): v is SponsoredVenue => !!v && v.can_review) : [];

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
        fetchSponsoredVenues().then((v) => { if (active) setSponsored(v); }, () => {});
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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
        <p className="text-destructive-text">Plan not found.</p>
        <button onClick={onBack} className="mt-4 text-primary-text underline">
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
    <div className="relative min-h-screen overflow-y-auto bg-background px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-3 top-3 flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted active:scale-95"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full">
        {/* Header */}
        <div className="rounded-lg border border-border bg-card p-5">
          <h1 className="text-title text-foreground">{plan.title}</h1>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarPlus size={14} className="text-muted-foreground" />
            {parseLocalDate(plan.date).toLocaleDateString('en-AU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        {/* Countdown */}
        <div className="mt-4 rounded-lg border border-border bg-card p-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <Clock size={14} /> Countdown
          </p>
          {event && (
            <p className="mt-1 text-sm font-semibold text-foreground">
              {event.start.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
              {' · '}
              {event.start.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}
            </p>
          )}
          <p className="mt-2 text-heading text-foreground">
            {!countdown.isPast
              ? `${plural(countdown.days, 'day')}, ${plural(countdown.hours, 'hour')}, ${plural(countdown.minutes, 'minute')}`
              : event && Date.now() < event.end.getTime()
                ? "It's on now!"
                : 'This event has passed'}
          </p>
          {isOver && reviewable.length > 0 && (
            <p className="mt-1 text-sm text-muted-foreground">Give a review and gain some credits</p>
          )}
        </div>

        {/* Confirmed count */}
        <div className="mt-4 flex items-center justify-between rounded-md border border-border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">Confirmed</span>
          <span className="text-heading text-foreground">
            {confirmedCount}/{rsvps.length} confirmed
          </span>
        </div>

        {/* RSVP list */}
        <div className="mt-6">
          <h2 className="mb-3 text-heading text-foreground">RSVP List</h2>
          {rsvps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No RSVPs yet.</p>
          ) : (
            <ul className="space-y-2">
              {rsvps.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-background px-4 py-3"
                >
                  <div>
                    <span className="font-medium text-foreground">{r.name}</span>
                    {r.is_host && <HostBadge />}
                    {r.status === 'declined' && r.decline_reason && (
                      <p className="text-xs text-muted-foreground">"{r.decline_reason}"</p>
                    )}
                  </div>
                  {r.status === 'in' && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
                      <Check size={16} /> In
                    </span>
                  )}
                  {r.status === 'declined' && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-destructive-text">
                      <X size={16} /> Can't make it
                    </span>
                  )}
                  {r.status === 'pending' && (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-warning">
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
          <h2 className="mb-3 text-heading text-foreground">Itinerary</h2>
          <div className="space-y-3">
            {stops.map((stop, i) => {
              const venue = isOver ? sponsoredFor(stop) : undefined;
              return (
                <div key={stop.id}>
                  <StopCard stop={stop} index={i} onSaved={handleStopSaved} />
                  {venue?.can_review && (
                    <button onClick={() => setReviewing(venue)} className={`${venue.reviewed_by_me ? 'btn-outline' : 'btn-secondary'} mt-2 w-full`}>
                      <Star size={18} /> {venue.reviewed_by_me ? 'See your review' : 'Leave a review · earn 1 credit'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {reviewing && (
          <Suspense fallback={null}>
            <VenueReviewsDialog
              venue={reviewing}
              onClose={() => setReviewing(null)}
              onChanged={() => fetchSponsoredVenues().then(setSponsored, () => {})}
            />
          </Suspense>
        )}

        {/* Action buttons */}
        <div className="mt-8 space-y-3">
          <a
            href={navUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline w-full"
          >
            <Navigation size={18} /> Open in Maps
          </a>
          <AddToCalendar plan={plan} stops={stops} />
          <button
            onClick={() => setInviteOpen(true)}
            className="btn-primary w-full"
          >
            <Smartphone size={18} /> Invite Friends
          </button>
          <button
            onClick={() => setShareOpen(true)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-6 py-3 text-base font-medium text-foreground transition-all active:scale-[0.98]"
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
