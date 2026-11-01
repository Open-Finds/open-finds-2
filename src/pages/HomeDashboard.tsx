import { BrandLogo } from '../components/BrandLogo';
import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, Check, Shuffle, Sparkles, Star, Settings, Plus } from 'lucide-react';
import { fetchSavedVenues, fetchAllPlans, fetchInvitedPlanIds, fetchPlansByIds, type SavedVenue, type Plan } from '../lib/supabase';
import { localDate, savedCandidate, type PlannerMode } from '../lib/planner';
import { useAuth } from '../context/AuthContext';
import { DiscoveryCard } from '../components/DiscoveryCard';
import { LoadError } from '../components/LoadError';
import { parseLocalDate } from '../lib/time';
import { VenueDetails } from '../components/VenueDetails';
import { SavedVenueCard } from '../components/SavedVenueCard';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';

export function HomeDashboard({ onPlan, onVenues, onEvent, onSettings, onSave }: {
  onPlan: (mode?: PlannerMode, seed?: SavedVenue) => void; onVenues: () => void;
  onEvent: (id: string) => void; onSettings: () => void; onSave: () => void;
}) {
  const { displayName, session } = useAuth();
  const [detail, setDetail] = useState<SavedVenue | null>(null);
  const [editing, setEditing] = useState<SavedVenue | null>(null);
  const [venues, setVenues] = useState<SavedVenue[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([fetchSavedVenues(), fetchAllPlans(), fetchInvitedPlanIds().then(fetchPlansByIds)]).then(([v, own, invited]) => {
      if (!live) return;
      setVenues(v); setPlans([...new Map([...own, ...invited].map((p) => [p.id, p])).values()]
        .filter((p) => !p.canceled && p.date >= localDate()).sort((a, b) => a.date.localeCompare(b.date)));
      setState('ready');
    }, () => { if (live) setState('error'); });
    return () => { live = false; };
  }, [retry]);
  const visited = venues.filter((v) => v.visited).length;
  const percentage = venues.length ? Math.round(visited / venues.length * 100) : 0;
  const next = plans[0];
  return <main className="ux-page">
    {detail && <VenueDetails venue={detail} owned={detail.user_id === session?.user.id} onClose={() => setDetail(null)} onPlan={() => { onPlan('saved', detail); setDetail(null); }} onEdit={() => { setEditing(detail); setDetail(null); }} onSaved={(updated) => { setDetail(updated); setVenues((prev) => prev.map((v) => v.id === updated.id ? updated : v)); }} />}
    <Sheet open={!!editing} onOpenChange={(open) => !open && setEditing(null)}><SheetContent side="bottom" className="lg:mx-auto lg:max-w-2xl"><SheetHeader><SheetTitle>Edit saved venue</SheetTitle><SheetDescription>Changes update your saved library.</SheetDescription></SheetHeader>{editing && <SavedVenueCard venue={editing} isEditing onEditStart={() => {}} onEditEnd={() => setEditing(null)} onSaved={(updated) => setVenues((prev) => prev.map((v) => v.id === updated.id ? updated : v))} />}</SheetContent></Sheet>
    <header className="mb-7 flex items-center justify-between pr-14">
      <BrandLogo size={30} />
      <button data-tour="tab-settings" onClick={onSettings} className="ux-icon" aria-label="Settings"><Settings size={21} /></button>
    </header>
    <div className="mb-6 flex items-center justify-between"><div><p className="text-caption text-primary-text">A little less someday.</p>
      <h1 className="mt-1 text-title">Hi, {displayName?.split(' ')[0] || 'there'}<span className="text-primary-text">.</span></h1>
      <p className="mt-1 text-small text-muted-foreground">{new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
      <div className="flex size-12 items-center justify-center rounded-full bg-primary-soft text-heading text-primary-text" aria-hidden="true">{displayName?.slice(0, 1).toUpperCase() || 'U'}</div>
    </div>
    <section className="adventure-intro mb-5" aria-labelledby="adventure-title"><p className="adventure-kicker">Out of the group chat. Into the city.</p><h2 id="adventure-title" className="adventure-display mt-3 text-foreground">Good plans.<br />Great stories.</h2><p className="mt-3 max-w-md text-small text-muted-foreground">That place you saved? Make it your next adventure.</p><div className="mt-5 grid max-w-sm grid-cols-2 gap-2"><button className="btn-primary px-3 text-small" onClick={() => onPlan()}>Make a plan</button><button className="btn-ghost px-2 text-small text-info" onClick={onSave}>Save a place<ArrowRight size={15} /></button></div></section>
    {state === 'loading' ? <p role="status" className="py-6 text-muted-foreground">Getting your next good plan ready…</p>
      : state === 'error' ? <LoadError onRetry={() => setRetry((n) => n + 1)} /> : <>
        {next ? <button className="ux-next w-full text-left" onClick={() => onEvent(next.id)}>
          <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-text"><CalendarDays size={25} /></div>
          <div className="min-w-0"><p className="text-caption text-muted-foreground">Next up · {parseLocalDate(next.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</p>
            <h2 className="mt-1 truncate text-subheading">{next.title}</h2><p className="mt-1 text-small text-muted-foreground">{next.location || 'Meet-up details inside'}</p></div><ArrowRight size={18} className="ml-auto shrink-0" />
        </button> : <section className="ux-next"><CalendarDays className="shrink-0 text-primary-text" size={32} /><div><h2 className="text-subheading">Your next good story starts here.</h2><p className="mt-1 text-small text-muted-foreground">No upcoming events yet.</p></div></section>}
        <section className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="text-heading">Ready when you are</h2><button onClick={onVenues} className="text-small font-semibold text-primary-text">All venues <ArrowRight size={13} className="inline" /></button></div>
          {venues.length ? <div className="home-venue-preview grid grid-cols-2 gap-3 lg:grid-cols-3">{venues.slice(0, 3).map((v) => <DiscoveryCard key={v.id} venue={savedCandidate(v)} onOpen={() => setDetail(v)} actionLabel="Plan it" onSelect={() => onPlan('saved', v)} />)}</div>
            : <div className="rounded-lg border border-dashed border-border p-6"><p className="text-small text-muted-foreground">Good plans start with a place worth saving.</p><button data-tour="save-venue" onClick={onSave} className="btn-outline mt-3"><Plus size={16} />Save Venues</button></div>}
        </section>
        <div className="my-3 grid grid-cols-2 gap-3">
          <button onClick={onVenues} className="ux-stat text-left"><strong className="text-title tabular-nums">{venues.length}</strong><span className="text-caption text-muted-foreground">Saved venues</span></button>
          <div className="ux-stat"><strong className="text-title tabular-nums">{plans.length}</strong><span className="text-caption text-muted-foreground">Upcoming events</span></div>
        </div>
        <section className="rounded-lg border border-border bg-card p-4"><div className="flex items-center justify-between"><div><strong className="text-heading tabular-nums">{visited}/{venues.length}</strong><p className="text-caption text-muted-foreground">Turned real</p></div><p className="text-small text-muted-foreground">{percentage}% visited <Check size={14} className="inline text-primary-text" /></p></div>
          <progress aria-label="Saved venues visited" value={visited} max={venues.length || 1} className="ux-progress mt-3 w-full" /></section>
      </>}
    <section className="mt-8"><h2 className="mb-4 text-heading">Where will you end up?</h2><div className="grid gap-3 md:grid-cols-3">{[
      { mode: 'random' as const, label: 'Random Night', hint: 'A new mix of your saved spots', Icon: Shuffle },
      { mode: 'picks' as const, label: 'Our Picks', hint: 'Places we have onboarded', Icon: Star },
      { mode: 'ai' as const, label: 'AI Finds', hint: 'Your mood. Your next discovery.', Icon: Sparkles },
    ].map(({ mode, label, hint, Icon }) => <button key={mode} onClick={() => onPlan(mode)} className="ux-next text-left"><Icon size={23} className="shrink-0 text-primary-text" /><div><h3 className="text-label">{label}</h3><p className="mt-1 text-small text-muted-foreground">{hint}</p></div><ArrowRight className="ml-auto shrink-0" size={17} /></button>)}</div></section>
  </main>;
}
