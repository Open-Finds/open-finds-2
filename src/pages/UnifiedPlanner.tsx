import { PlannerDisclosure } from '../components/PlannerDisclosure';
import { lazy, Suspense, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { X, Plus, RotateCw, Shuffle, LocateFixed, Sparkles, Search, Check } from 'lucide-react';
import { fetchSavedVenues, fetchCollections, fetchCollectionVenueIds, fetchSponsoredVenues, fetchPlan, fetchStops, sortStops,
  insertSavedVenue, fetchPlannerSixStopSupport, fetchPlannerTimingSupport, hasPremium, recordSponsoredEvents, type SponsoredVenue, type Collection } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { CATEGORIES, CATEGORY_LABELS, MODES, emptyDraft, plannerReducer, savedCandidate, partnerCandidate,
  readPlannerDraft, persistPlannerDraft, randomSaved, venueKey, draftFromStops, distanceKm, type PlannerMode, type PlannerVenue } from '../lib/planner';
import { confirmPlannerEvent, savePlannerEdits, validateEventDraft } from '../lib/plannerApi';
import { rankExistingVenues } from '../lib/openai';
import { discoverVenues } from '../lib/discovery';
import { Reorder } from 'framer-motion';
import { ItineraryItem } from '../components/ItineraryItem';
import { useDiscoveryTravel, useItineraryTravel, useTravelModes } from '../lib/useTravel';
import { TRAVEL_MINUTES, MODE_LABELS, journeyLabel, validCoordinate } from '../lib/travel';
import { geocodeAddress } from '../lib/apiKeys';
import { CategoryCounters } from '../components/CategoryCounters';
import { WorkflowNavigator } from '../components/WorkflowNavigator';
import { scrollToSection } from '../lib/flow';
import { matchesTaxonomy, categoriesOf, categoryStorage, VIBES, VIBE_GROUPS } from '../lib/taxonomy';
import { nextDate, isDate } from '../lib/eventTiming';
import { DiscoveryCard } from '../components/DiscoveryCard';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../components/ui/dialog';

const VenueReviewsDialog = lazy(() => import('../components/SponsoredVenues').then(m => ({ default: m.VenueReviewsDialog })));

export function UnifiedPlanner({ mode, seed = [], collectionId = '', editPlanId, onDone, onCancel, onDirty }: {
  mode?: PlannerMode; seed?: PlannerVenue[]; collectionId?: string; editPlanId?: string;
  onDone: (id: string) => void; onCancel: () => void; onDirty: (dirty: boolean) => void;
}) {
  const { session, displayName, subscriptionTier, premiumUnlocked, dietaryPreferences } = useAuth();
  const owner = session?.user.id ?? 'anonymous';
  const [draft, dispatch] = useReducer(plannerReducer, undefined, () => {
    let d = editPlanId ? { ...emptyDraft(), editPlanId } : readPlannerDraft(owner);
    if (mode) d = { ...d, mode };
    if (collectionId) d = { ...d, collectionId, mode: 'saved' };
    for (const venue of seed) d = plannerReducer(d, { type: 'add', venue });
    return d;
  });
  const [unplacedSeed, setUnplacedSeed] = useState(() =>
    seed.find(venue => !draft.stops.some(stop => venueKey(stop) === venueKey(venue)))
  );
  const [saved, setSaved] = useState<PlannerVenue[]>([]);
  const [partnerRecords, setPartnerRecords] = useState<SponsoredVenue[]>([]);
  const partners = useMemo(() => partnerRecords.map(partnerCandidate), [partnerRecords]);
  const [reviewing, setReviewing] = useState<SponsoredVenue | null>(null);
  const impressions = useRef(new Set<string>());
  const attributedSaves = useRef(new Set<string>());
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [usedFilters, setUsedFilters] = useState<PlannerMode[]>([]);
  const hasLocation = !!draft.location.trim() || validCoordinate(draft.origin);
  const activateFilters = () => setUsedFilters(modes => modes.includes(draft.mode) ? modes : [...modes, draft.mode]);
  const [category, setCategory] = useState('all');
  const filtersActive = usedFilters.includes(draft.mode) || !!search.trim() || category !== 'all' || !!draft.collectionId;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picksError, setPicksError] = useState(false);
  const aiContext = JSON.stringify([owner, draft.location, draft.origin]);
  const aiContextRef = useRef(aiContext);
  aiContextRef.current = aiContext;
  const aiRequest = useRef(0);
  const [aiResult, setAiResult] = useState<{ context: string; venues: PlannerVenue[] }>({ context: '', venues: [] });
  const aiVenues = useMemo(() => aiResult.context === aiContext ? aiResult.venues : [], [aiResult, aiContext]);
  useEffect(() => () => { aiRequest.current++; }, []);
  const [proposal, setProposal] = useState<PlannerVenue[] | null>(null);
  const [fallback, setFallback] = useState(false);
  const [fallbackKm, setFallbackKm] = useState(10);
  const [locationBusy, setLocationBusy] = useState(false);
  const [savingVenue, setSavingVenue] = useState<string | null>(null);
  const locationRevision = useRef(0);
  const [randomIds, setRandomIds] = useState<string[]>([]);
  const [chat, setChat] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const savedSuccessfully = useRef(false);
  const saving = useRef(false);
  const discoveryRef = useRef<HTMLElement>(null);
  const itineraryRef = useRef<HTMLElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const createRef = useRef<HTMLElement>(null);
  const workflowSections = useMemo(() => [{ label: 'Discover', target: discoveryRef }, { label: 'Itinerary', target: itineraryRef }, { label: 'Details', target: detailsRef }, { label: 'Review', target: createRef }], []);
  const [ideaGroup, setIdeaGroup] = useState(0);
  const selectedVibes = VIBES.filter((v) => draft.vibes.includes(v.id));
  const suggestedName = selectedVibes[0]?.label || (draft.stops[0] ? 'Out with ' + draft.stops[0].name : 'A little adventure');
  const dirty = !!(draft.name || draft.stops.length || draft.location || editPlanId);
  const patch = (value: Parameters<typeof dispatch>[0] & { type: 'patch' }) => dispatch(value);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { if (!editPlanId && !savedSuccessfully.current) persistPlannerDraft(owner, draft); }, [draft, owner, editPlanId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty && !savedSuccessfully.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    let live = true;
    const savedRequest = fetchSavedVenues();
    Promise.all([savedRequest, fetchCollections()]).then(([v, c]) => { if (live) { setSaved(v.map(savedCandidate)); setCollections(c); } },
      () => { if (live) setError('Your saved venues could not be loaded. Close and reopen the planner to retry.'); }).finally(() => { if (live) setLoading(false); });
    fetchSponsoredVenues().then((v) => { if (live) setPartnerRecords(v); }, () => { if (live) setPicksError(true); });
    if (editPlanId) Promise.all([fetchPlan(editPlanId), fetchStops(editPlanId), savedRequest]).then(([p, stops, venues]) => {
      if (!live) return;
      if (!p || p.owner_id !== owner) { setError('Only the event host may edit this event.'); return; }
      dispatch({ type: 'reset', draft: draftFromStops({ ...emptyDraft(), name: p.title, date: p.date,
        startTime: sortStops(stops)[0]?.time.slice(0, 5) ?? '19:00', endTime: p.end_time?.slice(0, 5) ?? '', endNextDay: !!p.end_date && p.end_date > p.date, location: p.location ?? '', editPlanId, originalType: p.type }, sortStops(stops), venues.map(savedCandidate)) });
    }, () => { if (live) setError('This event could not be loaded.'); });
    return () => { live = false; };
  }, [editPlanId, owner]);
  useEffect(() => {
    let live = true;
    setCollectionIds([]);
    if (draft.collectionId) fetchCollectionVenueIds(draft.collectionId).then((ids) => { if (live) setCollectionIds(ids); }, () => { if (live) setError('Could not load this collection.'); });
    return () => { live = false; };
  }, [draft.collectionId]);
  const supportedModes = useTravelModes();
  const travelMode = draft.travelMode;
  const routePool = useMemo(() => {
    const base = draft.mode === 'ai' ? aiVenues : draft.mode === 'picks' ? partners : saved;
    // Refine before the bounded routing batch so large libraries remain searchable.
    return base.filter((v) => category === 'all' || categoriesOf({ type: v.category, tags: v.tags }).includes(category as typeof v.category))
      .filter((v) => matchesTaxonomy(v, search))
      .filter((v) => draft.mode !== 'saved' || !draft.collectionId || collectionIds.includes(v.id))
      .sort((a, b) => venueKey(a).localeCompare(venueKey(b)));
  }, [draft.mode, aiVenues, partners, saved, category, search, draft.collectionId, collectionIds]);
  const travel = useDiscoveryTravel(owner, draft.origin, routePool, supportedModes.includes(travelMode) ? travelMode : null);
  const stopsWithCoordinates = useMemo(() => draft.stops.map((v) => ({ ...v, ...(travel.coords[venueKey(v)] ?? {}) })), [draft.stops, travel.coords]);
  const itineraryTravel = useItineraryTravel(owner, stopsWithCoordinates, supportedModes.includes(travelMode) ? travelMode : null);
  useEffect(() => { setFallback(false); }, [draft.origin?.lat, draft.origin?.lon, travelMode]);
  const eligible = (v: PlannerVenue) => {
    if (!validCoordinate(draft.origin)) return false;
    if (fallback) {
      const point = travel.coords[venueKey(v)] ?? (v.lat != null && v.lon != null ? { lat: v.lat, lon: v.lon } : null);
      return validCoordinate(point) && distanceKm(draft.origin, point) <= fallbackKm;
    }
    if (travel.busy || !supportedModes.includes(travelMode)) return false;
    const seconds = travel.seconds[venueKey(v)];
    return Number.isFinite(seconds) && typeof seconds === 'number' && seconds >= 0 && seconds <= draft.maxTravelMinutes * 60;
  };
  const desired = Object.values(draft.counts).reduce((sum, n) => sum + n, 0);
  const filtered = (values: PlannerVenue[]) => values
    .filter(v => category === 'all' || categoriesOf({ type: v.category, tags: v.tags }).includes(category as typeof v.category))
    .filter(v => matchesTaxonomy(v, search))
    .filter(v => !desired || !['picks', 'ai'].includes(draft.mode) || categoriesOf({ type: v.category, tags: v.tags }).some(c => draft.counts[c] > 0))
    .filter(eligible);
  // Both discovery surfaces and the selection handler use this same current pool.
  const discoveryResults = filtered(routePool);
  const visiblePartnerIds = draft.mode === 'picks' && hasLocation && filtersActive && !loading && !chat && !leaving && !reviewing
    ? discoveryResults.flatMap(v => v.partnerId ? [v.partnerId] : []).sort().join(',') : '';
  useEffect(() => {
    const ids = visiblePartnerIds.split(',').filter(id => id && !impressions.current.has(owner + '|' + id));
    ids.forEach(id => impressions.current.add(owner + '|' + id));
    if (ids.length) void recordSponsoredEvents(ids, 'impression').catch(() => {});
  }, [owner, visiblePartnerIds]);
  const choose = (venue: PlannerVenue) => {
    const selected = draft.stops.some((v) => venueKey(v) === venueKey(venue));
    if (selected) dispatch({ type: 'remove', key: venueKey(venue) });
    else if (!discoveryResults.some(v => v.id === venue.id && venueKey(v) === venueKey(venue))) setNotice('This place no longer matches your discovery filters. Refresh the results.');
    else if (draft.stops.length < 6) dispatch({ type: 'add', venue: { ...venue, ...(travel.coords[venueKey(venue)] ?? {}) } });
    else setNotice('Your itinerary has six stops. Remove one before adding another.');
  };
  const locate = () => {
    if (!navigator.geolocation) { setError('Current location is unavailable. Enter a postcode instead.'); return; }
    const revision = ++locationRevision.current;
    navigator.geolocation.getCurrentPosition((p) => { if (revision !== locationRevision.current) return; patch({ type: 'patch', patch: { origin: { lat: p.coords.latitude, lon: p.coords.longitude },
      location: 'Current location' } }); }, () => setError('Location was not shared. You can enter a postcode instead.'), { timeout: 10000 });
  };
  const resolveOrigin = async () => {
    if (validCoordinate(draft.origin)) return draft.origin;
    if (!draft.location.trim()) throw new Error('Choose a starting location in discovery first.');
    const revision = locationRevision.current;
    const origin = await geocodeAddress(draft.location.trim());
    if (!validCoordinate(origin)) throw new Error('Could not verify that starting location. Try a full address or use current location.');
    if (revision !== locationRevision.current) throw new Error('Location changed. Apply the new starting location.');
    aiContextRef.current = JSON.stringify([owner, draft.location, origin]);
    dispatch({ type: 'patch', patch: { origin } }); return origin;
  };
  const shuffle = () => {
    setError(''); setNotice('');
    if (!draft.origin) { setError('Choose and apply a starting location first.'); return; }
    if (travel.busy) { setNotice('Journey estimates are still loading. Please try again shortly.'); return; }
    const selected = randomSaved({ ...draft, stops: [] }, filtered(saved));
    setRandomIds(selected.map((v) => v.id)); setProposal(selected);
    const expected = desired || 3;
    setNotice(selected.length < expected ? `Found ${selected.length} of ${expected} requested saved places. Adjust the category mix or travel limit to find more.` : 'Preview your random plan below. Choose Merge or Replace to apply it.');
  };
  const findAI = async () => {
    activateFilters();
    const request = ++aiRequest.current, revision = locationRevision.current;
    let context: string | undefined;
    const current = () => request === aiRequest.current && revision === locationRevision.current && (!context || aiContextRef.current === context);
    setBusy(true); setError(''); setNotice(''); setAiResult({ context: '', venues: [] });
    try {
      const origin = await resolveOrigin();
      if (!origin) throw new Error('Choose a starting location first.');
      context = JSON.stringify([owner, draft.location, origin]);
      const query = [desired ? CATEGORIES.filter((c) => draft.counts[c] > 0).map((c) => CATEGORY_LABELS[c]).join(', ') : 'restaurants, bars and experiences', selectedVibes.map((v) => v.label).join(', '), draft.mood, (dietaryPreferences ?? []).join(', ')].filter(Boolean).join('. ');
      const candidates = await discoverVenues(query, origin, saved);
      if (!current()) return;
      if (!candidates.length) { setNotice('No new verified places were found. Try a different mood or location.'); return; }
      let ordered = candidates;
      try { const ids = await rankExistingVenues(candidates, query); if (ids.length) ordered = [...candidates].sort((a, b) => (ids.includes(a.id) ? ids.indexOf(a.id) : 99) - (ids.includes(b.id) ? ids.indexOf(b.id) : 99)); }
      catch { if (current()) setNotice('AI ranking is unavailable. Showing verified Places results, filtered by journey time.'); }
      if (current()) setAiResult({ context, venues: ordered });
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : 'AI Finds is unavailable. Your itinerary is safe.'); }
    finally { if (request === aiRequest.current) setBusy(false); }
  };
  const saveDiscovered = async (v: PlannerVenue) => {
    if (savingVenue || saved.some((s) => venueKey(s) === venueKey(v) || (v.providerId && s.tags.includes(`google-place:${v.providerId}`)))) return;
    setSavingVenue(v.id); setError('');
    try {
      const storage = categoryStorage(v.category, v.tags);
      const row = await insertSavedVenue({ name: v.name, address: v.address, type: storage.type, tags: v.tags, link: v.link, lat: v.lat, lon: v.lon, photo_url: null });
      setSaved((values) => [...values, savedCandidate(row)]); setNotice(`${v.name} saved to your library. Your itinerary is unchanged.`);
    } catch { setError('This venue could not be saved. Please try again.'); }
    finally { setSavingVenue(null); }
  };
  const finish = async () => {
    if (busy || savedSuccessfully.current || saving.current) return;
    saving.current = true;
    setBusy(true); setError('');
    try {
      validateEventDraft(draft);
      if (draft.endTime && !await fetchPlannerTimingSupport()) throw new Error('Optional end times are not enabled on this backend yet. Your draft is kept. Clear the end time to create the event without one.');
      const legacyLimit = hasPremium(subscriptionTier, premiumUnlocked) ? 5 : 2;
      if (draft.stops.length > legacyLimit && !await fetchPlannerSixStopSupport()) throw new Error(`Six-stop planning is ready in the app, but this backend still has its previous ${legacyLimit}-stop limit. Your draft is kept until the approved backend update is applied.`);
      const id = editPlanId ? await savePlannerEdits(draft, owner) : await confirmPlannerEvent(draft, displayName || 'You', (id) => {
        const pending = { ...draft, pendingPlanId: id }; dispatch({ type: 'patch', patch: { pendingPlanId: id } }); persistPlannerDraft(owner, pending);
      });
      const partnerIds = [...new Set(draft.stops.flatMap(v => v.partnerId ? [v.partnerId] : []))]
        .filter(partnerId => !attributedSaves.current.has(owner + '|' + id + '|' + partnerId));
      partnerIds.forEach(partnerId => attributedSaves.current.add(owner + '|' + id + '|' + partnerId));
      if (partnerIds.length) void recordSponsoredEvents(partnerIds, 'saved', id).catch(() => {});
      savedSuccessfully.current = true; persistPlannerDraft(owner, null); onDirty(false); onDone(id);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this event. Your draft is kept.'); }
    finally { saving.current = false; setBusy(false); }
  };
  const cards = (values: PlannerVenue[]) => <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{values.map((v) => <DiscoveryCard key={v.id} venue={v}
    reviewSummary={v.source === 'partner' ? (() => { const p = partnerRecords.find(p => p.id === v.partnerId); return p ? { average: p.average_rating, count: p.review_count } : undefined; })() : undefined}
    onReviews={v.source === 'partner' ? () => { const p = partnerRecords.find(p => p.id === v.partnerId); if (p) setReviewing(p); } : undefined}
    selected={draft.stops.some((s) => venueKey(s) === venueKey(v))} disabled={draft.stops.length >= 6} onSelect={() => choose(v)}
    travelLabel={fallback ? 'Straight-line fallback · journey time not applied' : typeof travel.seconds[venueKey(v)] === 'number' ? journeyLabel(travel.seconds[venueKey(v)], travelMode) : undefined}
    onSave={v.source === 'external' ? () => saveDiscovered(v) : undefined} saved={saved.some((s) => venueKey(s) === venueKey(v) || !!v.providerId && s.tags.includes(`google-place:${v.providerId}`))} saving={savingVenue === v.id} />)}</div>;
  return <main className="ux-page planner-page">
    <header className="mb-6 flex items-center justify-between pr-14"><div><p className="text-caption text-info">Find your vibe. Make it real.</p><h1 className="mt-1 text-title">{editPlanId ? 'Edit event' : 'Plan an adventure'}</h1></div><button className="ux-icon" onClick={() => setLeaving(true)} aria-label="Close planner"><X size={18} /></button></header>
    {error && !chat && <p role="alert" className="mb-4 rounded-md bg-destructive-soft p-3 text-small text-destructive-text">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg bg-info-soft p-4 text-small text-info">{notice}</p>}
    {unplacedSeed && <div className="mb-4 rounded-lg bg-info-soft p-4 text-small text-info">
      <p>{draft.stops.length >= 6 ? `Remove a stop to make room for ${unplacedSeed.name}.` : `Add ${unplacedSeed.name} to this itinerary.`}</p>
      <button className="btn-outline mt-2" disabled={draft.stops.length >= 6} onClick={() => {
        dispatch({ type: 'add', venue: unplacedSeed });
        setUnplacedSeed(undefined);
      }}>Add shared venue</button>
    </div>}
    <section ref={discoveryRef} tabIndex={-1} className="plan-section" aria-labelledby="discover-heading"><p className="text-caption text-info">01 — Discover</p><h2 id="discover-heading" className="mb-5 mt-1 text-title">Discover venues &amp; vibes</h2>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">{MODES.map((m) => <button key={m.id} onClick={() => { dispatch({ type: 'patch', patch: { mode: m.id } }); setNotice(''); setError(''); }} aria-pressed={draft.mode === m.id}
        className={`min-h-20 rounded-lg border px-3 py-4 text-label ${draft.mode === m.id ? 'border-primary bg-primary-soft text-primary-text' : 'border-border bg-card'}`}>{m.label}</button>)}</div>
      <h3 className="text-subheading">{MODES.find((m) => m.id === draft.mode)?.label}</h3><p className="mb-5 mt-1 text-small text-muted-foreground">{MODES.find((m) => m.id === draft.mode)?.description}</p>
      {draft.mode !== 'saved' && <CategoryCounters counts={draft.counts} onChange={(category, delta) => dispatch({ type: 'count', category, delta })} />}
      <div className="mb-6 rounded-lg border border-border bg-card p-4" aria-labelledby="travel-heading">
        <h3 id="travel-heading" className="text-heading">How far are you willing to go?</h3>
        <label className="mt-4 block text-label">Starting location<input className="ux-field mt-2 w-full" value={draft.location} placeholder="Suburb, city or address" onChange={(e) => { locationRevision.current++; patch({ type: 'patch', patch: { location: e.target.value, origin: null } }); }} /></label>
        <div className="my-3 flex flex-wrap gap-2"><button className="btn-outline" disabled={locationBusy} onClick={async () => { setLocationBusy(true); setError(''); try { await resolveOrigin(); } catch (e) { setError(e instanceof Error ? e.message : 'Location unavailable'); } finally { setLocationBusy(false); } }}>{locationBusy ? 'Finding location…' : 'Apply location'}</button><button className="btn-outline" onClick={locate}><LocateFixed size={17} />Use My Location</button></div>
        <fieldset><legend className="mb-2 text-label">Travel mode</legend><div className="flex flex-wrap gap-2">{(['driving', 'walking', 'transit'] as const).map((m) => <button key={m} disabled={!supportedModes.includes(m)} aria-describedby={!supportedModes.includes(m) ? 'mode-help' : undefined} className={travelMode === m ? 'btn-secondary' : 'btn-outline'} aria-pressed={travelMode === m} onClick={() => patch({ type: 'patch', patch: { travelMode: m } })}>{m === 'driving' ? 'Drive' : m === 'walking' ? 'Walk' : 'Public Transport'}</button>)}</div>{supportedModes.length < 3 && <p id="mode-help" className="mt-2 text-small text-muted-foreground">Disabled modes are unavailable from the current routing service.</p>}</fieldset>
        <label className="mt-5 block text-title travel-value">Within {draft.maxTravelMinutes} min {MODE_LABELS[travelMode]}<input aria-label="Maximum travel time" aria-valuetext={`${draft.maxTravelMinutes} minutes ${MODE_LABELS[travelMode]}`} type="range" min={1} max={60} step={1} value={draft.maxTravelMinutes} onChange={(e) => patch({ type: 'patch', patch: { maxTravelMinutes: Number(e.target.value) } })} className="mt-3 min-h-11 w-full accent-primary" /></label>
        <div className="travel-ticks text-caption text-muted-foreground" aria-hidden="true">{TRAVEL_MINUTES.map((n) => <span key={n} style={{ left: `${(n - 1) / 59 * 100}%` }}>{n}</span>)}</div>
        <details className="mt-3 text-small text-muted-foreground"><summary>About travel estimates</summary>Estimated journey from your origin to each place, not total itinerary travel. Google Maps estimates; live traffic and opening hours are not confirmed.</details>
        {!draft.origin ? <p role="status" className="mt-3 text-small text-info">Choose a starting location.</p> : travel.busy ? <p role="status" className="mt-3 text-small text-info">Checking journey estimates…</p> : routePool.slice(0, 50).some((v) => typeof travel.seconds[venueKey(v)] !== 'number') ? <p role="status" className="mt-3 text-small text-info">{routePool.slice(0, 50).filter((v) => typeof travel.seconds[venueKey(v)] !== 'number').length} places excluded: no route estimate.</p> : null}
        {!!draft.origin && !travel.busy && routePool.length > 0 && Object.keys(travel.seconds).length === 0 && <p className="mt-3 text-small text-info">Routes unavailable. Try another origin or choose the labelled distance fallback.</p>}
        {routePool.length > 50 && <p className="mt-3 text-small">Checking the first 50 matching places to limit provider costs. Refine the search, category or collection to check others.</p>}
        {!!draft.origin && !travel.busy && routePool.some((v) => typeof travel.seconds[venueKey(v)] !== 'number') && !fallback && <button className="btn-outline mt-3" onClick={() => setFallback(true)}>Use straight-line distance fallback (not journey time)</button>}
        {fallback && <div className="mt-3 rounded-md border border-border p-3"><p className="text-small">Distance fallback active by your choice. The travel-time limit is not applied. Only places with known coordinates are included.</p><label className="mt-2 block text-small">Straight-line distance<select aria-label="Fallback distance" className="ux-field ml-2" value={fallbackKm} onChange={(e) => setFallbackKm(Number(e.target.value))}>{[2, 5, 10, 20, 50].map((n) => <option key={n} value={n}>{n} km</option>)}</select></label><button className="btn-ghost" onClick={() => setFallback(false)}>Return to journey times</button></div>}
      </div>
      {draft.mode === 'random' ? <><div className="mb-4 rounded-lg border border-dashed border-border p-5"><Shuffle className="mb-3 text-info" /><p className="text-small text-muted-foreground">{saved.length} saved places · Preview a random plan</p><button onClick={shuffle} disabled={busy || loading || travel.busy} className="btn-primary mt-4"><Shuffle size={17} />Randomise My Plan</button></div>{proposal && <div className="mb-4 rounded-lg border border-border p-4"><h4 className="text-label">Proposed plan · {proposal.length} stops</h4><ol className="my-3 list-inside list-decimal">{proposal.map((v) => <li key={v.id}>{v.name}</li>)}</ol><div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={!proposal.length} onClick={() => { dispatch({ type: 'proposal', venues: proposal, replace: false }); setProposal(null); setNotice('Proposed places merged. Existing selections are kept; six stops maximum.'); }}>Merge into itinerary</button><button className="btn-outline" disabled={!proposal.length} onClick={() => { dispatch({ type: 'proposal', venues: proposal, replace: true }); setProposal(null); setNotice('Itinerary replaced with your chosen proposal.'); }}>Replace itinerary</button><button className="btn-ghost" onClick={() => setProposal(null)}>Keep current itinerary</button></div></div>}{cards(discoveryResults.filter(v => randomIds.includes(v.id)))}</> : <>
        {draft.mode === 'ai' && <div className="mb-5 rounded-lg border border-primary/30 bg-primary-soft p-4">
          <h3 className="text-heading">What are you in the mood for?</h3><p className="mt-1 text-small text-muted-foreground">Choose a vibe</p>
          <div className="mt-4 grid grid-cols-3 gap-2" aria-label="Vibe suggestions">{VIBE_GROUPS[ideaGroup].map((v) => <button key={v.id} type="button" aria-pressed={draft.vibes.includes(v.id)} className={"min-h-12 rounded-md border px-2 py-2 text-small " + (draft.vibes.includes(v.id) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")} onClick={() => patch({ type: 'patch', patch: { vibes: draft.vibes.includes(v.id) ? draft.vibes.filter((id) => id !== v.id) : [...draft.vibes, v.id] } })}>{v.label}</button>)}</div>
          <button type="button" className="btn-ghost mt-2 text-primary-text" onClick={() => setIdeaGroup((n) => (n + 1) % VIBE_GROUPS.length)}>More ideas <RotateCw size={14} /></button>
          {selectedVibes.length > 0 && <p className="my-2 text-small" role="status">Selected: {selectedVibes.map((v) => v.label).join(', ')} <button className="min-h-11 px-2 text-primary-text underline" onClick={() => patch({ type: 'patch', patch: { vibes: [] } })}>Clear vibes</button></p>}
          <label className="mt-3 block text-label">Your mood <span className="text-small font-normal">· optional</span><textarea className="ux-field mt-2 w-full" value={draft.mood} onChange={(e) => patch({ type: 'patch', patch: { mood: e.target.value } })} placeholder="Somewhere chill with good food and music..." /></label>
          <div className="mt-4 flex flex-wrap gap-2"><button className="btn-primary" onClick={findAI} disabled={busy}><Sparkles size={17} />{busy ? 'Finding…' : 'Find Places'}</button><button className="btn-outline" onClick={() => setChat(true)}>Expand discovery chat</button></div><p className="mt-3 text-small text-muted-foreground">Google Maps places · Check hours, prices and availability with the venue.</p>
        </div>}
        {draft.mode === 'picks' && <p className="mb-4 text-small text-muted-foreground">Onboarded partners · Paid placements are labelled.</p>}
        <PlannerDisclosure open={hasLocation}><div onFocusCapture={activateFilters}><h3 className="mb-3 text-subheading">Search and filters</h3>
        <label className="mb-3 flex items-center gap-2"><Search size={17} /><span className="sr-only">Search venues</span><input className="ux-field w-full" placeholder="Search name, suburb or tag" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="mb-4 flex flex-wrap gap-2"><select aria-label="Venue category" value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">All categories</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select>
          {draft.mode === 'saved' && <select aria-label="Collection" value={draft.collectionId} onChange={(e) => patch({ type: 'patch', patch: { collectionId: e.target.value } })}><option value="">All collections</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
</div>
        </div>
        {!validCoordinate(draft.origin) ? <p role="status" className="text-small text-muted-foreground">Apply your starting location to see venues.</p> : !filtersActive ? <button type="button" className="btn-outline" onClick={activateFilters}>Show venues</button> : loading ? <p role="status">Loading your venues…</p> : (() => {
          const values = discoveryResults;
          return values.length ? cards(values) : <div className="rounded-lg border border-dashed border-border p-6 text-small text-muted-foreground">{travel.busy ? 'Checking journey estimates…' : draft.mode === 'picks' && picksError ? 'Our Picks could not be loaded. Your other planning modes are still available.' : draft.mode === 'ai' ? 'Choose a mood to find places within your travel limit.' : 'No venues match yet. Try another search or collection.'}</div>;
        })()}
        </PlannerDisclosure>
      </>}

    </section>

    <section ref={itineraryRef} tabIndex={-1} className="plan-section" aria-labelledby="itinerary-heading"><p className="text-caption text-info">02 — Arrange</p><h2 id="itinerary-heading" className="mt-1 text-title">Your itinerary</h2><p className="my-3 text-small text-muted-foreground">{draft.stops.length}/6 stops</p>
      {!draft.stops.length && <p className="rounded-lg border border-dashed border-border p-5 text-small text-muted-foreground">Add your first stop</p>}
<div className="mt-5 space-y-3" aria-label="Selected itinerary"><PlannerDisclosure open={draft.stops.length > 0}>{draft.stops.length > 0 && <><p className="text-small text-muted-foreground">Drag to reorder<span className="sr-only">. Focus a handle and use arrow keys to reorder with a keyboard. Times stay in their slots. Stop times are planning estimates, not confirmed bookings. Journey estimates are separate from the discovery limit.</span></p>
      <Reorder.Group axis="y" values={draft.stops} onReorder={(stops) => dispatch({ type: 'reorder', keys: stops.map(venueKey) })} className="space-y-3">
        {draft.stops.map((stop, i) => <ItineraryItem key={venueKey(stop)} stop={stop} index={i} total={draft.stops.length}
          journey={itineraryTravel.busy ? 'Checking journey…' : typeof itineraryTravel.legs[i - 1] === 'number' ? journeyLabel(itineraryTravel.legs[i - 1]!, travelMode) : undefined}
          onMove={(delta) => dispatch({ type: 'move', index: i, delta })} onRemove={() => dispatch({ type: 'remove', key: venueKey(stop) })} onTime={(time) => dispatch({ type: 'time', key: venueKey(stop), time })} />)}
      </Reorder.Group><p className="sr-only" aria-live="polite">Stop order: {draft.stops.map((s) => s.name).join(', ')}</p></>}</PlannerDisclosure>
      <button className="btn-outline" onClick={() => scrollToSection(discoveryRef)}><Plus size={16} />Add stop</button></div>
    </section>

    <section ref={detailsRef} tabIndex={-1} className="plan-section" aria-labelledby="details-heading"><p className="text-caption text-info">03 — Details</p><h2 id="details-heading" className="mb-5 mt-1 text-title">Make it your event</h2>
<div className="max-w-xl space-y-5">
      <label className="block text-label">Event name<input className="ux-field mt-2 w-full" required value={draft.name} placeholder="Sunday brunch, birthday dinner…" onChange={(e) => patch({ type: 'patch', patch: { name: e.target.value } })} /></label>
      <div className="grid grid-cols-2 gap-3"><label className="text-label">Date<input type="date" required className="ux-field mt-2 w-full" value={draft.date} onChange={(e) => patch({ type: 'patch', patch: { date: e.target.value } })} /></label>
        <label className="text-label">Start time<input type="time" required className="ux-field mt-2 w-full" value={draft.startTime} onChange={(e) => patch({ type: 'patch', patch: { startTime: e.target.value } })} /></label></div>
      {!draft.name && <button type="button" className="btn-ghost text-primary-text" onClick={() => patch({ type: 'patch', patch: { name: suggestedName } })}>Use name: {suggestedName}</button>}
      <label className="block text-label">End time <span className="text-small font-normal text-muted-foreground">· optional</span><input type="time" className="ux-field mt-2 block w-full" value={draft.endTime} onChange={(e) => patch({ type: 'patch', patch: { endTime: e.target.value } })} /></label>
      {draft.endTime && <><label className="flex min-h-11 items-center gap-3 text-small"><input type="checkbox" checked={draft.endNextDay} onChange={(e) => patch({ type: 'patch', patch: { endNextDay: e.target.checked } })} />Ends the next day</label><p className="text-small text-muted-foreground">Ends {isDate(draft.date) ? (draft.endNextDay ? nextDate(draft.date) : draft.date) : 'choose a date'} at {draft.endTime}. We never estimate an end time from your stops.</p></>}

</div>

    </section>

    <section ref={createRef} tabIndex={-1} className="plan-section adventure-card rounded-lg border border-border bg-card p-5" aria-labelledby="create-heading"><p className="text-caption text-info">04 — Make it happen</p><h2 id="create-heading" className="mt-1 text-heading">{editPlanId ? 'Save your changes' : 'Ready for a good time?'}</h2><p className="my-3 text-small text-muted-foreground">{draft.stops.length} places · {draft.name || 'Name your event above'} · {draft.date} · {draft.startTime || 'Set a start time'}</p>
      <button className="btn-primary w-full" disabled={busy || !draft.stops.length} onClick={finish}><Check size={17} />{busy ? 'Saving…' : editPlanId ? 'Save event changes' : 'Create Event'}</button>
    </section>
    {reviewing && <Suspense fallback={<p role="status">Loading reviews…</p>}><VenueReviewsDialog venue={reviewing} onClose={() => setReviewing(null)} onChanged={() => {
      void fetchSponsoredVenues().then(records => { setPartnerRecords(records); setReviewing(current => records.find(p => p.id === current?.id) ?? current); }, () => setPicksError(true));
    }} /></Suspense>}
    <WorkflowNavigator sections={workflowSections} blocked={chat || leaving} />
    <Sheet open={chat} onOpenChange={setChat}><SheetContent side="bottom" className="h-[60dvh] lg:mx-auto lg:max-w-2xl"><SheetHeader><SheetTitle>Find your kind of night</SheetTitle><SheetDescription>Refine the mood, budget or occasion. Search real new places; unavailable providers are reported clearly.</SheetDescription></SheetHeader><label className="mt-5 block text-label">Your discovery preferences<textarea className="ux-field mt-2 w-full" value={draft.mood} onChange={(e) => patch({ type: 'patch', patch: { mood: e.target.value } })} placeholder="A casual Japanese date night under $50…" /></label><button onClick={findAI} disabled={busy} className="btn-primary my-4"><Sparkles size={16} />{busy ? 'Finding…' : 'Refine recommendations'}</button>{error && <p role="alert" className="mb-3 text-small text-destructive-text">{error}</p>}{discoveryResults.length ? cards(discoveryResults) : <p role="status" className="text-small text-muted-foreground">{travel.busy ? 'Checking journey estimates…' : 'No places match your current discovery filters.'}</p>}</SheetContent></Sheet>
    <Dialog open={leaving} onOpenChange={setLeaving}><DialogContent><DialogHeader><DialogTitle>Leave this plan for now?</DialogTitle><DialogDescription>{editPlanId ? 'Unsaved edits will be discarded. The saved event will stay as it is.' : 'Keep your draft to pick up later, or discard it. No confirmed event will be deleted.'}</DialogDescription></DialogHeader><button className="btn-primary" onClick={onCancel}>{editPlanId ? 'Leave without saving' : 'Keep draft and leave'}</button><button className="btn-outline" onClick={() => setLeaving(false)}>Keep planning</button>{!editPlanId && <button className="btn-ghost text-destructive-text" onClick={() => { persistPlannerDraft(owner, null); savedSuccessfully.current = true; onCancel(); }}>Discard draft</button>}</DialogContent></Dialog>
  </main>;
}
