import { useEffect, useState } from 'react';
import { parseLocalDate } from '../lib/time';
import { navigate } from '../lib/router';
import {
  fetchPlan,
  fetchStops,
  fetchRsvps,
  insertRsvp,
  sortStops,
  setGuestName,
  sendGuestRsvpPushNotification,
  type Plan,
  type Stop,
  type Rsvp,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { Timeline, RsvpList } from '../components/Shared';
import { Confetti } from '../components/Confetti';
import { AddToCalendar } from '../components/AddToCalendar';
import { CalendarDays, MapPin, Check, X, Navigation } from 'lucide-react';
import { mapsDirectionsUrl } from '../lib/maps';

export function RsvpPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { session, displayName } = useAuth();
  const isSignedIn = !!session;

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
      } catch (e) {
        if (active) setFetchError(e instanceof Error ? e.message : 'Failed to load plan');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (isSignedIn && displayName) {
      setName(displayName);
    }
  }, [isSignedIn, displayName]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-destructive-text font-semibold">Could not load this plan.</p>
        <p className="mt-2 text-sm text-muted-foreground">{fetchError}</p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-destructive-text">Plan not found.</p>
      </div>
    );
  }

  const confirmedCount = rsvps.filter((r) => r.status === 'in').length;
  const mapsUrl = mapsDirectionsUrl(stops.map((s) => s.address), plan.location);


  const submitRsvp = async (status: 'in' | 'declined') => {
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Guests cannot INSERT into rsvps directly; insertRsvp() goes through the
      // submit_plan_rsvp RPC, which validates the plan and bounds the input.
      const created = await insertRsvp({ plan_id: id, name: name.trim(), status });
      const rsvpId = created.id;
      await sendGuestRsvpPushNotification({ planId: id, rsvpName: name.trim(), rsvpStatus: status });
      if (status === 'in') {
        if (!isSignedIn) setGuestName(name.trim());
        setCelebrating(true);
        setTimeout(() => navigate(`/plan/${id}/confirmed?rsvp=${rsvpId}`), 1500);
      } else {
        navigate(`/plan/${id}/declined?rsvp=${rsvpId}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit RSVP');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-8">
      {celebrating && <Confetti />}
      {plan.canceled && (
        <div className="mb-6 rounded-md border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-center">
          <p className="font-bold text-destructive-text">This event has been canceled by the host.</p>
        </div>
      )}

      <div className="mb-6 text-center">
        <p className="text-sm text-muted-foreground">You are invited to</p>
        <h1 className="mt-1 text-title text-foreground leading-tight">{plan.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          by <span className="font-semibold text-foreground">{plan.host_name}</span>
        </p>
      </div>

      <div className="animate-fade-in rounded-lg border border-border bg-card p-5 text-card-foreground shadow-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={15} />
            {parseLocalDate(plan.date).toLocaleDateString('en-AU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
          {plan.location?.trim() && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={15} /> {plan.location}
            </span>
          )}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-heading">The Plan</h2>
        <Timeline stops={stops} />
      </section>

      {!plan.canceled && (
        <div className="mt-6 grid grid-cols-1 gap-3">
          {mapsUrl && (
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline flex items-center justify-center gap-2"
            >
              <Navigation size={18} /> Open in Maps
            </a>
          )}
          <AddToCalendar plan={plan} stops={stops} />
        </div>
      )}

      {!plan.canceled && (
        <section className="mt-8">
          <h2 className="mb-3 text-heading">Are you in?</h2>
          {isSignedIn ? (
            <div className="mb-4 rounded-md border border-border bg-card px-4 py-3">
              <p className="text-sm text-muted-foreground">Responding as</p>
              <p className="text-heading text-foreground">{displayName || name || 'You'}</p>
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
          {error && (
            <p className="mt-3 rounded-xl border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-text">
              {error}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              onClick={() => submitRsvp('in')}
              disabled={submitting}
              className="btn-primary disabled:opacity-40"
            >
              <Check size={18} /> I'm In
            </button>
            <button
              onClick={() => submitRsvp('declined')}
              disabled={submitting}
              className="btn-outline disabled:opacity-40"
            >
              <X size={18} /> Can't Make It
            </button>
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-heading">
            Who's Coming ({confirmedCount}/{rsvps.length})
          </h2>
        </div>
        <RsvpList rsvps={rsvps} />
      </section>
    </div>
  );
}
