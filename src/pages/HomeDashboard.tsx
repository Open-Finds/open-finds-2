import { useEffect, useState } from 'react';
import { ArrowRight, Bell, Bookmark, CalendarDays, ChevronRight, Heart, Plus, Utensils } from 'lucide-react';
import {
  fetchSavedVenues, fetchAllPlans, fetchInvitedPlanIds, fetchPlansByIds, fetchStops, fetchRsvps,
  sortStops, updateSavedVenue, type SavedVenue, type Plan, type Rsvp,
} from '../lib/supabase';
import { localDate, type PlannerMode } from '../lib/planner';
import { useAuth } from '../context/AuthContext';
import { LoadError } from '../components/LoadError';
import { formatTime, parseLocalDate } from '../lib/time';
import { VenueDetails } from '../components/VenueDetails';
import { SavedVenueCard } from '../components/SavedVenueCard';
import { VenueThumb } from '../components/VenueThumb';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { CATEGORY_SHORT, categoryOf } from '../lib/taxonomy';

const favouriteTag = 'Favourite';
const isFavourite = (tag: string) => tag.trim().toLowerCase() === favouriteTag.toLowerCase();

export function HomeDashboard({
  onPlan, onVenues, onEvent, onEvents, onSettings, onSave, onNotifications, unreadCount,
}: {
  onPlan: (mode?: PlannerMode, seed?: SavedVenue) => void;
  onVenues: () => void;
  onEvent: (id: string) => void;
  onEvents: () => void;
  onSettings: () => void;
  onSave: () => void;
  onNotifications: () => void;
  unreadCount: number;
}) {
  const { displayName, session } = useAuth();
  const [detail, setDetail] = useState<SavedVenue | null>(null);
  const [editing, setEditing] = useState<SavedVenue | null>(null);
  const [venues, setVenues] = useState<SavedVenue[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [nextTime, setNextTime] = useState('');
  const [going, setGoing] = useState<Rsvp[] | null>(null);
  const [savingFavourite, setSavingFavourite] = useState<string | null>(null);
  const [favouriteError, setFavouriteError] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([fetchSavedVenues(), fetchAllPlans(), fetchInvitedPlanIds().then(fetchPlansByIds)]).then(([saved, own, invited]) => {
      if (!live) return;
      setVenues(saved);
      setPlans([...new Map([...own, ...invited].map(plan => [plan.id, plan])).values()]
        .filter(plan => !plan.canceled && plan.date >= localDate()).sort((a, b) => a.date.localeCompare(b.date)));
      setState('ready');
    }, () => { if (live) setState('error'); });
    return () => { live = false; };
  }, [retry]);

  const next = plans[0];
  const nextId = next?.id;
  useEffect(() => {
    if (!nextId) return;
    let live = true;
    void fetchStops(nextId).then(stops => {
      const first = sortStops(stops)[0];
      if (live && first?.time) setNextTime(formatTime(first.time));
    }).catch(() => {});
    void fetchRsvps(nextId).then(rsvps => {
      if (live) setGoing(rsvps.filter(rsvp => rsvp.status === 'in'));
    }).catch(() => {});
    return () => { live = false; };
  }, [nextId]);

  const updateVenue = (updated: SavedVenue) => setVenues(current => current.map(venue => venue.id === updated.id ? updated : venue));
  const toggleFavourite = async (venue: SavedVenue) => {
    const tags = venue.tags ?? [];
    setSavingFavourite(venue.id);
    setFavouriteError(false);
    try {
      updateVenue(await updateSavedVenue(venue.id, {
        tags: tags.some(isFavourite) ? tags.filter(tag => !isFavourite(tag)) : [...tags, favouriteTag],
      }));
    } catch {
      setFavouriteError(true);
    } finally {
      setSavingFavourite(null);
    }
  };

  const visited = venues.filter(venue => venue.visited).length;
  const percentage = venues.length ? Math.round(visited / venues.length * 100) : 0;
  const firstName = displayName?.trim().split(/\s+/)[0] || 'there';
  const avatar = session?.user.user_metadata?.avatar_url ?? session?.user.user_metadata?.picture;

  return (
    <main className="ux-page reference-home">
      {detail && <VenueDetails venue={detail} owned={detail.user_id === session?.user.id}
        onClose={() => setDetail(null)} onPlan={() => { onPlan('saved', detail); setDetail(null); }}
        onEdit={() => { setEditing(detail); setDetail(null); }}
        onSaved={updated => { setDetail(updated); updateVenue(updated); }} />}
      <Sheet open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}>
        <SheetContent side="bottom" className="lg:mx-auto lg:max-w-2xl">
          <SheetHeader><SheetTitle>Edit saved venue</SheetTitle><SheetDescription>Changes update your saved library.</SheetDescription></SheetHeader>
          {editing && <SavedVenueCard venue={editing} isEditing onEditStart={() => {}} onEditEnd={() => setEditing(null)} onSaved={updateVenue} />}
        </SheetContent>
      </Sheet>

      <header className="reference-header">
        <img className="reference-wordmark" src="/brand/home-wordmark.webp" alt="The Unsaved" width="560" height="376" />
        <button type="button" onClick={onNotifications} className="reference-bell"
          aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
          <Bell size={23} />
          {unreadCount > 0 && <span className="reference-unread">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
      </header>

      <div className="reference-greeting">
        <div className="min-w-0">
          <h1>Hi, <span className="reference-stroke">{firstName}</span></h1>
          <p>{new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button type="button" data-tour="tab-settings" className="reference-avatar" onClick={onSettings} aria-label="Profile and settings">
          <span aria-hidden>{firstName.slice(0, 1).toUpperCase()}</span>
          {typeof avatar === 'string' && /^https:\/\//i.test(avatar) && <img src={avatar} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}
        </button>
      </div>

      {state === 'loading' ? <p role="status" className="py-6 text-muted-foreground">Getting your next good plan ready…</p>
        : state === 'error' ? <LoadError onRetry={() => { setState('loading'); setRetry(count => count + 1); }} /> : <>
          {next ? (
            <button type="button" className="reference-panel reference-next" onClick={() => onEvent(next.id)}>
              <span className="reference-event-icon"><Utensils size={28} /></span>
              <span className="min-w-0">
                <span className="reference-badge">Next up · {parseLocalDate(next.date).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                <span className="reference-event-title">{next.title}</span>
                <span className="reference-event-meta">{[nextTime, next.location].filter(Boolean).join(' · ') || 'Meet-up details inside'}</span>
                {going && going.length > 0 && <span className="reference-going">
                  {going.slice(0, 3).map(person => <span aria-hidden key={person.id}>{person.name.trim().charAt(0).toUpperCase()}</span>)}
                  <strong>{going.length} going</strong>
                </span>}
              </span>
              <ChevronRight size={22} aria-hidden />
            </button>
          ) : (
            <button type="button" className="reference-panel reference-next" onClick={() => onPlan()}>
              <span className="reference-event-icon"><CalendarDays size={27} /></span>
              <span><span className="reference-event-title">Make a plan</span><span className="reference-event-meta">No upcoming events yet.</span></span>
              <ChevronRight size={22} aria-hidden />
            </button>
          )}

          <div className="reference-stats">
            <button type="button" className="reference-panel reference-stat" onClick={onVenues}>
              <strong className="reference-stroke">{venues.length}</strong><Bookmark aria-hidden /><span>Saved venues</span>
            </button>
            <button type="button" className="reference-panel reference-stat" onClick={onEvents}>
              <strong>{plans.length}</strong><CalendarDays aria-hidden /><span>Upcoming events</span>
            </button>
          </div>

          <section className="reference-panel reference-progress" aria-labelledby="turned-real">
            <div><strong>{visited}/{venues.length}</strong><h2 id="turned-real">Turned real</h2></div>
            <p>{percentage}% of saved venues visited</p>
            <progress aria-label="Saved venues visited" value={visited} max={venues.length || 1} />
          </section>

          <section className="reference-recommendations" aria-labelledby="ready-title">
            <div className="reference-section-heading">
              <h2 id="ready-title" className="reference-stroke">Ready when you are</h2>
              <button type="button" onClick={onVenues}>All venues ({venues.length}) <ChevronRight size={15} aria-hidden /></button>
            </div>
            {favouriteError && <p role="alert" className="mb-2 text-small text-destructive-text">Could not update the favourite. Try again.</p>}
            {venues.length ? (
              <div className="reference-venues">
                {venues.slice(0, 2).map(venue => {
                  const favourite = venue.tags?.some(isFavourite) ?? false;
                  return <article key={venue.id} className="reference-panel reference-venue">
                    <div className="reference-venue-cover">
                      <Utensils size={26} aria-hidden className="reference-photo-placeholder" />
                      <VenueThumb venueId={venue.id} type={venue.type} photoUrl={venue.photo_url} checked={!!venue.photo_checked_at}
                        canFetch={venue.user_id === session?.user.id} className="reference-photo" />
                      <span className="reference-badge">{CATEGORY_SHORT[categoryOf(venue)]}</span>
                      <button type="button" className="reference-heart" aria-label={`Favourite ${venue.name}`} aria-pressed={favourite}
                        disabled={savingFavourite !== null} onClick={() => void toggleFavourite(venue)}>
                        <Heart size={19} fill={favourite ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                    <div className="reference-venue-body">
                      <button type="button" className="reference-venue-name" onClick={() => setDetail(venue)}>{venue.name}</button>
                      <p>{venue.address}</p>
                      <button type="button" className="reference-plan" aria-label={`Plan it at ${venue.name}`} onClick={() => onPlan('saved', venue)}>
                        Plan It <ArrowRight size={16} aria-hidden />
                      </button>
                    </div>
                  </article>;
                })}
              </div>
            ) : (
              <div className="reference-panel p-4">
                <p className="text-small text-muted-foreground">Save a place to see it here.</p>
                <button type="button" data-tour="save-venue" onClick={onSave} className="btn-primary mt-2"><Plus size={17} />Save Venues</button>
              </div>
            )}
          </section>
        </>}
    </main>
  );
}
