import { useEffect, useState, useRef } from 'react';
import { navigate } from '../lib/router';
import {
  supabase,
  createPlan,
  fetchSavedVenues,
  getUserId,
  updateSavedVenueCoords,
  type SavedVenue,
  type VenueType,
} from '../lib/supabase';
import {
  ChevronRight,
  UtensilsCrossed,
  Target,
  Cake,
  Plus,
  ExternalLink,
  ChevronRight as Chevron,
  Clock,
  Shuffle,
  LocateFixed,
  Loader2,
  MapPin,
} from 'lucide-react';
import { BackButton } from '../components/Shared';
import {
  fetchDistanceMatrix,
  type VenueDistance,
  type DestinationInput,
  type OriginInput,
} from '../lib/apiKeys';

const TYPES = [
  { key: 'food', label: 'Food', icon: UtensilsCrossed },
  { key: 'activity', label: 'Activity', icon: Target },
  { key: 'dessert', label: 'Dessert', icon: Cake },
] as const;

const TYPE_ICON: Record<VenueType, typeof UtensilsCrossed> = {
  food: UtensilsCrossed,
  activity: Target,
  dessert: Cake,
};

type PickedVenue = {
  name: string;
  address: string;
  type: VenueType;
  link: string | null;
};

export function PlanBuilderPage() {
  const [selected, setSelected] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [originCoord, setOriginCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVenues, setSavedVenues] = useState<SavedVenue[]>([]);
  const [venuesError, setVenuesError] = useState(false);
  const [picked, setPicked] = useState<PickedVenue[]>([]);
  const [maxTravelMin, setMaxTravelMin] = useState(30);
  const [distances, setDistances] = useState<Record<string, VenueDistance>>({});
  const [distancesLoading, setDistancesLoading] = useState(false);
  const [distancesError, setDistancesError] = useState(false);
  const fetchSeq = useRef(0);

  const title = sessionStorage.getItem('draft_title') ?? '';
  const date = sessionStorage.getItem('draft_date') ?? '';

  useEffect(() => {
    fetchSavedVenues(3)
      .then(setSavedVenues)
      .catch(() => setVenuesError(true));
  }, []);

  // The effective origin for the edge function: GPS coordinates if
  // available, otherwise the typed address string.
  const effectiveOrigin: OriginInput | null = originCoord ?? (location.trim() || null);

  // Fetch driving times when origin or venues change.
  useEffect(() => {
    if (!effectiveOrigin || savedVenues.length === 0) {
      setDistances({});
      return;
    }
    const seq = ++fetchSeq.current;
    setDistancesLoading(true);
    setDistancesError(false);
    const dests: DestinationInput[] = savedVenues.map((v) =>
      v.lat != null && v.lon != null
        ? { address: v.address, lat: v.lat, lon: v.lon }
        : v.address
    );
    fetchDistanceMatrix(effectiveOrigin, dests)
      .then((results) => {
        if (seq !== fetchSeq.current) return;
        if (!results) {
          setDistancesError(true);
          setDistances({});
          return;
        }
        const map: Record<string, VenueDistance> = {};
        savedVenues.forEach((v, i) => {
          map[`${v.name}|${v.address}`] = {
            ...(results[i] ?? {
              venueKey: '',
              durationSeconds: null,
              durationText: null,
              error: true,
            }),
            venueKey: `${v.name}|${v.address}`,
          };
        });
        setDistances(map);

        // Persist any newly-geocoded coordinates back to saved_venues
        savedVenues.forEach((v, i) => {
          if (v.lat == null || v.lon == null) {
            const r = results[i];
            if (r?.lat != null && r?.lon != null) {
              updateSavedVenueCoords(v.id, r.lat, r.lon).catch(() => {});
            }
          }
        });
      })
      .catch(() => {
        if (seq !== fetchSeq.current) return;
        setDistancesError(true);
        setDistances({});
      })
      .finally(() => {
        if (seq !== fetchSeq.current) return;
        setDistancesLoading(false);
      });
  }, [effectiveOrigin, savedVenues]);

  const venueKey = (v: SavedVenue) => `${v.name}|${v.address}`;

  const filteredVenues = savedVenues.filter((v) => {
    // If the Distance Matrix API failed entirely, show all venues as fallback.
    if (distancesError) return true;
    const d = distances[venueKey(v)];
    // Strictly enforce the travel time filter; exclude venues with missing/failed data.
    if (!d || d.durationSeconds == null || d.error) return false;
    return d.durationSeconds / 60 <= maxTravelMin;
  });

  if (!title || !date) {
    return (
      <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-20 pt-10">
        <p className="text-ink-secondary">Start by creating a plan first.</p>
        <button
          onClick={() => navigate('/create')}
          className="btn-primary mt-4 w-full"
        >
          Create a plan
        </button>
      </div>
    );
  }

  const toggleType = (key: string) => {
    setSelected((prev) =>
      prev.includes(key)
        ? prev.filter((t) => t !== key)
        : prev.length < 3
          ? [...prev, key]
          : prev
    );
  };

  const pickVenue = (v: SavedVenue) => {
    const venue: PickedVenue = {
      name: v.name,
      address: v.address,
      type: v.type,
      link: v.link,
    };
    setPicked((prev) =>
      prev.some((p) => p.name === venue.name && p.address === venue.address)
        ? prev
        : [...prev, venue]
    );
    if (!location.trim() && !originCoord) setLocation(v.address);
    if (!selected.includes(v.type) && selected.length < 3) {
      setSelected((prev) => [...prev, v.type]);
    }
  };

  const removePicked = (idx: number) => {
    setPicked((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSurprise = () => {
    if (!effectiveOrigin || selected.length === 0) return;
    const wanted = new Set(selected);
    const byType: Record<string, SavedVenue[]> = {};
    filteredVenues.forEach((v) => {
      if (wanted.has(v.type)) {
        (byType[v.type] ??= []).push(v);
      }
    });
    const picks: PickedVenue[] = [];
    for (const t of selected) {
      const pool = byType[t];
      if (!pool || pool.length === 0) continue;
      const choice = pool[Math.floor(Math.random() * pool.length)];
      picks.push({
        name: choice.name,
        address: choice.address,
        type: choice.type as VenueType,
        link: choice.link,
      });
    }
    if (picks.length === 0) {
      setError(
        `No saved venues match your vibes within ${maxTravelMin} min drive.`
      );
      return;
    }
    setError(null);
    setPicked(picks);
  };

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

  const canSubmit =
    (selected.length >= 1 && selected.length <= 3) ||
    picked.length > 0;

  const handleCurate = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      // createPlan() stamps owner_id for signed-in users, which a raw insert
      // here would skip — leaving the plan device-scoped forever.
      const userId = getUserId();
      const created = await createPlan({
        title,
        date,
        host_name: 'You',
        location: location.trim() || (originCoord ? `GPS: ${originCoord.lat.toFixed(4)}, ${originCoord.lon.toFixed(4)}` : null),
        type: selected.join(',') || picked.map((p) => p.type).join(','),
        status: 'active',
      });
      await supabase
        .from('plans')
        .update({ share_link: `/plan/${created.id}` })
        .eq('id', created.id);

      // Build stops: picked venues first, then placeholders for remaining types
      const stops: {
        plan_id: string;
        name: string;
        address: string;
        time: string;
        vibe_link: string | null;
        sort_order: number;
        user_id: string;
      }[] = [];
      let order = 1;
      const usedTypes = new Set<VenueType>();

      for (const p of picked) {
        stops.push({
          plan_id: created.id,
          name: p.name,
          address: p.address,
          time: defaultTimeForType(p.type, order),
          vibe_link: p.link,
          sort_order: order++,
          user_id: userId,
        });
        usedTypes.add(p.type);
      }

      for (const t of selected) {
        if (usedTypes.has(t as VenueType)) continue;
        stops.push({
          plan_id: created.id,
          name: defaultNameForType(t),
          address: location.trim() || (originCoord ? 'Your location' : 'TBD'),
          time: defaultTimeForType(t, order),
          vibe_link: null,
          sort_order: order++,
          user_id: userId,
        });
      }

      if (stops.length > 0) {
        const { error: stopErr } = await supabase.from('stops').insert(stops);
        if (stopErr) throw stopErr;
      }

      sessionStorage.removeItem('draft_title');
      sessionStorage.removeItem('draft_date');
      navigate(`/plan/${created.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen overflow-y-auto px-6 pb-44 pt-10">
      <BackButton to="/create" />

      <h1 className="text-2xl font-bold">Build your plan</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        Pick 1–3 vibes to build your night. Add a location or saved venues — either works.
      </p>

      <div className="mt-8">
        <label className="mb-3 block text-sm font-medium text-ink-secondary">
          What's the vibe? (pick 1–3)
        </label>
        <div className="grid grid-cols-3 gap-3">
          {TYPES.map((t) => {
            const active = selected.includes(t.key);
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => toggleType(t.key)}
                className={`touch-target flex flex-col items-center justify-center gap-1 rounded-card border px-2 py-4 text-sm font-medium transition-all duration-200 active:scale-[0.98] ${
                  active
                    ? 'border-gold bg-gold/10 text-gold shadow-gold-glow'
                    : 'border-gold/20 bg-surface text-ink-secondary'
                }`}
              >
                <Icon size={20} />
                {t.label}
              </button>
            );
          })}
        </div>
        {selected.length > 0 && location.trim() && (
          <button
            onClick={handleSurprise}
            disabled={distancesLoading || savedVenues.length === 0}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-card border border-gold/30 bg-gold/5 py-3 text-sm font-semibold text-gold transition-all active:scale-[0.98] hover:bg-gold/15 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Shuffle size={16} />
            {savedVenues.length === 0
              ? 'Save venues to use Surprise Me'
              : distancesLoading
                ? 'Calculating...'
                : 'Surprise Me'}
          </button>
        )}
      </div>

      {/* Saved venues quick-select */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-secondary">
            or pick from saved venues
          </h2>
          <button
            onClick={() => navigate('/saved')}
            className="inline-flex items-center text-xs font-medium text-gold transition-colors hover:text-gold-light"
          >
            See all <Chevron size={14} />
          </button>
        </div>
        {savedVenues.length === 0 ? (
          venuesError ? (
            <p className="card px-4 py-3 text-center text-sm text-ink-secondary">
              Couldn't load saved venues. Try again in a moment.
            </p>
          ) : (
            <button
              onClick={() => navigate('/saved')}
              className="card flex w-full items-center justify-center gap-2 text-sm text-ink-secondary transition-colors hover:text-gold"
            >
              <Plus size={16} /> Add from Saved
            </button>
          )
        ) : (
          <>
            {location.trim() && (
              <div className="mb-3 rounded-card border border-gold/20 bg-[#111] p-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-widest text-gold/70">
                    Max driving time
                  </label>
                  <span className="text-sm font-bold text-gold">
                    {maxTravelMin} min
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={60}
                  step={5}
                  value={maxTravelMin}
                  onChange={(e) => setMaxTravelMin(Number(e.target.value))}
                  className="mt-3 w-full accent-gold"
                />
                {distancesLoading && (
                  <p className="mt-2 text-xs text-ink-secondary">
                    Calculating driving times...
                  </p>
                )}
                {distancesError && !distancesLoading && (
                  <p className="mt-2 text-xs text-ink-secondary">
                    Couldn't load driving times — showing all venues.
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 gap-2">
              {filteredVenues.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-ink-secondary">
                  No saved venues within {maxTravelMin} min drive.
                </p>
              ) : (
                filteredVenues.map((v) => {
                  const Icon = TYPE_ICON[v.type as VenueType] ?? UtensilsCrossed;
                  const isPicked = picked.some(
                    (p) => p.name === v.name && p.address === v.address
                  );
                  const d = distances[venueKey(v)];
                  return (
                    <button
                      key={v.id}
                      onClick={() => pickVenue(v)}
                      className={`card flex items-center gap-3 py-3 text-left transition-all active:scale-[0.98] ${
                        isPicked
                          ? 'border-gold bg-gold/10 shadow-gold-glow'
                          : 'hover:border-gold/40'
                      }`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gold/30 bg-black/40 text-gold">
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {v.name}
                        </p>
                        <p className="truncate text-xs text-ink-secondary">
                          {v.address}
                        </p>
                        {d?.durationText && !d.error && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-secondary/70">
                            <Clock size={11} /> {d.durationText} away
                          </p>
                        )}
                      </div>
                      {v.link && (
                        <ExternalLink size={14} className="shrink-0 text-gold/60" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>

      {/* Picked venues as stop slots */}
      {picked.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-medium text-ink-secondary">
            Stops from saved venues
          </h2>
          <div className="space-y-2">
            {picked.map((p, i) => (
              <div
                key={`${p.name}-${i}`}
                className="card flex items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">
                    {p.name}
                  </p>
                  <p className="truncate text-xs text-ink-secondary">
                    {p.address}
                  </p>
                </div>
                <button
                  onClick={() => removePicked(i)}
                  className="text-xs text-danger transition-colors hover:text-danger/80"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <label className="mb-2 block text-sm font-medium text-ink-secondary">
          Where from? <span className="text-ink-secondary/60">(optional)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              if (e.target.value.trim()) setOriginCoord(null);
            }}
            placeholder={originCoord ? 'Using your location' : 'Suburb or postcode'}
            className={`flex-1 touch-target rounded-card border bg-surface px-4 text-white placeholder-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow ${
              originCoord ? 'border-gold/50' : 'border-gold/20'
            }`}
          />
          <button
            onClick={handleUseMyLocation}
            disabled={locating}
            aria-label="Use my location"
            className={`flex shrink-0 items-center justify-center gap-2 rounded-card border px-4 py-3 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 ${
              originCoord
                ? 'border-gold bg-gold/15 text-gold'
                : 'border-gold/30 bg-surface text-gold hover:bg-gold/10'
            }`}
          >
            {locating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <LocateFixed size={18} />
            )}
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
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger/15 px-4 py-4 text-sm font-medium text-danger">
          <p className="font-semibold">Couldn't create your plan</p>
          <p className="mt-1 text-danger/80">{error}</p>
          <p className="mt-2 text-xs text-danger/60">Check your connection and try again.</p>
        </div>
      )}

      <div className="fixed bottom-24 left-1/2 z-50 flex w-full max-w-2xl -translate-x-1/2 justify-center px-6 lg:bottom-8 lg:left-auto lg:right-8 lg:translate-x-0">
        <button
          onClick={handleCurate}
          disabled={!canSubmit || submitting}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-card px-6 py-3.5 text-base font-bold shadow-gold-glow transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500 disabled:shadow-none bg-gold text-black"
        >
          {submitting ? 'Curating...' : 'Curate a Date'}{' '}
          {!submitting && <ChevronRight size={20} />}
        </button>
      </div>
    </div>
  );
}

function defaultTimeForType(type: string, order: number): string {
  if (type === 'food') return '7:00pm';
  if (type === 'activity') return '8:30pm';
  if (type === 'dessert') return '10:00pm';
  return `${6 + order}:00pm`;
}

function defaultNameForType(type: string): string {
  if (type === 'food') return 'Dinner spot';
  if (type === 'activity') return 'Activity';
  if (type === 'dessert') return 'Dessert bar';
  return 'Stop';
}
