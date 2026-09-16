import { useEffect, useState } from 'react';
import { navigate } from '../lib/router';
import {
  fetchPlan,
  fetchStops,
  fetchRsvps,
  sortStops,
  type Plan,
  type Stop,
  type Rsvp,
} from '../lib/supabase';
import { Timeline, RsvpList, BackButton } from '../components/Shared';
import { InviteFriendsModal } from '../components/InviteFriendsModal';
import { CalendarDays, MapPin, Send, LayoutDashboard, Smartphone, Share2, UserPlus } from 'lucide-react';
import { buildInviteMessage, shareOrCopy } from '../lib/invite';

export function PlanViewPage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
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
        setError(e instanceof Error ? e.message : 'Failed to load plan');
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
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-ink-secondary">Loading plan...</p>
      </div>
    );
  }
  if (error || !plan) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-danger">{error ?? 'Plan not found.'}</p>
        <button onClick={() => navigate('/')} className="btn-secondary mt-4">
          Back home
        </button>
      </div>
    );
  }

  const confirmedCount = rsvps.filter((r) => r.status === 'in').length;
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(
    stops.map((s) => s.address).join(' | ') || (plan.location ?? '')
  )}`;

  const handleInviteFriend = async () => {
    const message = buildInviteMessage(plan);
    await shareOrCopy(plan.title, message, `${window.location.origin}${window.location.pathname}#/plan/${id}/rsvp`);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-8">
      {/* Hero */}
      <div className="gold-gradient-bg animate-fade-in rounded-card p-6 text-black shadow-gold-glow">
        <h1 className="text-2xl font-bold leading-tight">{plan.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-black/80">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={15} />
            {new Date(plan.date).toLocaleDateString('en-AU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={15} /> {plan.location}
          </span>
        </div>
        <p className="mt-2 text-sm font-medium text-black/70">
          Hosted by {plan.host_name}
        </p>
      </div>

      {/* Timeline */}
      <section className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">The Itinerary</h2>
        <Timeline stops={stops} />
      </section>

      {/* Who's coming */}
      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Who's Coming</h2>
          <span className="text-sm text-ink-secondary">
            {confirmedCount}/{rsvps.length} confirmed
          </span>
        </div>
        <RsvpList rsvps={rsvps} />
      </section>

      {/* Actions */}
      <div className="mt-8 space-y-3">
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary w-full"
        >
          <MapPin size={18} /> Open in Google Maps
        </a>
        <button
          onClick={() => setShowInviteModal(true)}
          className="btn-primary w-full"
        >
          <UserPlus size={18} /> Invite Friends
        </button>
        <button
          onClick={handleInviteFriend}
          className="btn-secondary w-full"
        >
          <Smartphone size={18} /> {inviteCopied ? 'Copied!' : 'Copy Invite Link'}
        </button>
        <button
          onClick={() => navigate(`/plan/${id}/share`)}
          className="btn-secondary w-full"
        >
          <Send size={18} /> Send RSVPs
        </button>
        <button
          onClick={() => navigate(`/plan/${id}/dashboard`)}
          className="btn-secondary w-full"
        >
          <LayoutDashboard size={18} /> Host Dashboard
        </button>
      </div>

      <InviteFriendsModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        planId={id}
      />
    </div>
  );
}

export function SharePage({ id }: { id: string }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, r] = await Promise.all([fetchPlan(id), fetchRsvps(id)]);
        if (!active) return;
        setPlan(p);
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

  const shareUrl = `${window.location.origin}${window.location.pathname}#/plan/${id}`;
  const shareMessage = `You're invited to ${plan.title} by ${plan.host_name}! Open here: ${shareUrl}`;
  const confirmedCount = rsvps.filter((r) => r.status === 'in').length;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: plan.title,
          text: shareMessage,
          url: shareUrl,
        });
      } catch {
        // user cancelled
      }
    }
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-8">
      <BackButton to={`/plan/${id}`} />

      <h1 className="text-2xl font-bold">Share your plan</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Send this link to your friends so they can RSVP.
      </p>

      <div className="card mt-6 break-all text-sm text-ink-secondary">
        {shareMessage}
      </div>

      <button onClick={handleCopy} className="btn-primary mt-4 w-full">
        <Share2 size={18} /> {copied ? 'Copied!' : 'Copy Link'}
      </button>
      <p className="mt-2 text-center text-xs text-ink-secondary">
        {typeof navigator.share === 'function'
          ? 'Opens share sheet for WhatsApp, Telegram, Instagram...'
          : 'Link copied to clipboard'}
      </p>

      <section className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">RSVP Responses</h2>
          <span className="text-sm text-ink-secondary">
            {confirmedCount}/{rsvps.length} confirmed
          </span>
        </div>
        <RsvpList rsvps={rsvps} />
      </section>
    </div>
  );
}
