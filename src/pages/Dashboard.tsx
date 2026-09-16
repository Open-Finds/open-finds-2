import { useEffect, useState } from 'react';
import {
  fetchPlan,
  fetchStops,
  fetchRsvps,
  sortStops,
  sortStopsByTime,
  resequenceStopsByTime,
  fetchFriends,
  fetchFriendGroups,
  inviteUserToPlan,
  inviteGroupToPlan,
  type Plan,
  type Stop,
  type Rsvp,
  type FriendWithProfile,
  type FriendGroupWithMembers,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useCountdown } from '../lib/countdown';
import { ChevronLeft, CalendarPlus, Clock, Check, X, Clock3, Navigation, Send, Copy, Share2, Users } from 'lucide-react';
import { StopCard } from '../components/StopCard';
import { formatTime } from '../lib/time';

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
  const [showShare, setShowShare] = useState(false);
  const [copied, setCopied] = useState(false);

  const { displayName } = useAuth();

  const countdown = useCountdown(plan ? `${plan.date}T19:00:00` : '2099-01-01');

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

  const shareUrl = `${window.location.origin}${window.location.pathname}#/plan/${id}/rsvp`;
  const formattedDate = new Date(`${plan.date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const senderName = displayName || plan.host_name;
  const shareMessage = `${senderName} has invited you to ${plan.title} on ${formattedDate} through Open Finds\n\nOpen here: ${shareUrl}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: plan.title, text: shareMessage, url: shareUrl });
      } catch {
        /* cancelled */
      }
    } else {
      handleCopy();
    }
  };

  // Multi-stop Google Maps directions — all stops in chronological order
  const firstStop = stops[0];
  const navUrl = (() => {
    if (stops.length === 0) return '#';
    const params = new URLSearchParams({ api: '1', origin: 'Current Location' });
    if (stops.length === 1) {
      params.set('destination', stops[0].address);
    } else {
      params.set('destination', stops[stops.length - 1].address);
      params.set('waypoints', stops.slice(0, -1).map((s) => s.address).join('|'));
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  })();

  // Google Calendar deep link
  const start = new Date(`${plan.date}T19:00:00`);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const details = stops.map((s, i) => `${i + 1}. ${formatTime(s.time)} — ${s.name}, ${s.address}`).join('\n');
  const calendarUrl = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE',
    text: plan.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: firstStop?.address ?? plan.location,
    details,
  }).toString()}`;

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
            {new Date(plan.date).toLocaleDateString('en-AU', {
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
          <p className="mt-2 text-xl font-bold text-gold">
            {countdown.days} days, {countdown.hours} hours, {countdown.minutes} minutes
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
          <a
            href={calendarUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
          >
            <CalendarPlus size={18} /> Add to Calendar
          </a>
          <button
            onClick={() => setShowShare(true)}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
          >
            <Send size={18} /> Invite a Friend
          </button>
        </div>
      </div>

      {showShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-sm rounded-card border border-gold/20 bg-[#0d0d0d] p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Share your plan</h2>
              <button
                onClick={() => setShowShare(false)}
                className="text-ink-secondary transition-colors hover:text-white"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            <p className="mb-4 text-sm text-ink-secondary">
              Send this link so friends can RSVP to{' '}
              <span className="font-medium text-white">{plan.title}</span>.
            </p>

            <div className="mb-3 rounded-lg border border-gold/20 bg-black/40 px-3 py-2.5">
              <p className="text-xs text-ink-secondary leading-relaxed break-words">{shareMessage}</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleCopy}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98]"
              >
                <Copy size={18} /> {copied ? 'Copied!' : '📋 Copy Invite'}
              </button>
              <button
                onClick={handleNativeShare}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
              >
                <Share2 size={18} /> Share via WhatsApp / Telegram
              </button>
            </div>

            <div className="mt-5 border-t border-gold/10 pt-4">
              <p className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gold">
                <Users size={15} /> Invite from Friends
              </p>
              <InviteSection planId={id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteSection({ planId }: { planId: string }) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [groups, setGroups] = useState<FriendGroupWithMembers[]>([]);
  const [loading, setLoading] = useState(true);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [inviting, setInviting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [f, g] = await Promise.all([fetchFriends(), fetchFriendGroups()]);
        setFriends(f.filter((x) => x.status === 'accepted'));
        setGroups(g);
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleInviteUser = async (userId: string) => {
    setInviting(userId);
    try {
      await inviteUserToPlan(planId, userId);
      setInvited((prev) => new Set(prev).add(userId));
    } catch { /* ignore */ } finally {
      setInviting(null);
    }
  };

  const handleInviteGroup = async (groupId: string) => {
    setInviting(groupId);
    try {
      await inviteGroupToPlan(planId, groupId);
      setInvited((prev) => new Set(prev).add(groupId));
    } catch { /* ignore */ } finally {
      setInviting(null);
    }
  };

  if (loading) return <p className="text-sm text-ink-secondary">Loading...</p>;

  if (friends.length === 0 && groups.length === 0) {
    return <p className="text-sm text-ink-secondary">Add friends first to invite them directly.</p>;
  }

  return (
    <div className="space-y-3">
      {groups.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold/50">Groups</p>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => handleInviteGroup(g.id)}
              disabled={invited.has(g.id) || inviting === g.id}
              className="flex w-full items-center justify-between rounded-card border border-gold/20 bg-[#1a1a1a] p-3 text-left transition-all active:scale-[0.98] hover:border-gold/40 disabled:opacity-50"
            >
              <div>
                <p className="text-sm font-semibold text-white">{g.name}</p>
                <p className="text-xs text-ink-secondary">{g.members.length} members</p>
              </div>
              {invited.has(g.id) ? (
                <span className="text-sm text-success"><Check size={16} /></span>
              ) : inviting === g.id ? (
                <span className="text-sm text-gold">...</span>
              ) : (
                <Send size={16} className="text-gold/60" />
              )}
            </button>
          ))}
        </div>
      )}

      {friends.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold/50">Friends</p>
          {friends.map((f) => (
            <button
              key={f.user_id}
              onClick={() => handleInviteUser(f.user_id)}
              disabled={invited.has(f.user_id) || inviting === f.user_id}
              className="flex w-full items-center justify-between rounded-card border border-gold/20 bg-[#1a1a1a] p-3 text-left transition-all active:scale-[0.98] hover:border-gold/40 disabled:opacity-50"
            >
              <div>
                <p className="text-sm font-semibold text-white">{f.display_name}</p>
                <p className="text-xs text-ink-secondary">@{f.username}</p>
              </div>
              {invited.has(f.user_id) ? (
                <span className="text-sm text-success"><Check size={16} /></span>
              ) : inviting === f.user_id ? (
                <span className="text-sm text-gold">...</span>
              ) : (
                <Send size={16} className="text-gold/60" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}