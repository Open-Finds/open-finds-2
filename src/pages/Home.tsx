import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  ExternalLink,
  Check,
  X,
  Clock3,
  Send,
  Copy,
  LayoutDashboard,
  Sparkles,
  Clock,
  FolderOpen,
  Smartphone,
  Loader2,
  RefreshCw,
  Dice5,
  Building2,
  Wand2,
  LocateFixed,
  Plus,
  Tag,
  Link2,
  Compass,
} from 'lucide-react';
import { buildInviteMessage, shareOrCopy } from '../lib/invite';
import { navigate } from '../lib/router';
import { HelpTooltip } from '../components/HelpTooltip';
import {
  fetchRsvps,
  fetchPlan,
  fetchStops,
  createPlan,
  createStops,
  updateStop,
  insertRsvp,
  sendGuestRsvpPushNotification,
  fetchSavedVenues,
  fetchRecentPlanHistory,
  insertSavedVenue,
  updateSavedVenueCoords,
  sortStops,
  type SavedVenue,
  type VenueType,
  type Rsvp,
  type RsvpStatus,
  type Plan,
  type Stop,
} from '../lib/supabase';
import {
  discoverSmartVenueCandidates,
  extractVenuesFromLink,
  type VenueCandidate,
  type ExtractedVenueItem,
} from '../lib/openai';
import { fetchDistanceMatrix, geocodeAddress, type OriginInput } from '../lib/apiKeys';
import { loadPlanDraft, savePlanDraft, clearPlanDraft } from '../lib/draft';
import { findSimilarVenues } from '../lib/venueMatch';
import { DuplicateVenueDialog, type PendingDuplicate } from '../components/DuplicateVenueDialog';

type Page =
  | 'hero'
  | 'occasion'
  | 'planMyNight'
  | 'randomNight'
  | 'savedVenuesSelect'
  | 'sponsored'
  | 'somethingNew'
  | 'itinerary'
  | 'share';
type Vibe = VenueType;

const VIBE_LABELS: Record<Vibe, { icon: string; label: string }> = {
  food: { icon: '🍔', label: 'Food' },
  bar: { icon: '🍸', label: 'Bar' },
  activity: { icon: '🎯', label: 'Activity' },
  dessert: { icon: '🍰', label: 'Dessert' },
};

/**
 * Picks one venue at random per selected vibe, and reports which vibes had no
 * candidates at all.
 *
 * Previously an empty bucket was skipped in silence: ask for Food + Dessert,
 * get back only Food, and the night is simply one stop shorter with nothing
 * said. The caller uses `missing` to tell the user what could not be filled.
 */
function pickOnePerVibe<T extends { type: Vibe }>(
  candidates: T[],
  vibes: Vibe[]
): { picked: T[]; missing: Vibe[] } {
  const picked: T[] = [];
  const missing: Vibe[] = [];
  for (const vibe of vibes) {
    const options = candidates.filter((c) => c.type === vibe);
    if (options.length > 0) {
      picked.push(options[Math.floor(Math.random() * options.length)]);
    } else {
      missing.push(vibe);
    }
  }
  return { picked, missing };
}

/** "Dessert", or "Activity and Dessert" — for telling the user what is missing. */
function describeVibes(vibes: Vibe[]): string {
  const labels = vibes.map((v) => VIBE_LABELS[v].label);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

const VIBE_DEFAULT_TIMES: Record<Vibe, string> = {
  food: '18:30',
  bar: '21:00',
  activity: '20:30',
  dessert: '22:00',
};

const DIETARY_OPTIONS: { key: string; label: string }[] = [
  { key: 'vegetarian', label: 'Veggie' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten-free', label: 'GF' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'dairy-free', label: 'Dairy-Free' },
  { key: 'nut-allergy', label: 'Nut-Free' },
  { key: 'pescatarian', label: 'Pescatarian' },
];

/* oF monogram logo in gold */
function Logo({ size = 96 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-[0_0_20px_rgba(212,175,55,0.5)]"
      aria-label="Open Finds logo"
    >
      <path
        d="M30 62 C30 48, 40 40, 50 40 C60 40, 66 48, 66 58 C66 68, 60 74, 52 74 C46 74, 42 70, 42 64 C42 58, 48 54, 56 54 L84 54"
        stroke="#D4AF37"
        strokeWidth="7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M84 30 L84 92" stroke="#D4AF37" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M84 38 L100 38" stroke="#D4AF37" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M84 56 L98 56" stroke="#D4AF37" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path
        d="M104 22 C101 22, 99 24, 99 27 C99 30, 104 35, 104 35 C104 35, 109 30, 109 27 C109 24, 107 22, 104 22 Z"
        fill="#D4AF37"
      />
      <circle cx="104" cy="27" r="2" fill="#000000" />
    </svg>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Back"
      className="absolute left-5 top-5 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
    >
      <ChevronLeft size={28} strokeWidth={2.5} />
    </button>
  );
}

function NextButton({
  onClick,
  disabled,
  label = 'Next',
}: {
  onClick: () => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <div className="fixed bottom-24 left-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 justify-center px-6 lg:bottom-8 lg:left-auto lg:right-8 lg:translate-x-0">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card px-6 py-3.5 text-base font-bold shadow-gold-glow transition-all duration-200 active:scale-[0.98] ${
          disabled
            ? 'cursor-not-allowed bg-gray-800 text-gray-500 shadow-none'
            : 'bg-gold text-black'
        }`}
      >
        {label} {!disabled && <ChevronRight size={20} />}
      </button>
    </div>
  );
}

/* Travel time slider with tick marks */
function TravelSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const ticks = [0, 30, 60, 90, 120, 180, 240];
  return (
    <div className="mt-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gold">Travel time?</span>
        <span className="flex items-center gap-1 text-sm font-bold text-gold">
          <Clock size={14} /> {value >= 240 ? '240+ min' : `${value} min`}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={240}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider-gold w-full"
      />
      <div className="mt-2 flex justify-between px-0.5">
        {ticks.map((t) => (
          <span
            key={t}
            className={`text-[10px] ${value >= t ? 'text-gold' : 'text-ink-secondary/50'}`}
          >
            {t === 240 ? '240+' : t}
          </span>
        ))}
      </div>
      <p className="mt-1 text-xs text-ink-secondary">Max travel time between stops</p>
    </div>
  );
}

export function HomePage({
  onNavigateToDashboard,
  editPlanId,
  onCancelEdit,
}: {
  onNavigateToDashboard: (planId: string) => void;
  editPlanId?: string | null;
  onCancelEdit?: () => void;
}) {
  const [page, setPage] = useState<Page>('hero');
  const [eventName, setEventName] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [selectedVibes, setSelectedVibes] = useState<Vibe[]>([]);
  const [location, setLocation] = useState('');
  const [originCoord, setOriginCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [travelTime, setTravelTime] = useState(30);
  const [stopTimes, setStopTimes] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [rsvpName, setRsvpName] = useState('');
  const [rsvpSubmitting, setRsvpSubmitting] = useState(false);
  const [rsvpMessage, setRsvpMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [savedDiscoveredIds, setSavedDiscoveredIds] = useState<Set<string>>(new Set());
  const [savingDiscoveredId, setSavingDiscoveredId] = useState<string | null>(null);
  const [existingStops, setExistingStops] = useState<Stop[]>([]);

  const [discoveredVenues, setDiscoveredVenues] = useState<VenueCandidate[]>([]);
  const [randomNightLoading, setRandomNightLoading] = useState(false);
  const [randomNightError, setRandomNightError] = useState<string | null>(null);
  const [newNightLoading, setNewNightLoading] = useState(false);
  const [newNightError, setNewNightError] = useState<string | null>(null);
  const [newNightDistanceLoading, setNewNightDistanceLoading] = useState(false);
  const [newNightTravelTimes, setNewNightTravelTimes] = useState<Record<string, string | null>>({});
  const [savedVenueList, setSavedVenueList] = useState<SavedVenue[]>([]);
  const [savedVenueListLoading, setSavedVenueListLoading] = useState(false);
  const [savedVenueSelectedIds, setSavedVenueSelectedIds] = useState<Set<string>>(new Set());
  const { displayName, dietaryPreferences } = useAuth();
  const [adHocDietaryFilters, setAdHocDietaryFilters] = useState<Set<string>>(new Set());

  // Inline venue form state (link extract + manual entry)
  const [qaName, setQaName] = useState('');
  const [qaAddress, setQaAddress] = useState('');
  const [qaType, setQaType] = useState<VenueType>('food');
  const [qaTags, setQaTags] = useState<string[]>([]);
  const [qaTagInput, setQaTagInput] = useState('');
  const [qaCollection, setQaCollection] = useState('');
  const [qaSaving, setQaSaving] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);
  const [qaSaved, setQaSaved] = useState(false);
  const [qaLinkInput, setQaLinkInput] = useState('');
  const [qaExtracting, setQaExtracting] = useState(false);
  const [qaExtractedItems, setQaExtractedItems] = useState<ExtractedVenueItem[]>([]);
  const [qaSelectedItems, setQaSelectedItems] = useState<Set<number>>(new Set());
  const [qaSavingMulti, setQaSavingMulti] = useState(false);
  const [qaExtractedCoords, setQaExtractedCoords] = useState<{ lat: number; lon: number } | null>(null);

  /* ── Draft persistence ──────────────────────────────────────────
     Backgrounding the browser (which "check the vibes" forces by opening
     Instagram) can evict the tab on iOS, reloading the page and wiping every
     piece of wizard state above. Save the user-entered parts and resume. */
  const hydrated = useRef(false);

  /* ── Duplicate guard (same pattern as the Venues page) ──
     The wizard doesn't hold the user's venue list, so the check reads it
     fresh; it's RLS-scoped to the caller and cheap. */
  const [dupPending, setDupPending] = useState<PendingDuplicate[] | null>(null);
  const [dupProceed, setDupProceed] = useState<{ all: () => void; newOnly?: () => void } | null>(null);
  const closeDup = () => { setDupPending(null); setDupProceed(null); };

  useEffect(() => {
    if (editPlanId) { hydrated.current = true; return; }
    const d = loadPlanDraft();
    if (d) {
      setPage(d.page as Page);
      setEventName(d.eventName);
      setEventDate(d.eventDate);
      setSelectedVibes(d.selectedVibes as Vibe[]);
      setLocation(d.location);
      setOriginCoord(d.originCoord);
      setTravelTime(d.travelTime);
      setStopTimes(d.stopTimes);
      setDiscoveredVenues(d.discoveredVenues as VenueCandidate[]);
      setSavedVenueSelectedIds(new Set(d.savedVenueSelectedIds));
      setAdHocDietaryFilters(new Set(d.adHocDietaryFilters));
      setQaName(d.qa.name);
      setQaAddress(d.qa.address);
      setQaType(d.qa.type as VenueType);
      setQaTags(d.qa.tags);
      setQaCollection(d.qa.collection);
      // A created plan is re-fetched rather than trusted from storage, so the
      // itinerary and RSVP list reflect what is actually in the database.
      if (d.planId) {
        fetchPlan(d.planId)
          .then(async (p) => {
            if (!p) return;
            setPlan(p);
            const stops = await fetchStops(p.id);
            setExistingStops(sortStops(stops));
            refreshRsvps(p.id);
          })
          .catch(() => { /* plan gone — draft page still shows the inputs */ });
      }
    }
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editPlanId]);

  useEffect(() => {
    if (!hydrated.current || editPlanId) return;
    if (page === 'hero') { clearPlanDraft(); return; }
    savePlanDraft({
      page,
      eventName,
      eventDate,
      selectedVibes,
      location,
      originCoord,
      travelTime,
      stopTimes,
      planId: plan?.id ?? null,
      discoveredVenues,
      savedVenueSelectedIds: Array.from(savedVenueSelectedIds),
      adHocDietaryFilters: Array.from(adHocDietaryFilters),
      qa: { name: qaName, address: qaAddress, type: qaType, tags: qaTags, collection: qaCollection },
    });
  }, [
    editPlanId, page, eventName, eventDate, selectedVibes, location, originCoord, travelTime,
    stopTimes, plan, discoveredVenues, savedVenueSelectedIds, adHocDietaryFilters,
    qaName, qaAddress, qaType, qaTags, qaCollection,
  ]);

  const qaAddTag = () => {
    const tag = qaTagInput.trim().toLowerCase();
    if (!tag || qaTags.includes(tag)) {
      setQaTagInput('');
      return;
    }
    setQaTags([...qaTags, tag]);
    setQaTagInput('');
  };

  const qaRemoveTag = (tag: string) => {
    setQaTags(qaTags.filter((t) => t !== tag));
  };

  const qaResetForm = () => {
    setQaName('');
    setQaAddress('');
    setQaType('food');
    setQaTags([]);
    setQaTagInput('');
    setQaCollection('');
    setQaLinkInput('');
    setQaExtractedItems([]);
    setQaSelectedItems(new Set());
    setQaExtractedCoords(null);
    setQaError(null);
  };

  const qaHandleExtract = async () => {
    const link = qaLinkInput.trim();
    if (!link) {
      setQaError('Paste a link first.');
      return;
    }
    setQaExtracting(true);
    setQaError(null);
    setQaExtractedItems([]);
    setQaSelectedItems(new Set());
    setQaExtractedCoords(null);
    try {
      const items = await extractVenuesFromLink(link);
      if (items.length === 0) {
        setQaError("Couldn't extract venue details from this link. Try pasting the venue's official page instead, or enter the details manually below.");
      } else if (items.length === 1) {
        const v = items[0];
        setQaName(v.name);
        setQaAddress(v.address);
        setQaType(v.type);
        setQaTags(v.tags ?? []);
        if (v.lat != null && v.lon != null) setQaExtractedCoords({ lat: v.lat, lon: v.lon });
      } else {
        setQaExtractedItems(items);
        setQaSelectedItems(new Set(items.map((_, i) => i)));
      }
    } catch {
      setQaError("Couldn't extract venue. Please enter details manually below.");
    } finally {
      setQaExtracting(false);
    }
  };

  const qaToggleItem = (idx: number) => {
    setQaSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const qaHandleSaveMulti = async () => {
    const picked = qaExtractedItems.filter((_, i) => qaSelectedItems.has(i));
    if (picked.length === 0) {
      setQaError('Select at least one venue to save.');
      return;
    }
    const link = qaLinkInput.trim() || null;
    const existing = await fetchSavedVenues().catch(() => []);
    const flagged: PendingDuplicate[] = [];
    const clean: typeof picked = [];
    for (const item of picked) {
      const matches = findSimilarVenues({ name: item.name, address: item.address, link, lat: item.lat, lon: item.lon }, existing);
      if (matches.length > 0) flagged.push({ candidate: { name: item.name, address: item.address, link }, matches });
      else clean.push(item);
    }
    if (flagged.length > 0) {
      setDupPending(flagged);
      setDupProceed({
        all: () => { closeDup(); void qaPerformSaveMulti(picked); },
        newOnly: clean.length > 0 ? () => { closeDup(); void qaPerformSaveMulti(clean); } : undefined,
      });
      return;
    }
    await qaPerformSaveMulti(picked);
  };

  const qaPerformSaveMulti = async (picked: ExtractedVenueItem[]) => {
    setQaSavingMulti(true);
    setQaError(null);
    try {
      for (const item of picked) {
        const saved = await insertSavedVenue({
          name: item.name,
          address: item.address,
          type: item.type,
          link: qaLinkInput.trim() || null,
          lat: item.lat ?? null,
          lon: item.lon ?? null,
          tags: item.tags ?? [],
        });
        if (item.lat == null || item.lon == null) {
          const coords = await geocodeAddress(item.address);
          if (coords) await updateSavedVenueCoords(saved.id, coords.lat, coords.lon);
        }
      }
      setQaSaved(true);
      setQaExtractedItems([]);
      setQaSelectedItems(new Set());
      setQaLinkInput('');
      setTimeout(() => setQaSaved(false), 2500);
    } catch (e) {
      setQaError(e instanceof Error ? e.message : 'Failed to save venues');
    } finally {
      setQaSavingMulti(false);
    }
  };

  const handleQuickAddSave = async () => {
    if (!qaName.trim() || !qaAddress.trim()) {
      setQaError('Name and address are required.');
      return;
    }
    const candidate = {
      name: qaName.trim(), address: qaAddress.trim(), link: qaLinkInput.trim() || null,
      lat: qaExtractedCoords?.lat ?? null, lon: qaExtractedCoords?.lon ?? null,
    };
    const existing = await fetchSavedVenues().catch(() => []);
    const matches = findSimilarVenues(candidate, existing);
    if (matches.length > 0) {
      setDupPending([{ candidate, matches }]);
      setDupProceed({ all: () => { closeDup(); void performQuickAddSave(); } });
      return;
    }
    await performQuickAddSave();
  };

  const performQuickAddSave = async () => {
    setQaSaving(true);
    setQaError(null);
    try {
      const saved = await insertSavedVenue({
        name: qaName.trim(),
        address: qaAddress.trim(),
        type: qaType,
        link: qaLinkInput.trim() || null,
        lat: qaExtractedCoords?.lat ?? null,
        lon: qaExtractedCoords?.lon ?? null,
        tags: qaTags,
        collection: qaCollection.trim() || null,
      });
      if (!qaExtractedCoords) {
        const coords = await geocodeAddress(qaAddress.trim());
        if (coords) await updateSavedVenueCoords(saved.id, coords.lat, coords.lon);
      }
      setQaSaved(true);
      qaResetForm();
      setQaExtractedCoords(null);
      setTimeout(() => setQaSaved(false), 2500);
    } catch {
      setQaError('Failed to save venue');
    } finally {
      setQaSaving(false);
    }
  };

  // Load existing plan data when editing
  useEffect(() => {
    if (!editPlanId) return;
    let cancelled = false;
    setLoadingEdit(true);
    (async () => {
      try {
        const [existingPlan, stops] = await Promise.all([
          fetchPlan(editPlanId),
          fetchStops(editPlanId),
        ]);
        if (cancelled || !existingPlan) return;
        setPlan(existingPlan);
        setEventName(existingPlan.title);
        setEventDate(existingPlan.date);
        setLocation(existingPlan.location ?? '');
        const vibes = (existingPlan.type || '')
          .split(',')
          .filter(Boolean) as Vibe[];
        setSelectedVibes(vibes);
        setExistingStops(sortStops(stops));
        const times: Record<string, string> = {};
        for (const s of stops) {
          times[`${s.name}-${s.address}`] = s.time;
        }
        setStopTimes(times);
        setPage('itinerary');
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoadingEdit(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editPlanId]);

  const toggleVibe = (vibe: Vibe) => {
    setSelectedVibes((prev) => {
      if (prev.includes(vibe)) return prev.filter((v) => v !== vibe);
      if (prev.length >= 3) return prev;
      return [...prev, vibe];
    });
  };

  // Build itinerary: once a plan exists (new or edit), use database stops so times
  // persist; otherwise use selected saved venues or discovered venues for the preview.
  const itinerary = (() => {
    let items;
    if (plan && existingStops.length > 0) {
      items = existingStops.map((s) => ({
        vibe: 'food' as Vibe,
        name: s.name,
        address: s.address,
        vibe_link: s.vibe_link,
        time: stopTimes[`${s.name}-${s.address}`] ?? s.time,
        stopId: s.id,
      }));
    } else {
      items = discoveredVenues.map((dv) => ({
        vibe: dv.type as Vibe,
        name: dv.name,
        address: dv.address,
        vibe_link: dv.vibe_link,
        time: stopTimes[`${dv.name}-${dv.address}`] ?? VIBE_DEFAULT_TIMES[dv.type as Vibe] ?? '19:00',
        stopId: undefined as string | undefined,
      }));
    }
    return [...items].sort((a, b) => a.time.localeCompare(b.time));
  })();



  const loadSavedVenuesForSelect = useCallback(async () => {
    setSavedVenueListLoading(true);
    try {
      const data = await fetchSavedVenues();
      setSavedVenueList(data);
    } catch {
      /* ignore */
    } finally {
      setSavedVenueListLoading(false);
    }
  }, []);

  const refreshRsvps = useCallback(async (pid: string) => {
    try {
      setRsvps(await fetchRsvps(pid));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (page === 'savedVenuesSelect') {
      setSavedVenueSelectedIds(new Set());
      loadSavedVenuesForSelect();
    }
  }, [page, loadSavedVenuesForSelect]);

  const buildAndCreatePlan = async (
    venues: { name: string; address: string; type: VenueType; vibe_link: string | null }[]
  ) => {
    if (creating || venues.length === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const stopsData = venues.map((v, i) => ({
        name: v.name,
        address: v.address,
        time: VIBE_DEFAULT_TIMES[v.type as Vibe] ?? '19:00',
        vibe_link: v.vibe_link,
        sort_order: i,
      }));
      const newPlan = await createPlan({
        title: eventName || 'Night Out',
        date: eventDate,
        host_name: displayName || 'You',
        // No silent default: a plan with no typed location gets the GPS
        // origin if there is one, else null. 'Melbourne' used to be hardcoded
        // here, which is why every plan without a location said Melbourne.
        location: location.trim()
          || (originCoord ? `${originCoord.lat.toFixed(4)}, ${originCoord.lon.toFixed(4)}` : null),
        type: selectedVibes.join(','),
        status: 'active',
      });
      await createStops(newPlan.id, stopsData);
      setPlan(newPlan);
      const created = await fetchStops(newPlan.id);
      setExistingStops(sortStops(created));
      const times: Record<string, string> = {};
      for (const s of created) times[`${s.name}-${s.address}`] = s.time;
      setStopTimes(times);
      refreshRsvps(newPlan.id);
      setPage('itinerary');
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Something went wrong creating your plan. Check your connection and try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveDiscoveredVenue = async (v: VenueCandidate) => {
    const key = `${v.name}|${v.address}`;
    if (savedDiscoveredIds.has(key) || savingDiscoveredId) return;
    const existing = await fetchSavedVenues().catch(() => []);
    const matches = findSimilarVenues({ name: v.name, address: v.address, link: v.vibe_link }, existing);
    if (matches.length > 0) {
      setDupPending([{ candidate: { name: v.name, address: v.address, link: v.vibe_link }, matches }]);
      setDupProceed({ all: () => { closeDup(); void performSaveDiscoveredVenue(v); } });
      return;
    }
    await performSaveDiscoveredVenue(v);
  };

  const performSaveDiscoveredVenue = async (v: VenueCandidate) => {
    const key = `${v.name}|${v.address}`;
    setSavingDiscoveredId(key);
    try {
      const saved = await insertSavedVenue({
        name: v.name,
        address: v.address,
        type: v.type,
        link: v.vibe_link,
        lat: null,
        lon: null,
        tags: [],
      });
      const coords = await geocodeAddress(v.address);
      if (coords) await updateSavedVenueCoords(saved.id, coords.lat, coords.lon);
      setSavedDiscoveredIds((prev) => new Set(prev).add(key));
    } catch {
      /* ignore — user can retry */
    } finally {
      setSavingDiscoveredId(null);
    }
  };

  const googleMapsUrl = (name: string, address: string) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${address}`)}`;

  const effectiveOrigin: OriginInput | null = originCoord ?? (location.trim() || null);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported on this device.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginCoord({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocation('');
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError('Location permission denied. Enter an address instead.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocationError('Could not determine your location. Enter an address instead.');
        } else if (err.code === err.TIMEOUT) {
          setLocationError('Location request timed out. Try again or enter an address.');
        } else {
          setLocationError('Could not get your location. Enter an address instead.');
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleRandomNight = async () => {
    if (randomNightLoading) return;
    if (selectedVibes.length === 0 || !effectiveOrigin) return;
    setRandomNightLoading(true);
    setRandomNightError(null);
    try {
      const allSaved = await fetchSavedVenues();
      if (allSaved.length === 0) {
        setRandomNightError("You don't have any saved venues yet. Try 'Something New' instead!");
        return;
      }
      const matching = allSaved.filter((v) => selectedVibes.includes(v.type as Vibe));
      if (matching.length === 0) {
        setRandomNightError(`No saved venues match your selected vibes. Try 'Something New' instead!`);
        return;
      }
      const destinations = matching.map((v) => v.address);
      const distances = await fetchDistanceMatrix(effectiveOrigin, destinations);
      if (!distances) {
        setRandomNightError("Couldn't check travel times. Please try again.");
        return;
      }
      const filtered = matching.filter((_, i) => {
        const d = distances[i];
        return d && d.durationSeconds !== null && !d.error && d.durationSeconds <= travelTime * 60;
      });
      if (filtered.length === 0) {
        setRandomNightError(`No saved venues within ${travelTime} min. Try increasing your travel time or try 'Something New'.`);
        return;
      }
      const { picked, missing } = pickOnePerVibe(filtered, selectedVibes);
      if (picked.length === 0) {
        setRandomNightError('No venues found. Try different vibes or location.');
        return;
      }
      if (missing.length > 0) {
        setRandomNightError(
          `You have no saved ${describeVibes(missing)} venues within ${travelTime} min. Building the night without it.`
        );
      }
      await buildAndCreatePlan(picked.map((v) => ({ name: v.name, address: v.address, type: v.type, vibe_link: v.link })));
    } catch (e) {
      setRandomNightError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setRandomNightLoading(false);
    }
  };

  const handleDiscoverNew = async () => {
    if (newNightLoading) return;
    if (selectedVibes.length === 0 || !effectiveOrigin) return;
    setNewNightLoading(true);
    setNewNightError(null);
    setDiscoveredVenues([]);
    setNewNightTravelTimes({});
    try {
      // Saved venues say what they like; plan history says what they do.
      // History failing to load must never block discovery.
      const [allSaved, history] = await Promise.all([
        fetchSavedVenues(),
        fetchRecentPlanHistory().catch(() => []),
      ]);
      const combinedDietary = Array.from(new Set([...dietaryPreferences, ...adHocDietaryFilters]));
      const candidates = await discoverSmartVenueCandidates(
        selectedVibes,
        effectiveOrigin,
        allSaved,
        travelTime,
        combinedDietary.length > 0 ? combinedDietary : undefined,
        history
      );
      if (candidates.length === 0) {
        setNewNightError('No venues found. Try a different suburb or postcode.');
        return;
      }

      // Pick one random venue per selected vibe from the full AI-suggested set
      const { picked, missing } = pickOnePerVibe(candidates, selectedVibes);
      if (picked.length === 0) {
        setNewNightError('No venues found. Try different vibes or location.');
        return;
      }
      if (missing.length > 0) {
        // Say which vibe could not be filled instead of quietly returning a
        // shorter night than was asked for.
        setNewNightError(
          `Couldn't find anything for ${describeVibes(missing)} near ${
            typeof effectiveOrigin === 'string' ? effectiveOrigin : 'you'
          }. Showing the rest — try a wider travel time or a different area.`
        );
      }
      setDiscoveredVenues(picked);

      // Fetch travel times in the background — non-blocking, never rejects venues
      setNewNightDistanceLoading(true);
      const destinations = picked.map((c) => c.address);
      fetchDistanceMatrix(effectiveOrigin, destinations)
        .then((distances) => {
          if (!distances) return;
          const times: Record<string, string | null> = {};
          for (let i = 0; i < picked.length; i++) {
            const d = distances[i];
            times[picked[i].name] = d && d.durationText ? d.durationText : null;
          }
          setNewNightTravelTimes(times);
        })
        .catch(() => {
          // travel-time fetch failed — venues still show, just no badges
        })
        .finally(() => setNewNightDistanceLoading(false));
    } catch (e) {
      setNewNightError(e instanceof Error ? e.message : 'Something went wrong discovering venues.');
    } finally {
      setNewNightLoading(false);
    }
  };

  const handleRsvp = async (status: RsvpStatus) => {
    if (!rsvpName.trim() || !plan) return;
    setRsvpSubmitting(true);
    setRsvpMessage(null);
    try {
      await insertRsvp({ plan_id: plan.id, name: rsvpName.trim(), status });
      await sendGuestRsvpPushNotification({ planId: plan.id, rsvpName: rsvpName.trim(), rsvpStatus: status });
      await refreshRsvps(plan.id);
      setRsvpName('');
      setRsvpMessage(
        status === 'in' ? "You're in! See you there." : 'No worries — maybe next time.'
      );
    } catch {
      setRsvpMessage('Something went wrong. Please try again.');
    } finally {
      setRsvpSubmitting(false);
    }
  };

  const shareUrl = plan
    ? `${window.location.origin}${window.location.pathname}#/plan/${plan.id}/rsvp`
    : '#';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const handleSocialShare = async () => {
    if (navigator.share && plan) {
      try {
        await navigator.share({
          title: eventName || 'Night Out',
          text: `Join me for ${eventName || 'a night out'}!`,
          url: shareUrl,
        });
      } catch {
        /* cancelled */
      }
    } else {
      handleCopy();
    }
  };

  const handleInviteFriend = async () => {
    if (!plan) return;
    const message = buildInviteMessage(plan);
    await shareOrCopy(plan.title, message, shareUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2000);
  };

  // Mounted on every page that can save a venue. Radix portals it to <body>,
  // so its position in the tree doesn't matter — only that it's rendered.
  const dupDialog = (
    <DuplicateVenueDialog
      pending={dupPending}
      onAddAnyway={() => dupProceed?.all()}
      onSkipDuplicates={dupProceed?.newOnly}
      onCancel={closeDup}
    />
  );

  /* ── PAGE: HERO ── */
  if (page === 'hero') {
    return (
      <div className="relative flex min-h-screen flex-col items-center overflow-y-auto bg-black px-6 pb-28 pt-16 text-center">
        {dupDialog}
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at center, #1a1207 0%, #0a0a0a 55%, #000000 100%)',
          }}
        />
        <div className="relative z-10 flex w-full max-w-md flex-col items-center">
          <Logo size={80} />
          <h1 className="mt-5 text-3xl font-bold tracking-[0.3em] text-white">
            OPEN FINDS
          </h1>
          <p className="mt-3 text-base font-medium text-gold">
            Plan less. Go out more.
          </p>

          {/* Primary actions — inline so they never cover the form below */}
          <div className="mt-6 flex w-full flex-col gap-3">
            <button
              onClick={() => setPage('occasion')}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card bg-gold px-10 py-3.5 text-lg font-bold text-black shadow-gold-glow transition-all duration-200 active:scale-[0.98]"
            >
              <Sparkles size={20} /> Start Planning
            </button>
            <button
              onClick={() => navigate('/trip-setup')}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border-2 border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all duration-200 active:scale-[0.98] hover:border-gold hover:bg-gold/10"
            >
              <Compass size={20} /> Plan a Trip
            </button>
          </div>

          {qaSaved && (
            <div className="mt-5 flex w-full items-center justify-center gap-2 rounded-card border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success animate-fade-in">
              <Check size={18} /> Venue saved! Find it in your Venues tab.
            </div>
          )}

          {/* Link extraction bar */}
          <div className="mt-6 w-full rounded-card border border-gold/20 bg-[#0d0d0d] p-5 text-left">
            {qaError && (
              <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                {qaError}
              </p>
            )}
            <label className="mb-2 block text-sm font-medium text-ink-secondary">
              Paste a link to extract venue details
            </label>
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold" size={18} />
              <input
                type="url"
                value={qaLinkInput}
                onChange={(e) => setQaLinkInput(e.target.value)}
                placeholder="https://instagram.com/..."
                className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
              />
            </div>
            <button
              onClick={qaHandleExtract}
              disabled={qaExtracting}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-2.5 text-sm font-bold text-gold transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {qaExtracting ? (
                <><Loader2 size={18} className="animate-spin" /> Extracting...</>
              ) : (
                <><Sparkles size={18} /> Extract Venue</>
              )}
            </button>
          </div>

          {/* Multi-venue extraction results */}
          {qaExtractedItems.length > 1 && (
            <div className="mt-3 w-full rounded-card border border-gold/20 bg-[#0d0d0d] p-4 text-left">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gold">
                  {qaExtractedItems.length} venues found
                </p>
                <span className="text-xs text-ink-secondary">Tap to select</span>
              </div>
              <div className="space-y-2">
                {qaExtractedItems.map((item, idx) => {
                  const isSelected = qaSelectedItems.has(idx);
                  return (
                    <button
                      key={idx}
                      onClick={() => qaToggleItem(idx)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all active:scale-[0.98] ${
                        isSelected ? 'border-gold bg-gold/10' : 'border-gold/10 bg-black/20 opacity-60'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{item.name}</p>
                        <p className="truncate text-xs text-ink-secondary">{item.address}</p>
                      </div>
                      <div className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
                        isSelected ? 'border-gold bg-gold text-black' : 'border-gold/30 bg-transparent'
                      }`}>
                        {isSelected && <Check size={14} strokeWidth={3} />}
                      </div>
                    </button>
                  );
                })}
              </div>
              <button
                onClick={qaHandleSaveMulti}
                disabled={qaSavingMulti || qaSelectedItems.size === 0}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-40"
              >
                {qaSavingMulti ? (
                  <><Loader2 size={18} className="animate-spin" /> Saving...</>
                ) : (
                  <>Save {qaSelectedItems.size > 0 ? qaSelectedItems.size : ''} Venue{qaSelectedItems.size === 1 ? '' : 's'}</>
                )}
              </button>
            </div>
          )}

          {/* Manual entry form — only when not showing multi-venue results */}
          {qaExtractedItems.length <= 1 && (
            <div className="mt-3 w-full rounded-card border border-gold/20 bg-[#0d0d0d] p-5 text-left">
              <div className="mb-3">
                <label className="mb-1.5 block text-sm font-medium text-ink-secondary">Venue name</label>
                <input
                  type="text"
                  value={qaName}
                  onChange={(e) => setQaName(e.target.value)}
                  placeholder="e.g. Brazico Churrasco"
                  className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                />
              </div>
              <div className="mb-3">
                <label className="mb-1.5 block text-sm font-medium text-ink-secondary">Venue address</label>
                <input
                  type="text"
                  value={qaAddress}
                  onChange={(e) => setQaAddress(e.target.value)}
                  placeholder="Suburb or full address"
                  className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                />
              </div>
              <div className="mb-3">
                <label className="mb-1.5 block text-sm font-medium text-ink-secondary">Type</label>
                <select
                  value={qaType}
                  onChange={(e) => setQaType(e.target.value as VenueType)}
                  className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white focus:border-gold focus:outline-none [color-scheme:dark]"
                >
                  <option value="food">Food</option>
                  <option value="activity">Activity</option>
                  <option value="dessert">Dessert</option>
                  <option value="bar">Bar</option>
                </select>
              </div>
              <div className="mb-3">
                <label className="mb-1.5 block text-sm font-medium text-ink-secondary">
                  Collection <span className="text-ink-secondary/60">(optional)</span>
                </label>
                <input
                  type="text"
                  value={qaCollection}
                  onChange={(e) => setQaCollection(e.target.value)}
                  placeholder="e.g. Bali, Sydney, Activities"
                  className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                />
              </div>
              <div className="mb-4">
                <label className="mb-1.5 block text-sm font-medium text-ink-secondary">
                  Tags <span className="text-ink-secondary/60">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={qaTagInput}
                    onChange={(e) => setQaTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        qaAddTag();
                      }
                    }}
                    placeholder="Add a tag (e.g. pho, pizza)"
                    className="flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                  />
                  <button
                    onClick={qaAddTag}
                    type="button"
                    className="flex shrink-0 items-center justify-center rounded-card border border-gold/30 bg-gold/10 px-4 text-gold transition-all active:scale-90"
                  >
                    <Plus size={18} />
                  </button>
                </div>
                {qaTags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {qaTags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold"
                      >
                        <Tag size={9} className="text-gold/50" />
                        {tag}
                        <button
                          onClick={() => qaRemoveTag(tag)}
                          type="button"
                          className="text-gold/60 transition-colors hover:text-danger"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleQuickAddSave}
                disabled={qaSaving}
                className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3.5 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-40"
              >
                {qaSaving ? 'Saving...' : 'Save Venue'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── PAGE: OCCASION ── */
  if (page === 'occasion') {
    const canProceed = eventName.trim() && eventDate;
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-44">
        <BackButton onClick={() => setPage('hero')} />
        <div className="flex w-full flex-1 flex-col justify-center">
          <h2 className="mb-8 text-3xl font-bold text-gold">What's the occasion?</h2>
          <input
            type="text"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            placeholder="Event name"
            className="w-full rounded-card border border-gold/40 bg-black/60 px-4 py-3.5 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/50"
          />
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="mt-4 w-full rounded-card border border-gold/40 bg-black/60 px-4 py-3.5 text-white focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/50 [color-scheme:dark]"
          />
          <p className="mt-3 text-sm text-ink-secondary">
            Choose a date for your night out
          </p>
        </div>
        <NextButton onClick={() => setPage('planMyNight')} disabled={!canProceed} />
      </div>
    );
  }

  /* ── PAGE: PLAN MY NIGHT (choice) ── */
  if (page === 'planMyNight') {
    if (loadingEdit) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-black">
          <p className="text-sm text-gold">Loading plan...</p>
        </div>
      );
    }
    const choiceButtons = [
      { key: 'randomNight', icon: Dice5, title: 'Curate a Random Night', desc: 'Pick from your saved venues by vibe & travel time' },
      { key: 'savedVenuesSelect', icon: FolderOpen, title: 'From Saved Venues', desc: 'Choose up to 3 venues from your list' },
      { key: 'sponsored', icon: Building2, title: 'Sponsored Venues', desc: 'Discover businesses near you' },
      { key: 'somethingNew', icon: Wand2, title: 'Something New', desc: 'AI finds venues matching your taste' },
    ] as const;
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-24">
        <BackButton onClick={() => (editPlanId && onCancelEdit ? onCancelEdit() : setPage('occasion'))} />
        <div className="flex w-full flex-1 flex-col justify-center">
          <h2 className="mb-2 text-3xl font-bold text-gold">Plan My Night</h2>
          <p className="mb-6 text-sm text-ink-secondary">How do you want to build your night out?</p>
          <div className="space-y-3">
            {choiceButtons.map((btn) => {
              const Icon = btn.icon;
              return (
                <button
                  key={btn.key}
                  onClick={() => setPage(btn.key)}
                  className="flex w-full items-center gap-4 rounded-card border border-gold/30 bg-black/40 p-4 text-left transition-all active:scale-[0.98] hover:border-gold/60"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
                    <Icon size={22} className="text-gold" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-white">{btn.title}</p>
                    <p className="text-xs text-ink-secondary">{btn.desc}</p>
                  </div>
                  <ChevronRight size={20} className="text-gold/50" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* ── PAGE: RANDOM NIGHT (4a) ── */
  if (page === 'randomNight') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-44">
        <BackButton onClick={() => setPage('planMyNight')} />
        <div className="flex w-full flex-1 flex-col justify-center">
          <h2 className="mb-6 text-3xl font-bold text-gold">Curate a Random Night</h2>
          <p className="mb-4 text-sm text-ink-secondary">Pick your vibes and we'll randomly select from your saved venues.</p>
          <div className="flex justify-center gap-3">
            {(Object.keys(VIBE_LABELS) as Vibe[]).map((vibe) => {
              const selected = selectedVibes.includes(vibe);
              return (
                <button
                  key={vibe}
                  onClick={() => toggleVibe(vibe)}
                  className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-card border px-3 py-3 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                    selected
                      ? 'border-gold bg-gold text-black shadow-gold-glow'
                      : 'border-gold/30 bg-black/50 text-gold hover:border-gold/60'
                  }`}
                >
                  <span className="text-lg">{VIBE_LABELS[vibe].icon}</span>
                  {VIBE_LABELS[vibe].label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-xs text-ink-secondary">Select 1–3 options</p>
          {selectedVibes.length > 0 && (
            <div className="mt-6">
              <TravelSlider value={travelTime} onChange={setTravelTime} />
            </div>
          )}
          <label className="mt-6 block text-sm font-medium text-gold">📍 Where from?</label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                if (e.target.value.trim()) setOriginCoord(null);
              }}
              placeholder={originCoord ? 'Using your location' : 'Suburb or postcode'}
              className={`flex-1 rounded-card border bg-black/60 px-4 py-3.5 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/50 ${
                originCoord ? 'border-gold/50' : 'border-gold/40'
              }`}
            />
            <button
              onClick={handleUseMyLocation}
              disabled={locating}
              aria-label="Use my location"
              className={`flex shrink-0 items-center justify-center rounded-card border px-4 py-3.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                originCoord
                  ? 'border-gold bg-gold/15 text-gold'
                  : 'border-gold/30 bg-black/60 text-gold hover:bg-gold/10'
              }`}
            >
              {locating ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
            </button>
          </div>
          {originCoord && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gold/70">
              <MapPin size={12} /> Location set to your current position
            </p>
          )}
          {locationError && (
            <p className="mt-2 text-xs text-danger">{locationError}</p>
          )}
          {randomNightError && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {randomNightError}
            </p>
          )}
          {createError && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {createError}
            </p>
          )}
        </div>
        <NextButton
          onClick={handleRandomNight}
          disabled={randomNightLoading || selectedVibes.length === 0 || !effectiveOrigin}
          label={randomNightLoading ? 'Curating...' : 'Curate a Date'}
        />
      </div>
    );
  }

  /* ── PAGE: SAVED VENUES SELECT (4b) ── */
  if (page === 'savedVenuesSelect') {
    const toggleSavedSelect = (id: string) => {
      setSavedVenueSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else if (next.size < 3) next.add(id);
        return next;
      });
    };
    const canProceed = savedVenueSelectedIds.size >= 1;
    const handleProceed = async () => {
      const chosen = savedVenueList.filter((v) => savedVenueSelectedIds.has(v.id));
      if (chosen.length === 0) return;
      const vibes = new Set(selectedVibes);
      for (const v of chosen) vibes.add(v.type as Vibe);
      setSelectedVibes(Array.from(vibes).slice(0, 3) as Vibe[]);
      await buildAndCreatePlan(chosen.map((v) => ({ name: v.name, address: v.address, type: v.type, vibe_link: v.link })));
    };
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-44">
        <BackButton onClick={() => setPage('planMyNight')} />
        <div className="flex w-full flex-1 flex-col justify-center">
          <h2 className="mb-2 text-3xl font-bold text-gold">From Saved Venues</h2>
          <p className="mb-4 text-sm text-ink-secondary">Select up to 3 venues from your list.</p>
          {savedVenueListLoading ? (
            <p className="py-8 text-center text-sm text-ink-secondary">Loading...</p>
          ) : savedVenueList.length === 0 ? (
            <div className="py-8 text-center">
              <p className="mb-2 text-sm text-ink-secondary">No saved venues yet.</p>
              <p className="text-xs text-ink-secondary">Add venues from the Add Venue tab first.</p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs font-medium text-gold">{savedVenueSelectedIds.size}/3 selected</p>
              <div className="space-y-3">
                {savedVenueList.map((v) => {
                  const isSelected = savedVenueSelectedIds.has(v.id);
                  return (
                    <div
                      key={v.id}
                      className={`flex w-full items-start gap-3 rounded-card border p-4 text-left transition-all active:scale-[0.98] ${
                        isSelected
                          ? 'border-gold bg-gold/10 shadow-gold-glow'
                          : 'border-gold/20 bg-[#1a1a1a] hover:border-gold/50'
                      }`}
                    >
                      <button
                        onClick={() => toggleSavedSelect(v.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <h3 className="truncate font-semibold text-white">{v.name}</h3>
                        <p className="mt-1 flex items-center gap-1 text-sm text-ink-secondary">
                          <MapPin size={13} className="text-gold/70" /> {v.address}
                        </p>
                        <span className="mt-2 inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
                          {VIBE_LABELS[v.type as Vibe]?.label ?? v.type}
                        </span>
                      </button>
                      <a
                        href={googleMapsUrl(v.name, v.address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View ${v.name} on Google Maps`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/5 text-gold transition-all active:scale-90 hover:bg-gold/15"
                      >
                        <MapPin size={15} />
                      </a>
                      {isSelected && (
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold">
                          <Check size={14} className="text-black" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {createError && (
          <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {createError}
          </p>
        )}
        <NextButton
          onClick={handleProceed}
          disabled={!canProceed || creating}
          label={creating ? 'Saving...' : 'Curate a Date'}
        />
      </div>
    );
  }

  /* ── PAGE: SPONSORED (4c) ── */
  if (page === 'sponsored') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-24">
        <BackButton onClick={() => setPage('planMyNight')} />
        <div className="flex w-full flex-1 flex-col justify-center">
          <h2 className="mb-2 text-3xl font-bold text-gold">Sponsored Venues</h2>
          <div className="mt-6 rounded-card border border-gold/20 bg-black/40 p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
              <Building2 size={26} className="text-gold" />
            </div>
            <p className="text-sm font-medium text-white">Coming Soon</p>
            <p className="mt-2 text-xs text-ink-secondary">
              Sponsored venues from local businesses will appear here. Stay tuned!
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ── PAGE: SOMETHING NEW (4d) ── */
  if (page === 'somethingNew') {
    const canProceed = discoveredVenues.length > 0;
    const handleProceed = async () => {
      if (discoveredVenues.length === 0) return;
      await buildAndCreatePlan(discoveredVenues.map((v) => ({ name: v.name, address: v.address, type: v.type, vibe_link: v.vibe_link })));
    };
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-44">
        {dupDialog}
        <BackButton onClick={() => setPage('planMyNight')} />
        <div className="flex w-full flex-1 flex-col justify-center">
          <h2 className="mb-2 text-3xl font-bold text-gold">Something New</h2>
          <p className="mb-4 text-sm text-ink-secondary">Our AI finds venues near you that match your taste, learning from your saved venues.</p>
          <div className="flex justify-center gap-3">
            {(Object.keys(VIBE_LABELS) as Vibe[]).map((vibe) => {
              const selected = selectedVibes.includes(vibe);
              return (
                <button
                  key={vibe}
                  onClick={() => toggleVibe(vibe)}
                  className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-card border px-3 py-3 text-sm font-semibold transition-all duration-200 active:scale-95 ${
                    selected
                      ? 'border-gold bg-gold text-black shadow-gold-glow'
                      : 'border-gold/30 bg-black/50 text-gold hover:border-gold/60'
                  }`}
                >
                  <span className="text-lg">{VIBE_LABELS[vibe].icon}</span>
                  {VIBE_LABELS[vibe].label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-center text-xs text-ink-secondary">Select 1–3 options</p>
          {selectedVibes.length > 0 && (
            <div className="mt-6">
              <TravelSlider value={travelTime} onChange={setTravelTime} />
            </div>
          )}

          {/* Dietary filter chips */}
          <div className="mt-5">
            <p className="mb-2 text-sm font-medium text-gold">Dietary needs?</p>
            <div className="flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((opt) => {
                const isSaved = dietaryPreferences.includes(opt.key);
                const isToggled = adHocDietaryFilters.has(opt.key);
                const isActive = isSaved || isToggled;
                return (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setAdHocDietaryFilters((prev) => {
                        const next = new Set(prev);
                        if (next.has(opt.key)) next.delete(opt.key);
                        else next.add(opt.key);
                        return next;
                      });
                    }}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all duration-200 active:scale-95 ${
                      isActive
                        ? 'border-gold bg-gold text-black'
                        : 'border-gold/30 bg-black/50 text-gold hover:border-gold/60'
                    }`}
                  >
                    {opt.label}
                    {isSaved && !isToggled && (
                      <span className="ml-0.5 text-[9px] opacity-70">saved</span>
                    )}
                  </button>
                );
              })}
            </div>
            {dietaryPreferences.length > 0 && (
              <p className="mt-1.5 text-[11px] text-ink-secondary/70">
                Your saved preferences are applied automatically. Tap chips to add extra filters for this search.
              </p>
            )}
          </div>

          <label className="mt-6 block text-sm font-medium text-gold">📍 Where from?</label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                if (e.target.value.trim()) setOriginCoord(null);
              }}
              placeholder={originCoord ? 'Using your location' : 'Suburb or postcode'}
              className={`flex-1 rounded-card border bg-black/60 px-4 py-3.5 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold/50 ${
                originCoord ? 'border-gold/50' : 'border-gold/40'
              }`}
            />
            <button
              onClick={handleUseMyLocation}
              disabled={locating}
              aria-label="Use my location"
              className={`flex shrink-0 items-center justify-center rounded-card border px-4 py-3.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                originCoord
                  ? 'border-gold bg-gold/15 text-gold'
                  : 'border-gold/30 bg-black/60 text-gold hover:bg-gold/10'
              }`}
            >
              {locating ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
            </button>
          </div>
          {originCoord && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-gold/70">
              <MapPin size={12} /> Location set to your current position
            </p>
          )}
          {locationError && (
            <p className="mt-2 text-xs text-danger">{locationError}</p>
          )}
          <div className="mt-4">
            <button
              onClick={handleDiscoverNew}
              disabled={newNightLoading || selectedVibes.length === 0 || !effectiveOrigin}
              className="flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-3 text-sm font-medium text-gold transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {newNightLoading ? (
                <><Loader2 size={18} className="animate-spin" /> Finding venues...</>
              ) : (
                <><Wand2 size={18} /> Discover Venues</>
              )}
            </button>
          </div>
          {newNightError && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {newNightError}
            </p>
          )}
          {createError && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
              {createError}
            </p>
          )}
          {discoveredVenues.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gold">Itinerary preview</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDiscoverNew}
                    disabled={newNightLoading}
                    className="flex items-center gap-1 text-xs text-ink-secondary transition-colors hover:text-gold disabled:opacity-40"
                  >
                    <RefreshCw size={12} /> Shuffle
                  </button>
                  <HelpTooltip text="Generates a fresh set of venue recommendations from AI, based on your selected vibe and location." />
                </div>
              </div>
              {discoveredVenues.map((v, i) => {
                const travel = newNightTravelTimes[v.name];
                const venueKey = `${v.name}|${v.address}`;
                const isSaved = savedDiscoveredIds.has(venueKey);
                const isSaving = savingDiscoveredId === venueKey;
                return (
                <div
                  key={`${v.name}-${v.address}`}
                  className="flex items-center gap-3 rounded-card border border-gold/20 bg-[#1a1a1a] p-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gold text-xs font-bold text-gold">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-white">{v.name}</p>
                      {newNightDistanceLoading && travel === undefined && (
                        <span className="shrink-0 text-[10px] text-ink-secondary/60">…</span>
                      )}
                      {travel && (
                        <span className="shrink-0 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-medium text-gold">
                          {travel} drive
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-ink-secondary">{v.address}</p>
                  </div>
                  <a
                    href={googleMapsUrl(v.name, v.address)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${v.name} on Google Maps`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-gold/5 text-gold transition-all active:scale-90 hover:bg-gold/15"
                  >
                    <MapPin size={15} />
                  </a>
                  <button
                    onClick={() => handleSaveDiscoveredVenue(v)}
                    disabled={isSaved || isSaving}
                    aria-label={isSaved ? 'Saved' : `Save ${v.name} to your venues`}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-90 ${
                      isSaved
                        ? 'border-success bg-success/15 text-success'
                        : 'border-gold/30 bg-gold/5 text-gold hover:bg-gold/15 disabled:opacity-50'
                    }`}
                  >
                    {isSaving ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : isSaved ? (
                      <Check size={15} />
                    ) : (
                      <Plus size={15} />
                    )}
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>
        <NextButton
          onClick={handleProceed}
          disabled={!canProceed || creating}
          label={creating ? 'Saving...' : 'Curate a Date'}
        />
      </div>
    );
  }

  /* ── PAGE: ITINERARY ── */
  if (page === 'itinerary') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-24">
        <BackButton onClick={() => setPage('planMyNight')} />
        <div className="w-full">
          <h2 className="mb-2 text-3xl font-bold text-gold">Your Itinerary</h2>
          {eventName && <p className="mb-1 text-sm text-white/80">{eventName}</p>}
          {eventDate && (
            <p className="mb-6 text-sm text-ink-secondary">
              {new Date(eventDate).toLocaleDateString('en-AU', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </p>
          )}

          <div className="space-y-4">
            {itinerary.map((stop, i) => {
              const timeKey = `${stop.name}-${stop.address}`;
              return (
                <div
                  key={timeKey}
                  className="rounded-card border border-gold/20 bg-[#1a1a1a] p-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-black text-sm font-bold text-gold">
                      {i + 1}
                    </span>
                    <input
                      type="time"
                      value={stopTimes[timeKey] ?? stop.time}
                      onChange={async (e) => {
                        const newTime = e.target.value;
                        setStopTimes((prev) => ({
                          ...prev,
                          [timeKey]: newTime,
                        }));
                        if (stop.stopId) {
                          try {
                            await updateStop(stop.stopId, { time: newTime });
                          } catch {
                            /* ignore — local state still updated */
                          }
                        }
                      }}
                      className="rounded-lg border border-gold/40 bg-black/60 px-2 py-1 text-sm text-gold focus:border-gold focus:outline-none [color-scheme:dark]"
                    />
                  </div>
                  <h3 className="mt-3 text-lg font-bold text-white">{stop.name}</h3>
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-secondary">
                    <MapPin size={14} className="text-gold/70" /> {stop.address}
                  </p>
                  {stop.vibe_link && (
                    <div className="mt-3 flex items-center gap-2">
                      <a
                        href={stop.vibe_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-card border border-gold/40 px-4 py-2 text-sm font-medium text-gold transition-all active:scale-95"
                      >
                        <ExternalLink size={16} /> Check the vibes
                      </a>
                      <HelpTooltip text="Opens this venue's Instagram or social media page so you can see what the place looks like inside." />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 space-y-3">
            <button
              onClick={handleInviteFriend}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
            >
              <Send size={18} /> {inviteCopied ? 'Copied!' : 'Invite a Friend'}
            </button>
            {editPlanId && onNavigateToDashboard && (
              <button
                onClick={() => onNavigateToDashboard(editPlanId)}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
              >
                <Check size={18} /> Done
              </button>
            )}
            <button
              onClick={() => setPage('share')}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98]"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── PAGE: SHARE ── */
  if (page === 'share') {
    return (
      <div className="relative flex min-h-screen flex-col overflow-y-auto bg-black px-6 pt-20 pb-24">
        <BackButton onClick={() => setPage('itinerary')} />
        <div className="w-full">
          <h2 className="mb-8 text-3xl font-bold text-gold">Share your plan</h2>

          <button
            onClick={handleCopy}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3.5 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98]"
          >
            <Copy size={20} /> {copied ? 'Copied!' : 'Copy Link'}
          </button>

          <button
            onClick={handleInviteFriend}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
          >
            <Smartphone size={18} /> {inviteCopied ? 'Copied!' : 'Invite a Friend'}
          </button>

          <p className="mt-6 mb-3 text-sm font-medium text-ink-secondary">
            Share on social
          </p>
          <div className="grid grid-cols-1 gap-3">
            <button
              onClick={handleSocialShare}
              className="flex min-h-[48px] items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98]"
            >
              WhatsApp / Telegram / Instagram
            </button>
          </div>

          {/* RSVP form */}
          <div className="mt-8 rounded-card border border-gold/20 bg-black/40 p-4">
            <h3 className="mb-3 text-lg font-semibold text-white">Send Your RSVP</h3>
            <input
              type="text"
              value={rsvpName}
              onChange={(e) => setRsvpName(e.target.value)}
              placeholder="Your name"
              disabled={rsvpSubmitting}
              className="w-full rounded-lg border border-gold/40 bg-black/60 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none disabled:opacity-50"
            />
            <div className="mt-3 flex gap-3">
              <button
                onClick={() => handleRsvp('in')}
                disabled={rsvpSubmitting || !rsvpName.trim()}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-card bg-gold px-4 py-3 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check size={18} /> I'm In
              </button>
              <button
                onClick={() => handleRsvp('declined')}
                disabled={rsvpSubmitting || !rsvpName.trim()}
                className="flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-4 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X size={18} /> Can't Make It
              </button>
            </div>
            {rsvpMessage && (
              <p className="mt-3 text-center text-sm font-medium text-gold">
                {rsvpMessage}
              </p>
            )}
          </div>

          {/* Who's Coming — real RSVPs only */}
          <div className="mt-8">
            <h3 className="mb-3 text-lg font-semibold text-white">Who's Coming</h3>
            {rsvps.length === 0 ? (
              <p className="text-sm text-ink-secondary">
                No RSVPs yet. Share the link with your friends.
              </p>
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
                        <p className="text-xs text-ink-secondary">
                          "{r.decline_reason}"
                        </p>
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

          {plan && (
            <button
              onClick={() => { clearPlanDraft(); onNavigateToDashboard(editPlanId ?? plan.id); }}
              className="mt-8 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/60 px-6 py-3 text-base font-bold text-gold transition-all active:scale-[0.98]"
            >
              <LayoutDashboard size={18} /> View Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}
