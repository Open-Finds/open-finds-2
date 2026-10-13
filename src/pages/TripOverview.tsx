import { useEffect, useState, useCallback } from 'react';
import { parseLocalDate } from '../lib/time';
import { navigate } from '../lib/router';
import {
  fetchTrip,
  fetchTripDays,
  fetchStops,
  fetchStopRsvps,
  cancelTrip,
  sortStops,
  type Trip,
  type Plan,
  type Stop,
} from '../lib/supabase';
import { appBase, shareOrCopy } from '../lib/invite';
import {
  ChevronLeft,
  CalendarDays,
  MapPin,
  Clock,
  Share2,
  UserPlus,
  Trash2,
  Compass,
  Check,
  X,
  Loader2,
} from 'lucide-react';

type DayWithStops = Plan & {
  stops: Stop[];
  stopRsvpCounts: Record<string, { in: number; out: number }>;
};

export function TripOverviewPage({ tripId }: { tripId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [days, setDays] = useState<DayWithStops[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [showShareCopied, setShowShareCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await fetchTrip(tripId);
      if (!t) {
        setError('Trip not found.');
        setLoading(false);
        return;
      }
      setTrip(t);

      const dayPlans = await fetchTripDays(tripId);
      const stopRsvps = await fetchStopRsvps(tripId);

      const daysWithData = await Promise.all(
        dayPlans.map(async (p) => {
          const stops = sortStops(await fetchStops(p.id));
          const rsvpCounts: Record<string, { in: number; out: number }> = {};
          for (const s of stops) {
            const sRsvps = stopRsvps.filter((r) => r.stop_id === s.id);
            rsvpCounts[s.id] = {
              in: sRsvps.filter((r) => r.status === 'in').length,
              out: sRsvps.filter((r) => r.status === 'out').length,
            };
          }
          return { ...p, stops, stopRsvpCounts: rsvpCounts };
        })
      );
      setDays(daysWithData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trip.');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-destructive-text">{error ?? 'Trip not found.'}</p>
        <button onClick={() => navigate('/')} className="btn-outline mt-4">
          Back home
        </button>
      </div>
    );
  }

  const totalStops = days.reduce((sum, d) => sum + d.stops.length, 0);

  const allAddresses = days.flatMap((d) => {
    const addrs: string[] = [];
    if (d.accommodation_address) addrs.push(d.accommodation_address);
    addrs.push(...d.stops.map((s) => s.address));
    return addrs;
  });
  const mapsOrigin = allAddresses[0] ?? trip.destination;
  const mapsWaypoints = allAddresses.slice(1, 10);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(mapsOrigin)}${
    mapsWaypoints.length > 0 ? `&waypoints=${encodeURIComponent(mapsWaypoints.join('|'))}` : ''
  }&destination=${encodeURIComponent(allAddresses[allAddresses.length - 1] ?? trip.destination)}`;

  const handleInvite = async () => {
    const message = `Join my trip "${trip.name}" to ${trip.destination}! ${trip.num_days} day${trip.num_days === 1 ? '' : 's'} of fun. RSVP to each stop here:`;
    const link = `${appBase()}#/trip/${tripId}/rsvp`;
    await shareOrCopy(trip.name, message, link);
  };

  const handleShare = async () => {
    const link = `${appBase()}#/trip/${tripId}`;
    const message = `Check out our trip "${trip.name}" to ${trip.destination}! ${link}`;
    try {
      await navigator.clipboard.writeText(message);
      setShowShareCopied(true);
      setTimeout(() => setShowShareCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleCancel = async () => {
    setCanceling(true);
    try {
      await cancelTrip(tripId);
      navigate('/');
    } catch {
      setCanceling(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-24 pt-8">
      <button
        onClick={() => navigate('/')}
        className="mb-6 flex items-center text-primary-text transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      {/* Trip Header */}
      <div className="animate-fade-in rounded-lg border border-border bg-card p-6 text-card-foreground shadow-1">
        <div className="flex items-center gap-2">
          <Compass size={20} />
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Trip
          </span>
        </div>
        <h1 className="mt-1 text-title leading-tight">{trip.name}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <MapPin size={15} /> {trip.destination}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={15} />
            {parseLocalDate(trip.start_date).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
            })}
            {' — '}
            {new Date(
              parseLocalDate(trip.start_date).getTime() +
                (trip.num_days - 1) * 86400000
            ).toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        </div>
        <p className="mt-2 text-small text-muted-foreground">
          {trip.num_days} day{trip.num_days === 1 ? '' : 's'} · {totalStops} stop
          {totalStops === 1 ? '' : 's'} · Hosted by {trip.host_name}
        </p>
      </div>

      {trip.status === 'canceled' && (
        <div className="mt-4 rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-center">
          <p className="font-bold text-destructive-text">This trip has been canceled.</p>
        </div>
      )}

      {/* Day Cards */}
      <div className="mt-8 space-y-4">
        {days.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No days found for this trip.
            </p>
          </div>
        ) : (
          days.map((day, idx) => (
            <button
              key={day.id}
              onClick={() => navigate(`/trip/${tripId}/day/${day.id}`)}
              className="w-full rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-input active:scale-[0.98]"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-border bg-background text-heading text-foreground">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-foreground">{day.title}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(day.date).toLocaleDateString('en-AU', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-foreground">
                    {day.stops.length} stop{day.stops.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>

              {/* Stop preview */}
              {day.stops.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                  {day.stops.slice(0, 4).map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Clock size={12} className="text-muted-foreground" />
                      <span className="w-12 shrink-0 text-muted-foreground">
                        {s.time}
                      </span>
                      <span className="truncate text-foreground">{s.name}</span>
                      {day.stopRsvpCounts[s.id] &&
                        (day.stopRsvpCounts[s.id].in > 0 ||
                          day.stopRsvpCounts[s.id].out > 0) && (
                          <span className="ml-auto flex shrink-0 items-center gap-2">
                            {day.stopRsvpCounts[s.id].in > 0 && (
                              <span className="flex items-center gap-0.5 text-success">
                                <Check size={11} />
                                {day.stopRsvpCounts[s.id].in}
                              </span>
                            )}
                            {day.stopRsvpCounts[s.id].out > 0 && (
                              <span className="flex items-center gap-0.5 text-destructive-text">
                                <X size={11} />
                                {day.stopRsvpCounts[s.id].out}
                              </span>
                            )}
                          </span>
                        )}
                    </div>
                  ))}
                  {day.stops.length > 4 && (
                    <p className="text-xs text-muted-foreground">
                      +{day.stops.length - 4} more...
                    </p>
                  )}
                </div>
              )}
            </button>
          ))
        )}
      </div>

      {/* Actions */}
      {trip.status !== 'canceled' && (
        <div className="mt-8 space-y-3">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline w-full"
          >
            <MapPin size={18} /> View All Stops in Maps
          </a>
          <button onClick={handleInvite} className="btn-primary w-full">
            <UserPlus size={18} /> Invite Friends
          </button>
          <button onClick={handleShare} className="btn-outline w-full">
            <Share2 size={18} />{' '}
            {showShareCopied ? 'Copied!' : 'Copy Trip Link'}
          </button>
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm font-medium text-destructive-text transition-all active:scale-[0.98]"
          >
            <Trash2 size={18} /> Cancel Trip
          </button>
        </div>
      )}

      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 px-6"
          onClick={() => !canceling && setShowCancelConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-heading text-foreground">Cancel this trip?</h2>
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={canceling}
                aria-label="Close"
                className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <X size={20} />
                </button>
            </div>
            <p className="mb-6 text-sm text-muted-foreground">
              "{trip.name}" will be marked as canceled. Friends with the link will
              see a cancellation notice, but the itinerary stays visible.
            </p>
            <div className="space-y-3">
              <button
                onClick={handleCancel}
                disabled={canceling}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md bg-destructive px-4 py-3 text-sm font-bold text-destructive-foreground transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {canceling ? 'Canceling...' : 'Yes, Cancel Trip'}
              </button>
              <button
                onClick={() => setShowCancelConfirm(false)}
                disabled={canceling}
                className="flex min-h-[44px] w-full items-center justify-center rounded-md border border-border bg-background px-4 py-3 text-sm font-medium text-muted-foreground transition-all active:scale-[0.98] disabled:opacity-50"
              >
                Never mind
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
