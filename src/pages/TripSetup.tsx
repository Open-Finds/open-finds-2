import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { navigate } from '../lib/router';
import {
  createTrip,
  createPlan,
  createStops,
  fetchSavedVenues,
  fetchCollections,
  fetchCollectionVenueIds,
  remainingActivePlanSlots,
  type VenueType,
  type SavedVenue,
  type Collection,
} from '../lib/supabase';
import { discoverSmartVenueCandidates, type VenueCandidate } from '../lib/openai';
import { TimeSelect } from '../components/ui/select';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Minus,
  Trash2,
  Sparkles,
  Loader2,
  Compass,
  MapPin,
  Home,
  Check,
  X,
  Search,
  Folder,
} from 'lucide-react';

type Step = 'details' | 'days' | 'generating';

type StopTemplate = {
  id: string;
  label: string;
  vibe: VenueType;
  time: string;
  savedVenueId?: string;
};

const DEFAULT_TEMPLATE: StopTemplate[] = [
  { id: 'breakfast', label: 'Breakfast', vibe: 'food', time: '08:00' },
  { id: 'morning-activity', label: 'Morning Activity', vibe: 'activity', time: '10:00' },
  { id: 'lunch', label: 'Lunch', vibe: 'food', time: '12:30' },
  { id: 'afternoon-activity', label: 'Afternoon Activity', vibe: 'activity', time: '14:30' },
  { id: 'dinner', label: 'Dinner', vibe: 'food', time: '19:00' },
  { id: 'dessert', label: 'Dessert', vibe: 'dessert', time: '21:00' },
  { id: 'drinks', label: 'Drinks', vibe: 'bar', time: '21:30' },
];

const VIBE_OPTIONS: { value: VenueType; label: string; icon: string }[] = [
  { value: 'food', label: 'Food', icon: '🍔' },
  { value: 'activity', label: 'Activity', icon: '🎯' },
  { value: 'dessert', label: 'Dessert', icon: '🍰' },
  { value: 'bar', label: 'Bar', icon: '🍸' },
];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

type DayConfig = {
  stops: StopTemplate[];
  accommodationName: string;
  accommodationAddress: string;
};

export function TripSetupPage() {
  const { displayName } = useAuth();
  const [step, setStep] = useState<Step>('details');
  const [tripName, setTripName] = useState('');
  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [numDays, setNumDays] = useState(3);
  const [dayConfigs, setDayConfigs] = useState<DayConfig[]>(
    Array.from({ length: 3 }, () => ({
      stops: [...DEFAULT_TEMPLATE],
      accommodationName: '',
      accommodationAddress: '',
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [generatingDay, setGeneratingDay] = useState(0);
  const [currentDay, setCurrentDay] = useState(0);
  const [savedVenues, setSavedVenues] = useState<SavedVenue[]>([]);
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [venueSearch, setVenueSearch] = useState('');
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [collectionVenueIds, setCollectionVenueIds] = useState<string[]>([]);
  const [allowAiSuggestions, setAllowAiSuggestions] = useState(true);
  const [venuePickerCollection, setVenuePickerCollection] = useState<string | null>(null);
  const [pickerCollectionVenueIds, setPickerCollectionVenueIds] = useState<string[]>([]);

  useEffect(() => {
    fetchSavedVenues().then(setSavedVenues).catch(() => {});
    fetchCollections().then(setCollections).catch(() => {});
  }, []);

  // Fetch venue IDs for the picker's collection filter when it changes
  useEffect(() => {
    if (venuePickerCollection) {
      fetchCollectionVenueIds(venuePickerCollection).then(setPickerCollectionVenueIds).catch(() => {});
    } else {
      setPickerCollectionVenueIds([]);
    }
  }, [venuePickerCollection]);

  // Check URL for a pre-selected collection (e.g. navigating from a collection's Plan a Trip button)
  useEffect(() => {
    const hash = window.location.hash;
    const queryStr = hash.split('?')[1] ?? '';
    const params = new URLSearchParams(queryStr);
    const collId = params.get('collection');
    if (collId) {
      setSelectedCollectionId(collId);
      fetchCollectionVenueIds(collId).then(setCollectionVenueIds).catch(() => {});
    }
  }, []);

  // When user changes the selected collection, load its venue IDs
  const handleSelectCollection = useCallback((id: string | null) => {
    setSelectedCollectionId(id);
    if (id) {
      fetchCollectionVenueIds(id).then(setCollectionVenueIds).catch(() => {});
    } else {
      setCollectionVenueIds([]);
    }
  }, []);

  // Pre-fill destination from the most common location among the collection's venues
  useEffect(() => {
    if (selectedCollectionId && collectionVenueIds.length > 0 && !destination.trim()) {
      const collVenues = savedVenues.filter((v) => collectionVenueIds.includes(v.id));
      // Extract city-like tokens from addresses (last comma-separated part)
      const cityCounts: Record<string, number> = {};
      for (const v of collVenues) {
        const parts = v.address.split(',').map((p) => p.trim()).filter(Boolean);
        const city = parts[parts.length - 1] ?? v.address;
        cityCounts[city] = (cityCounts[city] ?? 0) + 1;
      }
      const topCity = Object.entries(cityCounts).sort((a, b) => b[1] - a[1])[0];
      if (topCity) setDestination(topCity[0]);
    }
  }, [selectedCollectionId, collectionVenueIds, savedVenues, destination]);

  // Venues filtered by the selected collection, for the picker and AI logic
  const collectionVenues = useMemo(() => {
    if (!selectedCollectionId || collectionVenueIds.length === 0) return savedVenues;
    return savedVenues.filter((v) => collectionVenueIds.includes(v.id));
  }, [savedVenues, selectedCollectionId, collectionVenueIds]);

  const adjustDays = (delta: number) => {
    const next = Math.max(1, Math.min(14, numDays + delta));
    setNumDays(next);
    setDayConfigs((prev) => {
      const arr = [...prev];
      while (arr.length < next)
        arr.push({ stops: [...DEFAULT_TEMPLATE], accommodationName: '', accommodationAddress: '' });
      while (arr.length > next) arr.pop();
      return arr;
    });
    if (currentDay >= next) setCurrentDay(next - 1);
  };

  const updateDayStops = (dayIdx: number, stops: StopTemplate[]) => {
    setDayConfigs((prev) => {
      const next = [...prev];
      next[dayIdx] = { ...next[dayIdx], stops };
      return next;
    });
  };

  const updateDayAccommodation = (dayIdx: number, field: 'accommodationName' | 'accommodationAddress', value: string) => {
    setDayConfigs((prev) => {
      const next = [...prev];
      next[dayIdx] = { ...next[dayIdx], [field]: value };
      return next;
    });
  };

  const removeStop = (dayIdx: number, stopId: string) => {
    updateDayStops(dayIdx, dayConfigs[dayIdx].stops.filter((s) => s.id !== stopId));
  };

  const addStop = (dayIdx: number) => {
    const newStop: StopTemplate = {
      id: `custom-${Date.now()}`,
      label: 'Custom Stop',
      vibe: 'food',
      time: '16:00',
    };
    updateDayStops(dayIdx, [...dayConfigs[dayIdx].stops, newStop]);
  };

  const addSavedVenueAsStop = (dayIdx: number, venue: SavedVenue) => {
    const newStop: StopTemplate = {
      id: `saved-${venue.id}-${Date.now()}`,
      label: venue.name,
      vibe: venue.type,
      time: '15:00',
      savedVenueId: venue.id,
    };
    updateDayStops(dayIdx, [...dayConfigs[dayIdx].stops, newStop]);
    setShowVenuePicker(false);
  };

  const updateStopVibe = (dayIdx: number, stopId: string, vibe: VenueType) => {
    updateDayStops(
      dayIdx,
      dayConfigs[dayIdx].stops.map((s) => (s.id === stopId ? { ...s, vibe } : s))
    );
  };

  const updateStopTime = (dayIdx: number, stopId: string, time: string) => {
    updateDayStops(
      dayIdx,
      dayConfigs[dayIdx].stops.map((s) => (s.id === stopId ? { ...s, time } : s))
    );
  };

  const updateStopLabel = (dayIdx: number, stopId: string, label: string) => {
    updateDayStops(
      dayIdx,
      dayConfigs[dayIdx].stops.map((s) => (s.id === stopId ? { ...s, label } : s))
    );
  };

  const moveStop = (dayIdx: number, stopId: string, dir: -1 | 1) => {
    const stops = [...dayConfigs[dayIdx].stops];
    const i = stops.findIndex((s) => s.id === stopId);
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    [stops[i], stops[j]] = [stops[j], stops[i]];
    updateDayStops(dayIdx, stops);
  };

  const handleAiSuggest = async (dayIdx: number) => {
    setAiSuggesting(true);
    setError(null);
    try {
      const vibesForDay = [...new Set(dayConfigs[dayIdx].stops.map((s) => s.vibe))] as VenueType[];
      const venuePool = selectedCollectionId && !allowAiSuggestions ? collectionVenues : savedVenues;
      const venues = await discoverSmartVenueCandidates(
        vibesForDay,
        destination.trim(),
        venuePool,
        60
      );
      const vibeVenues = new Map<VenueType, VenueCandidate[]>();
      for (const v of venues) {
        const list = vibeVenues.get(v.type as VenueType) ?? [];
        list.push(v);
        vibeVenues.set(v.type as VenueType, list);
      }
      const vibeCounters = new Map<VenueType, number>();
      const newStops = dayConfigs[dayIdx].stops.map((s) => {
        const candidates = vibeVenues.get(s.vibe) ?? [];
        const counter = vibeCounters.get(s.vibe) ?? 0;
        const venue = candidates[counter];
        vibeCounters.set(s.vibe, counter + 1);
        return {
          ...s,
          label: venue?.name ?? s.label,
          savedVenueId: undefined,
        };
      });
      updateDayStops(dayIdx, newStops);
    } catch {
      setError('AI suggestion failed. You can still add venues manually.');
    } finally {
      setAiSuggesting(false);
    }
  };

  const canProceedDetails = tripName.trim() && destination.trim() && startDate;

  const handleGenerate = async () => {
    if (!canProceedDetails) return;
    setStep('generating');
    setError(null);
    setGeneratingDay(0);

    try {
      const slots = await remainingActivePlanSlots();
      if (numDays > slots) {
        setStep('details');
        setError(
          slots < 1
            ? 'Free includes 1 active plan. Cancel it before starting another.'
            : 'A multi-day trip needs Premium. Free includes 1 active plan.',
        );
        return;
      }
      const trip = await createTrip({
        name: tripName.trim(),
        destination: destination.trim(),
        start_date: startDate,
        num_days: numDays,
        host_name: displayName || 'You',
      });

      for (let dayIdx = 0; dayIdx < numDays; dayIdx++) {
        setGeneratingDay(dayIdx + 1);
        const dayDate = addDays(startDate, dayIdx);
        const config = dayConfigs[dayIdx];

        const dayPlan = await createPlan({
          title: `Day ${dayIdx + 1} — ${destination.trim()}`,
          date: dayDate,
          host_name: displayName || 'You',
          location: destination.trim(),
          type: config.stops.map((s) => s.vibe).join(','),
          status: 'active',
          trip_id: trip.id,
          day_number: dayIdx + 1,
          accommodation_name: config.accommodationName.trim() || null,
          accommodation_address: config.accommodationAddress.trim() || null,
        });

        const vibesForDay = [...new Set(config.stops.map((s) => s.vibe))] as VenueType[];
        let venues: VenueCandidate[] = [];
        const shouldAiFill = !config.stops.every((s) => s.savedVenueId) && !(selectedCollectionId && !allowAiSuggestions);
        if (shouldAiFill) {
          try {
            const venuePool = selectedCollectionId ? collectionVenues : savedVenues;
            venues = await discoverSmartVenueCandidates(
              vibesForDay,
              destination.trim(),
              venuePool,
              60
            );
          } catch {
            // If AI discovery fails, continue with placeholder stops
          }
        }

        const vibeVenues = new Map<VenueType, VenueCandidate[]>();
        for (const v of venues) {
          const list = vibeVenues.get(v.type as VenueType) ?? [];
          list.push(v);
          vibeVenues.set(v.type as VenueType, list);
        }

        const vibeCounters = new Map<VenueType, number>();
        const stopsData = config.stops.map((s, i) => {
          if (s.savedVenueId) {
            const sv = savedVenues.find((v) => v.id === s.savedVenueId);
            return {
              name: sv?.name ?? s.label,
              address: sv?.address ?? destination.trim(),
              time: s.time,
              vibe_link: sv?.link ?? null,
              sort_order: i,
            };
          }
          const candidates = vibeVenues.get(s.vibe) ?? [];
          const counter = vibeCounters.get(s.vibe) ?? 0;
          const venue = candidates[counter];
          vibeCounters.set(s.vibe, counter + 1);
          return {
            name: venue?.name ?? `${s.label} in ${destination.trim()}`,
            address: venue?.address ?? destination.trim(),
            time: s.time,
            vibe_link: venue?.vibe_link ?? null,
            sort_order: i,
          };
        });

        await createStops(dayPlan.id, stopsData);
      }

      navigate(`/trip/${trip.id}`);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Something went wrong creating your trip. Please try again.'
      );
      setStep('days');
    }
  };

  if (step === 'generating') {
    return (
      <div className="mx-auto flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <Loader2 size={48} className="animate-spin text-gold" />
        <h2 className="mt-6 text-xl font-bold text-white">Building your trip itinerary</h2>
        <p className="mt-2 text-sm text-ink-secondary">
          {generatingDay > 0
            ? `Finding venues for Day ${generatingDay} of ${numDays}...`
            : 'Setting up your trip...'}
        </p>
        <div className="mt-6 w-full max-w-xs">
          <div className="h-2 overflow-hidden rounded-full bg-gold/20">
            <div
              className="h-full rounded-full bg-gold transition-all duration-500"
              style={{ width: `${numDays > 0 ? (generatingDay / numDays) * 100 : 0}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  const pickerVenuePool = venuePickerCollection
    ? savedVenues.filter((v) => pickerCollectionVenueIds.includes(v.id))
    : (selectedCollectionId ? collectionVenues : savedVenues);
  const filteredVenues = pickerVenuePool.filter((v) => {
    const q = venueSearch.trim().toLowerCase();
    if (!q) return true;
    return v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q) || (v.collection ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-24 pt-8">
      <button
        onClick={() => (step === 'details' ? navigate('/') : setStep('details'))}
        className="mb-6 flex items-center text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      {step === 'details' && (
        <div className="animate-fade-in">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border-2 border-gold bg-black">
              <Compass size={28} className="text-gold" />
            </div>
            <h1 className="text-2xl font-bold text-white">Plan a Trip</h1>
            <p className="mt-1 text-sm text-ink-secondary">Build a multi-day itinerary with real venues</p>
          </div>

          <div className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-gold">Trip name</label>
              <input
                type="text"
                value={tripName}
                onChange={(e) => setTripName(e.target.value)}
                placeholder="e.g. Sydney Weekend"
                className="w-full touch-target rounded-card border border-gold/20 bg-surface px-4 text-white placeholder-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gold">Destination city</label>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Sydney"
                className="w-full touch-target rounded-card border border-gold/20 bg-surface px-4 text-white placeholder-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gold">Start date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full touch-target rounded-card border border-gold/20 bg-surface px-4 text-white outline-none transition-all focus:border-gold focus:shadow-gold-glow [color-scheme:dark]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gold">Number of days</label>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => adjustDays(-1)}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-black text-gold transition-all active:scale-90 hover:border-gold hover:bg-gold/10"
                >
                  <Minus size={20} />
                </button>
                <span className="text-3xl font-bold text-white">{numDays}</span>
                <button
                  onClick={() => adjustDays(1)}
                  className="flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-black text-gold transition-all active:scale-90 hover:border-gold hover:bg-gold/10"
                >
                  <Plus size={20} />
                </button>
                <span className="ml-2 text-sm text-ink-secondary">{numDays === 1 ? 'day' : 'days'}</span>
              </div>
            </div>

            {/* Collection picker */}
            {collections.length > 0 && (
              <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Folder size={16} className="text-gold/70" />
                  <label className="text-sm font-medium text-gold">Plan from a collection</label>
                </div>
                <p className="mb-3 text-xs text-ink-secondary">Pick a folder to default the venue picker to those spots.</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => handleSelectCollection(null)}
                    className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-90 ${
                      !selectedCollectionId
                        ? 'border-gold bg-gold/20 text-gold'
                        : 'border-gold/20 bg-black/40 text-ink-secondary hover:border-gold/40'
                    }`}
                  >
                    All venues
                  </button>
                  {collections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSelectCollection(c.id)}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-all active:scale-90 ${
                        selectedCollectionId === c.id
                          ? 'border-gold bg-gold/20 text-gold'
                          : 'border-gold/20 bg-black/40 text-ink-secondary hover:border-gold/40'
                      }`}
                    >
                      <Folder size={11} /> {c.name}
                    </button>
                  ))}
                </div>
                {selectedCollectionId && (
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-gold/10 bg-black/40 px-3 py-2">
                    <span className="text-xs text-ink-secondary">Let AI suggest outside venues to fill gaps?</span>
                    <button
                      onClick={() => setAllowAiSuggestions(!allowAiSuggestions)}
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        allowAiSuggestions ? 'bg-gold' : 'bg-gold/20'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-black transition-transform ${
                          allowAiSuggestions ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
          )}

          <div className="fixed bottom-24 left-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 justify-center px-6 lg:bottom-8 lg:left-auto lg:right-8 lg:translate-x-0">
            <button
              onClick={() => {
                if (canProceedDetails) {
                  setStep('days');
                  setError(null);
                }
              }}
              disabled={!canProceedDetails}
              className={`flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card px-6 py-3.5 text-base font-bold shadow-gold-glow transition-all duration-200 active:scale-[0.98] ${
                canProceedDetails ? 'bg-gold text-black' : 'cursor-not-allowed bg-gray-800 text-gray-500 shadow-none'
              }`}
            >
              Customize Days <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}

      {step === 'days' && (
        <div className="animate-fade-in">
          <div className="mb-4 text-center">
            <h1 className="text-2xl font-bold text-white">Customize Your Days</h1>
            <p className="mt-1 text-sm text-ink-secondary">Edit one day at a time. Add stops, AI suggestions, or your saved venues.</p>
          </div>

          {/* Day selector tabs */}
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            {dayConfigs.map((_, dayIdx) => (
              <button
                key={dayIdx}
                onClick={() => setCurrentDay(dayIdx)}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-all ${
                  currentDay === dayIdx
                    ? 'border-gold bg-gold text-black'
                    : 'border-gold/30 bg-black text-gold'
                }`}
              >
                {dayIdx + 1}
              </button>
            ))}
          </div>

          {/* Single day editor */}
          {(() => {
            const dayIdx = currentDay;
            const config = dayConfigs[dayIdx];
            return (
              <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-4">
                <div className="mb-4 flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-gold bg-black text-sm font-bold text-gold">
                    {dayIdx + 1}
                  </span>
                  <div>
                    <h3 className="font-bold text-white">Day {dayIdx + 1}</h3>
                    <p className="text-xs text-ink-secondary">
                      {startDate ? formatDate(addDays(startDate, dayIdx)) : `Day ${dayIdx + 1}`}
                    </p>
                  </div>
                </div>

                {/* Accommodation */}
                <div className="mb-4 rounded-xl border border-gold/10 bg-black/40 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <Home size={14} className="text-gold/70" />
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">Accommodation</span>
                  </div>
                  <input
                    type="text"
                    value={config.accommodationName}
                    onChange={(e) => updateDayAccommodation(dayIdx, 'accommodationName', e.target.value)}
                    placeholder="Hotel or BnB name (optional)"
                    className="mb-2 w-full rounded-lg border border-gold/20 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                  />
                  <input
                    type="text"
                    value={config.accommodationAddress}
                    onChange={(e) => updateDayAccommodation(dayIdx, 'accommodationAddress', e.target.value)}
                    placeholder="Address (optional)"
                    className="w-full rounded-lg border border-gold/20 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                  />
                </div>

                {/* AI Suggest button */}
                <button
                  onClick={() => handleAiSuggest(dayIdx)}
                  disabled={aiSuggesting}
                  className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-gold/40 bg-gold/10 py-2.5 text-sm font-bold text-gold transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {aiSuggesting ? <><Loader2 size={16} className="animate-spin" /> Suggesting...</> : <><Sparkles size={16} /> Suggest with AI</>}
                </button>

                {/* Stops */}
                <div className="space-y-2">
                  {config.stops.map((stop, i) => (
                    <div key={stop.id} className="rounded-xl border border-gold/10 bg-black/40 p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex flex-col items-center gap-1">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-gold/30 bg-black text-xs font-bold text-gold">{i + 1}</span>
                          <button
                            onClick={() => moveStop(dayIdx, stop.id, -1)}
                            disabled={i === 0}
                            className="text-gold/40 transition-all hover:text-gold disabled:opacity-20"
                            aria-label="Move up"
                          >
                            <ChevronLeft size={14} className="rotate-90" />
                          </button>
                          <button
                            onClick={() => moveStop(dayIdx, stop.id, 1)}
                            disabled={i === config.stops.length - 1}
                            className="text-gold/40 transition-all hover:text-gold disabled:opacity-20"
                            aria-label="Move down"
                          >
                            <ChevronRight size={14} className="rotate-90" />
                          </button>
                        </div>
                        <div className="flex-1">
                          <input
                            type="text"
                            value={stop.label}
                            onChange={(e) => updateStopLabel(dayIdx, stop.id, e.target.value)}
                            className="w-full rounded-lg border border-gold/20 bg-black/50 px-2 py-1.5 text-sm font-medium text-white focus:border-gold focus:outline-none"
                          />
                          <div className="mt-2 flex items-center gap-2">
                            <TimeSelect
                              value={stop.time}
                              onChange={(t) => updateStopTime(dayIdx, stop.id, t)}
                              className="min-w-0 flex-1 [&_button]:px-2 [&_button]:py-1 [&_button]:text-xs"
                            />
                            <div className="flex gap-1">
                              {VIBE_OPTIONS.map((v) => (
                                <button
                                  key={v.value}
                                  onClick={() => updateStopVibe(dayIdx, stop.id, v.value)}
                                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition-all ${
                                    stop.vibe === v.value ? 'bg-gold text-black' : 'border border-gold/20 bg-black/40 text-ink-secondary'
                                  }`}
                                >
                                  <span>{v.icon}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                          {stop.savedVenueId && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 text-[10px] font-medium text-gold">
                              <Check size={9} /> From your venues
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => removeStop(dayIdx, stop.id)}
                          aria-label="Remove stop"
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-danger/70 transition-all hover:bg-danger/10 hover:text-danger active:scale-90"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add stop and Add from venues buttons */}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => addStop(dayIdx)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/30 py-2.5 text-sm font-medium text-gold/70 transition-all hover:border-gold hover:text-gold active:scale-[0.98]"
                  >
                    <Plus size={16} /> Add Stop
                  </button>
                  <button
                    onClick={() => setShowVenuePicker(true)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-gold/30 py-2.5 text-sm font-medium text-gold/70 transition-all hover:border-gold hover:text-gold active:scale-[0.98]"
                  >
                    <MapPin size={16} /> From Saved
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Day navigation */}
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setCurrentDay(Math.max(0, currentDay - 1))}
              disabled={currentDay === 0}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-card border border-gold/20 bg-black/40 py-3 text-sm font-medium text-gold transition-all active:scale-[0.98] disabled:opacity-30"
            >
              <ChevronLeft size={18} /> Prev Day
            </button>
            <button
              onClick={() => setCurrentDay(Math.min(numDays - 1, currentDay + 1))}
              disabled={currentDay === numDays - 1}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-card border border-gold/20 bg-black/40 py-3 text-sm font-medium text-gold transition-all active:scale-[0.98] disabled:opacity-30"
            >
              Next Day <ChevronRight size={18} />
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
          )}

          <div className="fixed bottom-24 left-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 justify-center px-6 lg:bottom-8 lg:left-auto lg:right-8 lg:translate-x-0">
            <button
              onClick={handleGenerate}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card bg-gold px-6 py-3.5 text-base font-bold text-black shadow-gold-glow transition-all duration-200 active:scale-[0.98]"
            >
              <Sparkles size={20} /> Generate Itinerary
            </button>
          </div>
        </div>
      )}

      {/* Venue Picker Modal */}
      {showVenuePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={() => setShowVenuePicker(false)}>
          <div
            className="flex h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-gold/20 bg-[#0d0d0d]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gold/10 p-5">
              <h2 className="text-lg font-bold text-gold">Pick a Saved Venue</h2>
              <button onClick={() => setShowVenuePicker(false)} className="text-ink-secondary transition-colors hover:text-gold">
                <X size={22} />
              </button>
            </div>
            <div className="p-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gold/50" size={16} />
                <input
                  type="text"
                  value={venueSearch}
                  onChange={(e) => setVenueSearch(e.target.value)}
                  placeholder="Search venues..."
                  className="w-full rounded-card border border-gold/20 bg-black/40 py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                />
              </div>
              {collections.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setVenuePickerCollection(null)}
                    className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      !venuePickerCollection
                        ? 'border-gold bg-gold/20 text-gold'
                        : 'border-gold/20 bg-black/40 text-ink-secondary'
                    }`}
                  >
                    All
                  </button>
                  {collections.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setVenuePickerCollection(c.id)}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                        venuePickerCollection === c.id
                          ? 'border-gold bg-gold/20 text-gold'
                          : 'border-gold/20 bg-black/40 text-ink-secondary'
                      }`}
                    >
                      <Folder size={10} /> {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              {filteredVenues.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-secondary">No saved venues found. Add venues in the Venues tab first.</p>
              ) : (
                <div className="space-y-2">
                  {filteredVenues.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => addSavedVenueAsStop(currentDay, v)}
                      className="flex w-full items-center gap-3 rounded-xl border border-gold/20 bg-black/40 p-3 text-left transition-all hover:border-gold hover:bg-gold/5 active:scale-[0.98]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{v.name}</p>
                        <p className="truncate text-xs text-ink-secondary">{v.address}</p>
                        {v.collection && (
                          <span className="mt-1 inline-block rounded-full border border-gold/20 bg-black/40 px-2 py-0.5 text-[10px] text-gold/80">
                            {v.collection}
                          </span>
                        )}
                      </div>
                      <Plus size={18} className="shrink-0 text-gold" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
