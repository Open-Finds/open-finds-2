import { useEffect, useState } from 'react';
import {
  fetchPlan,
  fetchStops,
  fetchRsvps,
  sortStops,
  type Plan,
  type Stop,
  type Rsvp,
} from '../lib/supabase';
import { Timeline, RsvpList } from '../components/Shared';
import { AddToCalendar } from '../components/AddToCalendar';
import { useCountdown, formatCountdown } from '../lib/countdown';
import { MapPin, PartyPopper, Clock, Smartphone, Check } from 'lucide-react';
import { buildInviteMessage, shareOrCopy } from '../lib/invite';
import { mapsDirectionsUrl } from '../lib/maps';

function getRsvpIdFromHash() {
  const hash = window.location.hash;
  const idx = hash.indexOf('?');
  if (idx === -1) return null;
  const params = new URLSearchParams(hash.slice(idx + 1));
  return params.get('rsvp');
}

export function ConfirmedPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [guestName, setGuestName] = useState('');
  const [inviteCopied, setInviteCopied] = useState(false);

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
        const rsvpId = getRsvpIdFromHash();
        if (rsvpId) {
          const found = r.find((x) => x.id === rsvpId);
          if (found) setGuestName(found.name);
        }
      } catch {
        // plan stays null → "Plan not found" shown below
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const countdown = useCountdown(plan?.date ?? '2099-01-01');

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-ink-secondary">Loading...</p>
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
  const shareUrl = `${window.location.origin}${window.location.pathname}#/plan/${id}/rsvp`;
  const multiStopMapsUrl = mapsDirectionsUrl(stops.map((s) => s.address), plan.location) ?? '#';

  const handleInviteFriend = async () => {
    const message = buildInviteMessage(plan);
    await shareOrCopy(plan.title, message, shareUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-8">
      <div className="text-center animate-fade-in">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full gold-gradient-bg shadow-gold-glow">
          <PartyPopper className="text-black" size={28} />
        </div>
        <h1 className="text-2xl font-bold">
          You're in{guestName ? `, ${guestName}` : ''}!
        </h1>
        <p className="mt-2 text-sm text-ink-secondary">
          See you there. Here's everything you need.
        </p>
      </div>

      {/* Quick actions */}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <a
          href={multiStopMapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary flex items-center justify-center gap-2"
        >
          <MapPin size={18} /> Open in Maps
        </a>
        <button onClick={handleInviteFriend} className="btn-primary flex items-center justify-center gap-2">
          {inviteCopied ? <Check size={18} /> : <Smartphone size={18} />}
          {inviteCopied ? 'Copied!' : 'Invite a Friend'}
        </button>
        {/* Guests get the same actions as the host — this was missing here. */}
        <AddToCalendar plan={plan} stops={stops} className="col-span-2" />
      </div>

      {/* Countdown */}
      <div className="card mt-6 text-center">
        <p className="flex items-center justify-center gap-1 text-sm text-ink-secondary">
          <Clock size={14} /> Time to go
        </p>
        <p className="mt-2 text-xl font-bold text-gold">
          {countdown.isPast
            ? "It's happening now!"
            : formatCountdown(countdown)}
        </p>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          {[
            { label: 'Days', value: countdown.days },
            { label: 'Hrs', value: countdown.hours },
            { label: 'Min', value: countdown.minutes },
            { label: 'Sec', value: countdown.seconds },
          ].map((u) => (
            <div
              key={u.label}
              className="rounded-xl border border-gold/20 bg-black/40 py-2"
            >
              <p className="text-lg font-bold text-white">
                {String(u.value).padStart(2, '0')}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-ink-secondary">
                {u.label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Itinerary */}
      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Your Itinerary</h2>
        <Timeline stops={stops} />
      </section>

      {/* RSVP list */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Who's Coming</h2>
          <span className="text-sm text-ink-secondary">
            {confirmedCount}/{rsvps.length} confirmed
          </span>
        </div>
        <RsvpList rsvps={rsvps} />
      </section>
    </div>
  );
}
