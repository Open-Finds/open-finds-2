import { useEffect, useState } from 'react';
import { parseLocalDate } from '../lib/time';
import { navigate } from '../lib/router';
import {
  fetchTrip,
  fetchTripDays,
  fetchStops,
  fetchStopRsvps,
  upsertStopRsvp,
  sortStops,
  type Trip,
  type Plan,
  type Stop,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Confetti } from '../components/Confetti';
import { CheckItOut } from '../components/CheckItOut';
import {
  ChevronLeft,
  CalendarDays,
  MapPin,
  Clock,
  Check,
  X,
  Loader2,
  Compass,
} from 'lucide-react';

type DayData = {
  plan: Plan;
  stops: Stop[];
};

type StopRsvpMap = Record<string, 'in' | 'out'>;

export function TripRsvpPage({ tripId }: { tripId: string }) {
  const { session, displayName } = useAuth();
  const isSignedIn = !!session;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [days, setDays] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rsvpMap, setRsvpMap] = useState<StopRsvpMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const t = await fetchTrip(tripId);
        if (!active) return;
        if (!t) {
          setError('Trip not found.');
          setLoading(false);
          return;
        }
        setTrip(t);

        const dayPlans = await fetchTripDays(tripId);
        await fetchStopRsvps(tripId);
        if (!active) return;

        const daysWithData = await Promise.all(
          dayPlans.map(async (p) => ({
            plan: p,
            stops: sortStops(await fetchStops(p.id)),
          }))
        );
        if (!active) return;
        setDays(daysWithData);
      } catch (e) {
        if (active)
          setError(e instanceof Error ? e.message : 'Failed to load trip.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [tripId]);

  useEffect(() => {
    if (isSignedIn && displayName) setName(displayName);
  }, [isSignedIn, displayName]);

  const toggleStop = (stopId: string, status: 'in' | 'out') => {
    setRsvpMap((prev) => {
      const next = { ...prev };
      if (next[stopId] === status) {
        delete next[stopId];
      } else {
        next[stopId] = status;
      }
      return next;
    });
  };

  const totalStops = days.reduce((sum, d) => sum + d.stops.length, 0);
  const inCount = Object.values(rsvpMap).filter((v) => v === 'in').length;
  const outCount = Object.values(rsvpMap).filter((v) => v === 'out').length;
  const unmarkedCount = totalStops - inCount - outCount;

  const handleSubmit = async () => {
    if (!name.trim()) {
      setSubmitError('Please enter your name.');
      return;
    }
    if (Object.keys(rsvpMap).length === 0) {
      setSubmitError('Please mark at least one stop.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      for (const [stopId, status] of Object.entries(rsvpMap)) {
        const stop = days.flatMap((d) => d.stops).find((s) => s.id === stopId);
        if (!stop) continue;
        const plan = days.find((d) => d.stops.some((s) => s.id === stopId));
        if (!plan) continue;
        await upsertStopRsvp(stopId, plan.plan.id, tripId, name.trim(), status);
      }
      if (inCount > 0) {
        setCelebrating(true);
        setTimeout(() => navigate(`/trip/${tripId}`), 2000);
      } else {
        navigate(`/trip/${tripId}`);
      }
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Failed to submit RSVPs.'
      );
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-24 pt-8">
      {celebrating && <Confetti />}

      {trip.status === 'canceled' && (
        <div className="mb-6 rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-center">
          <p className="font-bold text-destructive-text">
            This trip has been canceled by the host.
          </p>
        </div>
      )}

      <button
        onClick={() => navigate(`/trip/${tripId}`)}
        className="mb-6 flex items-center text-primary-text transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      {/* Trip Header */}
      <div className="animate-fade-in rounded-lg border border-border bg-card p-5 text-card-foreground shadow-1">
        <div className="flex items-center gap-2">
          <Compass size={18} />
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Trip RSVP
          </span>
        </div>
        <h1 className="mt-1 text-title leading-tight">{trip.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted-foreground">
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
        <p className="mt-1 text-small text-muted-foreground">
          by {trip.host_name}
        </p>
      </div>

      {/* Instructions */}
      <div className="mt-6 rounded-lg border border-border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Mark each stop as{' '}
          <span className="font-semibold text-success">In</span> or{' '}
          <span className="font-semibold text-destructive-text">Skip</span>. You can
          pick and choose — come to dinner but skip the morning activity!
        </p>
      </div>

      {/* Days with per-stop RSVP */}
      <div className="mt-6 space-y-6">
        {days.map((day, dayIdx) => (
          <div key={day.plan.id}>
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-border bg-background text-sm font-bold text-foreground">
                {dayIdx + 1}
              </span>
              <div>
                <h2 className="font-bold text-foreground">{day.plan.title}</h2>
                <p className="text-xs text-muted-foreground">
                  {new Date(day.plan.date).toLocaleDateString('en-AU', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  })}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {day.stops.map((stop) => {
                const status = rsvpMap[stop.id];
                return (
                  <div
                    key={stop.id}
                    className="rounded-xl border border-border bg-background p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Clock size={12} className="text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">{stop.time}</span>
                        </div>
                        <h3 className="mt-1 truncate text-sm font-semibold text-foreground">
                          {stop.name}
                        </h3>
                        <p className="truncate text-xs text-muted-foreground">
                          {stop.address}
                        </p>
                        <CheckItOut link={stop.vibe_link} variant="pill" className="mt-2" />
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => toggleStop(stop.id, 'in')}
                          className={`flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-90 ${
                            status === 'in'
                              ? 'bg-success text-foreground'
                              : 'border border-success/30 bg-background text-success hover:border-success hover:text-success'
                          }`}
                          aria-label="I'm in for this stop"
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => toggleStop(stop.id, 'out')}
                          className={`flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-90 ${
                            status === 'out'
                              ? 'bg-destructive text-destructive-foreground'
                              : 'border border-destructive-text/30 bg-background text-destructive-text hover:border-destructive-text hover:text-destructive-text'
                          }`}
                          aria-label="Skip this stop"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      {totalStops > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">
            You're in for{' '}
            <span className="font-bold text-success">{inCount}</span> of{' '}
            {totalStops} stops
            {outCount > 0 && (
              <>
                , skipping <span className="font-bold text-destructive-text">{outCount}</span>
              </>
            )}
            {unmarkedCount > 0 && (
              <>
                , <span className="text-muted-foreground">{unmarkedCount} undecided</span>
              </>
            )}
          </p>
        </div>
      )}

      {/* Name input and submit */}
      {trip.status !== 'canceled' && (
        <div className="mt-8">
          {isSignedIn ? (
            <div className="mb-4 rounded-md border border-border bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">Responding as</p>
              <p className="text-heading text-foreground">
                {displayName || name || 'You'}
              </p>
            </div>
          ) : (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full touch-target rounded-md border border-input bg-card px-4 text-foreground placeholder:text-muted-foreground outline-none transition-all focus:border-ring"
            />
          )}

          {submitError && (
            <p className="mt-3 rounded-xl border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-text">
              {submitError}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || Object.keys(rsvpMap).length === 0}
            className="btn-primary mt-4 w-full disabled:opacity-40"
          >
            {submitting ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Submitting...
              </>
            ) : (
              <>
                <Check size={18} /> Submit RSVP
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
