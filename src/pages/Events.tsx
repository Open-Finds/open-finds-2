import { useEffect, useState } from 'react';
import {
  fetchAllPlans,
  fetchCanceledPlans,
  fetchRsvps,
  fetchStops,
  markPlanCanceled,
  deletePlan,
  getGuestName,
  fetchConfirmedPlanIds,
  fetchPlansByIds,
  fetchInvitedPlanIds,
  fetchAllTrips,
  fetchTripDays,
  type Plan,
  type Trip,
} from '../lib/supabase';
import { navigate } from '../lib/router';
import { CalendarDays, MapPin, Users, ChevronRight, Trash2, X, Compass } from 'lucide-react';

type PlanWithMeta = Plan & {
  stopCount: number;
  confirmedCount: number;
  rsvpTotal: number;
  isGuest: boolean;
};

type TripWithMeta = Trip & {
  dayCount: number;
  totalStops: number;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function EventsPage({
  onOpenPlan,
}: {
  onOpenPlan: (planId: string) => void;
}) {
  const [upcoming, setUpcoming] = useState<PlanWithMeta[]>([]);
  const [canceled, setCanceled] = useState<PlanWithMeta[]>([]);
  const [trips, setTrips] = useState<TripWithMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  const enrichPlan = async (
    p: Plan,
    isGuest: boolean
  ): Promise<PlanWithMeta> => {
    const [stops, rsvps] = await Promise.all([fetchStops(p.id), fetchRsvps(p.id)]);
    return {
      ...p,
      stopCount: stops.length,
      confirmedCount: rsvps.filter((r) => r.status === 'in').length,
      rsvpTotal: rsvps.length,
      isGuest,
    };
  };

  const load = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const todayStr = today.toISOString().slice(0, 10);

      // Fetch hosted plans (active + canceled) and guest-confirmed plans
      const [hostedActive, hostedCanceled] = await Promise.all([
        fetchAllPlans(),
        fetchCanceledPlans(),
      ]);

      const guestName = getGuestName();
      const confirmedIds = await fetchConfirmedPlanIds(guestName);
      const hostedIds = new Set([...hostedActive, ...hostedCanceled].map((p) => p.id));
      const guestOnlyIds = confirmedIds.filter((id) => !hostedIds.has(id));
      const guestPlans = await fetchPlansByIds(guestOnlyIds);

      // Fetch plans shared via friends/groups (plan_invites)
      const invitedIds = await fetchInvitedPlanIds();
      const invitedOnlyIds = invitedIds.filter((id) => !hostedIds.has(id) && !confirmedIds.includes(id));
      const invitedPlans = await fetchPlansByIds(invitedOnlyIds);

      // Auto-cancel past hosted events that are still active
      const pastActive = hostedActive.filter((p) => p.date < todayStr);
      if (pastActive.length > 0) {
        await Promise.all(pastActive.map((p) => markPlanCanceled(p.id)));
      }

      // Auto-delete canceled events older than 30 days
      const oldCanceled = hostedCanceled.filter(
        (p) => today.getTime() - new Date(p.date).getTime() > THIRTY_DAYS_MS
      );
      if (oldCanceled.length > 0) {
        await Promise.all(oldCanceled.map((p) => deletePlan(p.id)));
      }

      // Merge active hosted + guest plans + invited plans, then split by date
      const allActive = [...hostedActive, ...guestPlans, ...invitedPlans];
      const enrichedActive = await Promise.all(
        allActive.map((p) => enrichPlan(p, !hostedIds.has(p.id)))
      );
      const upcomingPlans = enrichedActive.filter((p) => p.date >= todayStr);
      const pastStillActive = enrichedActive.filter((p) => p.date < todayStr);

      // Merge newly-auto-canceled with existing canceled (minus deleted old ones)
      const remainingCanceled = hostedCanceled.filter(
        (p) => today.getTime() - new Date(p.date).getTime() <= THIRTY_DAYS_MS
      );
      const allCanceled = [...remainingCanceled, ...pastActive, ...pastStillActive];
      const dedupedCanceled = Array.from(
        new Map(allCanceled.map((p) => [p.id, p])).values()
      );
      const enrichedCanceled = await Promise.all(
        dedupedCanceled.map((p) => enrichPlan(p, !hostedIds.has(p.id)))
      );

      setUpcoming(upcomingPlans);
      setCanceled(enrichedCanceled);

      // Fetch trips
      try {
        const allTrips = await fetchAllTrips();
        const tripsWithMeta = await Promise.all(
          allTrips.map(async (t) => {
            const days = await fetchTripDays(t.id);
            const totalStops = await days.reduce(async (sum, d) => {
              const s = await sum;
              const stops = await fetchStops(d.id);
              return s + stops.length;
            }, Promise.resolve(0));
            return { ...t, dayCount: days.length, totalStops };
          })
        );
        setTrips(tripsWithMeta);
      } catch {
        // ignore trip fetch errors
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancel = async () => {
    if (!confirmId) return;
    setCanceling(true);
    try {
      await markPlanCanceled(confirmId);
      const canceledPlan = upcoming.find((p) => p.id === confirmId);
      setUpcoming((prev) => prev.filter((p) => p.id !== confirmId));
      if (canceledPlan) {
        setCanceled((prev) => [canceledPlan, ...prev]);
      }
      setConfirmId(null);
    } catch {
      /* ignore */
    } finally {
      setCanceling(false);
    }
  };

  const confirmPlan = upcoming.find((p) => p.id === confirmId);

  const renderPlanCard = (p: PlanWithMeta) => (
    <div
      key={p.id}
      className="relative flex items-center gap-3 rounded-card border border-gold/20 bg-[#1a1a1a] p-4 transition-all hover:border-gold/50"
    >
      <button
        onClick={() => onOpenPlan(p.id)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.98]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-white">{p.title}</h3>
            {p.isGuest && (
              <span className="shrink-0 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                Guest
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-secondary">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} className="text-gold/70" />
              {new Date(p.date).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin size={14} className="text-gold/70" /> {p.stopCount} stop{p.stopCount === 1 ? '' : 's'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users size={14} className="text-gold/70" />
              {p.confirmedCount}/{p.rsvpTotal} confirmed
            </span>
          </div>
        </div>
        <ChevronRight size={20} className="shrink-0 text-gold/60" />
      </button>
      {p.isGuest ? (
        <div className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center">
          <Users size={15} className="text-gold/40" />
        </div>
      ) : (
        <button
          onClick={() => setConfirmId(p.id)}
          aria-label="Cancel event"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-danger/70 transition-all hover:bg-danger/10 hover:text-danger active:scale-90"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );

  const renderTripCard = (t: TripWithMeta) => (
    <div
      key={t.id}
      className="relative flex items-center gap-3 rounded-card border-2 border-gold/30 bg-[#1a1a1a] p-4 transition-all hover:border-gold/50"
    >
      <button
        onClick={() => navigate(`/trip/${t.id}`)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left active:scale-[0.98]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-black">
          <Compass size={18} className="text-gold" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-bold text-white">{t.name}</h3>
            <span className="shrink-0 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
              Trip
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-secondary">
            <span className="inline-flex items-center gap-1">
              <MapPin size={14} className="text-gold/70" /> {t.destination}
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={14} className="text-gold/70" />
              {new Date(t.start_date).toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
              })}
              {t.num_days > 1 && (
                <> — {new Date(new Date(t.start_date).getTime() + (t.num_days - 1) * 86400000).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</>
              )}
            </span>
            <span className="inline-flex items-center gap-1">
              <Compass size={14} className="text-gold/70" /> {t.dayCount} day{t.dayCount === 1 ? '' : 's'} · {t.totalStops} stop{t.totalStops === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <ChevronRight size={20} className="shrink-0 text-gold/60" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen overflow-y-auto bg-black px-6 pt-8 pb-24">
      <div className="mx-auto w-full">
        <h1 className="mb-6 text-2xl font-bold text-white">Upcoming Events</h1>

        {loading ? (
          <p className="text-sm text-ink-secondary">Loading...</p>
        ) : (
          <>
            {upcoming.length === 0 && canceled.length === 0 && trips.length === 0 ? (
              <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
                <p className="text-sm text-ink-secondary">
                  No events yet. Start planning from the Home tab.
                </p>
              </div>
            ) : (
              <>
                {trips.length > 0 && (
                  <div className="listing-grid mb-6">
                    <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
                      Trips
                    </h2>
                    {trips.map(renderTripCard)}
                  </div>
                )}

                {upcoming.length > 0 && (
                  <div className="listing-grid">
                    {trips.length > 0 && (
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
                        Single Events
                      </h2>
                    )}
                    {upcoming.map(renderPlanCard)}
                  </div>
                )}

                {upcoming.length === 0 && canceled.length > 0 && trips.length === 0 && (
                  <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
                    <p className="text-sm text-ink-secondary">
                      No upcoming events. Canceled events shown below.
                    </p>
                  </div>
                )}

                {canceled.length > 0 && (
                  <div className="mt-8">
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink-secondary">
                      Canceled
                    </h2>
                    <div className="space-y-3 opacity-60">
                      {canceled.map(renderPlanCard)}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Confirmation modal */}
      {confirmPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6" onClick={() => !canceling && setConfirmId(null)}>
          <div
            className="w-full max-w-sm rounded-card border border-gold/20 bg-[#0d0d0d] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Cancel this event?</h2>
              <button
                onClick={() => setConfirmId(null)}
                disabled={canceling}
                aria-label="Close"
                className="text-ink-secondary transition-colors hover:text-white disabled:opacity-50"
              >
                <X size={20} />
              </button>
            </div>
            <p className="mb-6 text-sm text-ink-secondary">
              "{confirmPlan.title}" will be marked as canceled. Attendees with the share link will see a cancellation notice, but the itinerary stays visible.
            </p>
            <div className="listing-grid">
              <button
                onClick={handleCancel}
                disabled={canceling}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-card bg-danger px-4 py-3 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50"
              >
                {canceling ? 'Canceling...' : 'Yes, Cancel'}
              </button>
              <button
                onClick={() => setConfirmId(null)}
                disabled={canceling}
                className="flex min-h-[44px] w-full items-center justify-center rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-sm font-medium text-ink-secondary transition-all active:scale-[0.98] disabled:opacity-50"
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
