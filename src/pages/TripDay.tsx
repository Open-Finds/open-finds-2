import { useEffect, useState, useCallback } from 'react';
import { navigate } from '../lib/router';
import {
  fetchTrip,
  fetchPlan,
  fetchStops,
  fetchStopRsvpsByPlan,
  sortStops,
  updatePlan,
  insertStop,
  deleteStop,
  reorderStops,
  fetchSavedVenues,
  fetchCollections,
  fetchCollectionVenueIds,
  type Trip,
  type Plan,
  type Stop,
  type StopRsvp,
  type SavedVenue,
  type VenueType,
  type Collection,
} from '../lib/supabase';
import { discoverSmartVenueCandidates, type VenueCandidate } from '../lib/openai';
import { StopCard } from '../components/StopCard';
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  MapPin,
  Check,
  X,
  Loader2,
  Compass,
  Home,
  Plus,
  Sparkles,
  Search,
  Trash2,
  Folder,
} from 'lucide-react';

export function TripDayPage({ tripId, dayId }: { tripId: string; dayId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopRsvps, setStopRsvps] = useState<StopRsvp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add stop state
  const [showAddStop, setShowAddStop] = useState(false);
  const [addStopName, setAddStopName] = useState('');
  const [addStopAddress, setAddStopAddress] = useState('');
  const [addStopTime, setAddStopTime] = useState('15:00');
  const [addStopVibe, setAddStopVibe] = useState<VenueType>('food');
  const [savingStop, setSavingStop] = useState(false);

  // Venue picker state
  const [showVenuePicker, setShowVenuePicker] = useState(false);
  const [savedVenues, setSavedVenues] = useState<SavedVenue[]>([]);
  const [venueSearch, setVenueSearch] = useState('');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [venuePickerCollection, setVenuePickerCollection] = useState<string | null>(null);
  const [pickerCollectionVenueIds, setPickerCollectionVenueIds] = useState<string[]>([]);

  // AI suggest state
  const [aiSuggesting, setAiSuggesting] = useState(false);
  const [aiResults, setAiResults] = useState<VenueCandidate[]>([]);
  const [aiSelected, setAiSelected] = useState<Set<number>>(new Set());

  // Accommodation editing
  const [editingAccommodation, setEditingAccommodation] = useState(false);
  const [accName, setAccName] = useState('');
  const [accAddress, setAccAddress] = useState('');
  const [savingAcc, setSavingAcc] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, p, s, r] = await Promise.all([
        fetchTrip(tripId),
        fetchPlan(dayId),
        fetchStops(dayId),
        fetchStopRsvpsByPlan(dayId),
      ]);
      setTrip(t);
      setPlan(p);
      setStops(sortStops(s));
      setStopRsvps(r);
      setAccName(p?.accommodation_name ?? '');
      setAccAddress(p?.accommodation_address ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load day.');
    } finally {
      setLoading(false);
    }
  }, [tripId, dayId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchSavedVenues().then(setSavedVenues).catch(() => {});
    fetchCollections().then(setCollections).catch(() => {});
  }, []);

  useEffect(() => {
    if (venuePickerCollection) {
      fetchCollectionVenueIds(venuePickerCollection).then(setPickerCollectionVenueIds).catch(() => {});
    } else {
      setPickerCollectionVenueIds([]);
    }
  }, [venuePickerCollection]);

  const handleStopSaved = (updated: Stop) => {
    setStops((prev) => sortStops(prev.map((s) => (s.id === updated.id ? updated : s))));
  };

  const handleDeleteStop = async (stopId: string) => {
    try {
      await deleteStop(stopId);
      setStops((prev) => prev.filter((s) => s.id !== stopId));
    } catch {
      // ignore
    }
  };

  const handleMoveStop = async (stopId: string, dir: -1 | 1) => {
    const ordered = [...stops];
    const i = ordered.findIndex((s) => s.id === stopId);
    const j = i + dir;
    if (j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    const newOrder = ordered.map((s, idx) => ({ ...s, sort_order: idx }));
    setStops(newOrder);
    try {
      await reorderStops(dayId, ordered.map((s) => s.id));
    } catch {
      // revert on failure
      setStops(stops);
    }
  };

  const handleAddStop = async () => {
    if (!addStopName.trim() || !addStopAddress.trim()) return;
    setSavingStop(true);
    try {
      const newStop = await insertStop(dayId, {
        name: addStopName.trim(),
        address: addStopAddress.trim(),
        time: addStopTime,
        vibe_link: null,
        sort_order: stops.length,
      });
      setStops((prev) => [...prev, newStop]);
      setShowAddStop(false);
      setAddStopName('');
      setAddStopAddress('');
      setAddStopTime('15:00');
      setAddStopVibe('food');
    } catch {
      setError('Failed to add stop.');
    } finally {
      setSavingStop(false);
    }
  };

  const handleAddSavedVenue = async (venue: SavedVenue) => {
    setSavingStop(true);
    try {
      const newStop = await insertStop(dayId, {
        name: venue.name,
        address: venue.address,
        time: '15:00',
        vibe_link: venue.link,
        sort_order: stops.length,
      });
      setStops((prev) => [...prev, newStop]);
      setShowVenuePicker(false);
    } catch {
      setError('Failed to add stop.');
    } finally {
      setSavingStop(false);
    }
  };

  const handleAiSuggest = async () => {
    setAiSuggesting(true);
    setError(null);
    setAiResults([]);
    setAiSelected(new Set());
    try {
      const vibes: VenueType[] = ['food', 'activity', 'dessert'];
      const results = await discoverSmartVenueCandidates(
        vibes,
        plan?.location ?? trip?.destination ?? '',
        savedVenues,
        60
      );
      setAiResults(results);
      setAiSelected(new Set(results.map((_, i) => i)));
    } catch {
      setError('AI suggestion failed. Try adding venues manually.');
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleAddAiVenues = async () => {
    const picked = aiResults.filter((_, i) => aiSelected.has(i));
    if (picked.length === 0) return;
    setSavingStop(true);
    try {
      let sortOrder = stops.length;
      for (const venue of picked) {
        const newStop = await insertStop(dayId, {
          name: venue.name,
          address: venue.address,
          time: '15:00',
          vibe_link: venue.vibe_link,
          sort_order: sortOrder++,
        });
        setStops((prev) => [...prev, newStop]);
      }
      setAiResults([]);
      setAiSelected(new Set());
    } catch {
      setError('Failed to add venues.');
    } finally {
      setSavingStop(false);
    }
  };

  const handleSaveAccommodation = async () => {
    setSavingAcc(true);
    try {
      const updated = await updatePlan(dayId, {
        accommodation_name: accName.trim() || null,
        accommodation_address: accAddress.trim() || null,
      });
      setPlan(updated);
      setEditingAccommodation(false);
    } catch {
      setError('Failed to save accommodation.');
    } finally {
      setSavingAcc(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gold" />
      </div>
    );
  }

  if (error || !plan || !trip) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10 text-center">
        <p className="text-danger">{error ?? 'Day not found.'}</p>
        <button onClick={() => navigate(`/trip/${tripId}`)} className="btn-secondary mt-4">
          Back to trip
        </button>
      </div>
    );
  }

  // Build Google Maps directions URL with all stops as waypoints
  const allAddresses: string[] = [];
  if (plan.accommodation_address) allAddresses.push(plan.accommodation_address);
  allAddresses.push(...stops.map((s) => s.address));
  const mapsOrigin = allAddresses[0] ?? plan.location;
  const mapsWaypoints = allAddresses.slice(1, 10);
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(mapsOrigin)}${
    mapsWaypoints.length > 0 ? `&waypoints=${encodeURIComponent(mapsWaypoints.join('|'))}` : ''
  }&destination=${encodeURIComponent(allAddresses[allAddresses.length - 1] ?? plan.location)}`;

  const pickerVenuePool = venuePickerCollection
    ? savedVenues.filter((v) => pickerCollectionVenueIds.includes(v.id))
    : savedVenues;
  const filteredVenues = pickerVenuePool.filter((v) => {
    const q = venueSearch.trim().toLowerCase();
    if (!q) return true;
    return v.name.toLowerCase().includes(q) || v.address.toLowerCase().includes(q) || (v.collection ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-24 pt-8">
      <button
        onClick={() => navigate(`/trip/${tripId}`)}
        className="mb-6 flex items-center text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      {/* Day Header */}
      <div className="gold-gradient-bg animate-fade-in rounded-card p-5 text-black shadow-gold-glow">
        <div className="flex items-center gap-2">
          <Compass size={18} />
          <span className="text-xs font-bold uppercase tracking-wide text-black/60">{trip.name}</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold leading-tight">{plan.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium text-black/80">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={15} />
            {new Date(plan.date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <span className="inline-flex items-center gap-1">
            <MapPin size={15} /> {plan.location}
          </span>
        </div>
      </div>

      {/* Accommodation Section */}
      <section className="mt-4">
        {editingAccommodation ? (
          <div className="rounded-card border border-gold/40 bg-[#1a1a1a] p-4">
            <div className="mb-3 flex items-center gap-2">
              <Home size={16} className="text-gold" />
              <span className="text-sm font-semibold text-gold">Edit Accommodation</span>
            </div>
            <input
              type="text"
              value={accName}
              onChange={(e) => setAccName(e.target.value)}
              placeholder="Hotel or BnB name"
              className="mb-2 w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
            />
            <input
              type="text"
              value={accAddress}
              onChange={(e) => setAccAddress(e.target.value)}
              placeholder="Address"
              className="mb-3 w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveAccommodation}
                disabled={savingAcc}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold py-2 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
              >
                {savingAcc ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingAccommodation(false);
                  setAccName(plan.accommodation_name ?? '');
                  setAccAddress(plan.accommodation_address ?? '');
                }}
                disabled={savingAcc}
                className="flex items-center justify-center rounded-lg border border-gold/30 px-4 py-2 text-sm text-ink-secondary transition-all active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setEditingAccommodation(true)}
            className="flex w-full items-center gap-3 rounded-card border border-gold/20 bg-[#1a1a1a] p-4 text-left transition-all hover:border-gold/40 active:scale-[0.98]"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-black">
              <Home size={16} className="text-gold" />
            </div>
            <div className="min-w-0 flex-1">
              {plan.accommodation_name || plan.accommodation_address ? (
                <>
                  <p className="truncate text-sm font-medium text-white">{plan.accommodation_name || 'Accommodation'}</p>
                  {plan.accommodation_address && (
                    <p className="truncate text-xs text-ink-secondary">{plan.accommodation_address}</p>
                  )}
                </>
              ) : (
                <p className="text-sm text-ink-secondary">Add where you're staying (optional)</p>
              )}
            </div>
            <span className="text-xs text-gold/60">Edit</span>
          </button>
        )}
      </section>

      {/* Stops */}
      <section className="mt-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Itinerary</h2>
          <span className="text-sm text-ink-secondary">{stops.length} stop{stops.length === 1 ? '' : 's'}</span>
        </div>
        {stops.length === 0 ? (
          <p className="text-sm text-ink-secondary">No stops for this day yet. Add one below.</p>
        ) : (
          <div className="space-y-3">
            {stops.map((stop, i) => {
              const inCount = stopRsvps.filter((r) => r.stop_id === stop.id && r.status === 'in').length;
              const outCount = stopRsvps.filter((r) => r.stop_id === stop.id && r.status === 'out').length;
              return (
                <div key={stop.id}>
                  <div className="flex items-center gap-1">
                    <div className="flex flex-col">
                      <button
                        onClick={() => handleMoveStop(stop.id, -1)}
                        disabled={i === 0}
                        className="text-gold/40 transition-all hover:text-gold disabled:opacity-20"
                        aria-label="Move up"
                      >
                        <ChevronLeft size={14} className="rotate-90" />
                      </button>
                      <button
                        onClick={() => handleMoveStop(stop.id, 1)}
                        disabled={i === stops.length - 1}
                        className="text-gold/40 transition-all hover:text-gold disabled:opacity-20"
                        aria-label="Move down"
                      >
                        <ChevronRight size={14} className="rotate-90" />
                      </button>
                    </div>
                    <div className="flex-1">
                      <StopCard stop={stop} index={i} onSaved={handleStopSaved} />
                    </div>
                    <button
                      onClick={() => handleDeleteStop(stop.id)}
                      aria-label="Delete stop"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-danger/60 transition-all hover:bg-danger/10 hover:text-danger active:scale-90"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {(inCount > 0 || outCount > 0) && (
                    <div className="ml-10 mt-1.5 flex items-center gap-3 px-2 text-xs">
                      {inCount > 0 && (
                        <span className="flex items-center gap-1 text-success">
                          <Check size={12} /> {inCount} in
                        </span>
                      )}
                      {outCount > 0 && (
                        <span className="flex items-center gap-1 text-danger/70">
                          <X size={12} /> {outCount} skip
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add Stop Section */}
      <section className="mt-6 space-y-3">
        {/* AI Suggest */}
        <button
          onClick={handleAiSuggest}
          disabled={aiSuggesting}
          className="flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-gold/10 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98] disabled:opacity-50"
        >
          {aiSuggesting ? <><Loader2 size={18} className="animate-spin" /> Finding venues...</> : <><Sparkles size={18} /> Suggest with AI</>}
        </button>

        {/* AI Results */}
        {aiResults.length > 0 && (
          <div className="rounded-card border border-gold/20 bg-[#0d0d0d] p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-gold">{aiResults.length} venues found nearby</p>
              <button onClick={() => { setAiResults([]); setAiSelected(new Set()); }} className="text-ink-secondary hover:text-gold">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-2">
              {aiResults.map((venue, idx) => {
                const isSelected = aiSelected.has(idx);
                return (
                  <button
                    key={idx}
                    onClick={() => setAiSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(idx)) next.delete(idx);
                      else next.add(idx);
                      return next;
                    })}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all active:scale-[0.98] ${
                      isSelected ? 'border-gold bg-gold/10' : 'border-gold/10 bg-black/20 opacity-60'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{venue.name}</p>
                      <p className="truncate text-xs text-ink-secondary">{venue.address}</p>
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
              onClick={handleAddAiVenues}
              disabled={savingStop || aiSelected.size === 0}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-card bg-gold py-2.5 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:opacity-40"
            >
              {savingStop ? 'Adding...' : `Add ${aiSelected.size > 0 ? aiSelected.size : ''} to Itinerary`}
            </button>
          </div>
        )}

        {/* Add Stop and From Saved buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => setShowAddStop(!showAddStop)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-card border border-dashed border-gold/30 py-3 text-sm font-medium text-gold/70 transition-all hover:border-gold hover:text-gold active:scale-[0.98]"
          >
            <Plus size={18} /> Add Stop
          </button>
          <button
            onClick={() => setShowVenuePicker(true)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-card border border-dashed border-gold/30 py-3 text-sm font-medium text-gold/70 transition-all hover:border-gold hover:text-gold active:scale-[0.98]"
          >
            <MapPin size={18} /> From Saved
          </button>
        </div>

        {/* Manual Add Stop Form */}
        {showAddStop && (
          <div className="rounded-card border border-gold/30 bg-[#1a1a1a] p-4">
            <h3 className="mb-3 text-sm font-semibold text-gold">Add a Stop</h3>
            <input
              type="text"
              value={addStopName}
              onChange={(e) => setAddStopName(e.target.value)}
              placeholder="Venue name"
              className="mb-2 w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
            />
            <input
              type="text"
              value={addStopAddress}
              onChange={(e) => setAddStopAddress(e.target.value)}
              placeholder="Address"
              className="mb-2 w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
            />
            <div className="mb-3 flex items-center gap-2">
              <input
                type="time"
                value={addStopTime}
                onChange={(e) => setAddStopTime(e.target.value)}
                className="rounded-lg border border-gold/30 bg-black/50 px-2 py-2 text-sm text-gold focus:border-gold focus:outline-none [color-scheme:dark]"
              />
              <div className="flex gap-1">
                {(['food', 'activity', 'dessert'] as VenueType[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setAddStopVibe(v)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                      addStopVibe === v ? 'bg-gold text-black' : 'border border-gold/20 bg-black/40 text-ink-secondary'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddStop}
                disabled={savingStop || !addStopName.trim() || !addStopAddress.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold py-2.5 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
              >
                {savingStop ? 'Adding...' : 'Add Stop'}
              </button>
              <button
                onClick={() => setShowAddStop(false)}
                className="flex items-center justify-center rounded-lg border border-gold/30 px-4 py-2.5 text-sm text-ink-secondary transition-all active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
      </div>

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
                <p className="py-8 text-center text-sm text-ink-secondary">No saved venues found.</p>
              ) : (
                <div className="space-y-2">
                  {filteredVenues.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => handleAddSavedVenue(v)}
                      disabled={savingStop}
                      className="flex w-full items-center gap-3 rounded-xl border border-gold/20 bg-black/40 p-3 text-left transition-all hover:border-gold hover:bg-gold/5 active:scale-[0.98] disabled:opacity-50"
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
