import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import { formatTime } from '../lib/time';
import {
  supabase,
  fetchPlan,
  fetchStops,
  fetchRsvps,
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
import { CalendarDays, MapPin, Check, X, CalendarPlus } from 'lucide-react';

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
        <p className="text-ink-secondary">Loading...</p>
      </div>
    );
  }
  if (fetchError) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-danger font-semibold">Could not load this plan.</p>
        <p className="mt-2 text-sm text-ink-secondary">{fetchError}</p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-danger">Plan not found.</p>
      </div>
    );
  }

  const confirmedCount = rsvps.filter((r) => r.status === 'in').length;

  const openGoogleCalendar = () => {
    const start = new Date(plan.date);
    const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
    const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const details = stops.length > 0
      ? stops.map((s) => `${formatTime(s.time)} ${s.name} - ${s.address}`).join('\n')
      : `Join us for ${plan.title}`;
    const location = stops[0]?.address ?? plan.location;
    const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(plan.title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(details)}&location=${encodeURIComponent(location)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const submitRsvp = async (status: 'in' | 'declined') => {
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data, error: insErr } = await supabase
        .from('rsvps')
        .insert({
          plan_id: id,
          name: name.trim(),
          status,
          auth_uid: isSignedIn ? session!.user.id : null,
        })
        .select()
        .single();
      if (insErr) throw insErr;
      const rsvpId = (data as Rsvp).id;
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
        <div className="mb-6 rounded-card border border-danger/40 bg-danger/10 px-4 py-3 text-center">
          <p className="font-bold text-danger">This event has been canceled by the host.</p>
        </div>
      )}

      <div className="mb-6 text-center">
        <p className="text-sm text-ink-secondary">You are invited to</p>
        <h1 className="mt-1 text-2xl font-bold text-gold leading-tight">{plan.title}</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          by <span className="font-semibold text-white">{plan.host_name}</span>
        </p>
      </div>

      <div className="gold-gradient-bg animate-fade-in rounded-card p-5 text-black shadow-gold-glow">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-black/80">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={15} />
            {new Date(plan.date).toLocaleDateString('en-AU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={15} /> {plan.location}
          </span>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">The Plan</h2>
        <Timeline stops={stops} />
      </section>

      {!plan.canceled && (
        <div className="mt-6">
          <button
            onClick={openGoogleCalendar}
            className="btn-secondary w-full"
          >
            <CalendarPlus size={18} /> Add to Calendar
          </button>
        </div>
      )}

      {!plan.canceled && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Are you in?</h2>
          {isSignedIn ? (
            <div className="mb-4 rounded-card border border-gold/20 bg-surface px-4 py-3">
              <p className="text-sm text-ink-secondary">Responding as</p>
              <p className="text-lg font-semibold text-white">{displayName || name || 'You'}</p>
            </div>
          ) : (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full touch-target rounded-card border border-gold/20 bg-surface px-4 text-white placeholder-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
            />
          )}
          {error && (
            <p className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
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
              className="btn-secondary disabled:opacity-40"
            >
              <X size={18} /> Can't Make It
            </button>
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            Who's Coming ({confirmedCount}/{rsvps.length})
          </h2>
        </div>
        <RsvpList rsvps={rsvps} />
      </section>
    </div>
  );
}
