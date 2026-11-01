import { useEffect, useMemo, useState } from 'react';
import { routedTimes, validCoordinate, type Coordinate } from './travel';
import type { TravelMode } from './apiKeys';
import { venueKey, type PlannerVenue } from './planner';
import { edgeAuthHeaders } from './edgeAuth';
export function useTravelModes() {
  const [modes, setModes] = useState<TravelMode[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/travel-times`, { method: 'POST', headers: await edgeAuthHeaders(), body: JSON.stringify({ action: 'capabilities' }) });
        if (!response.ok) { if (live && response.status === 400) setModes(['driving']); return; }
        const data = await response.json();
        if (live && Array.isArray(data.modes)) setModes(data.modes.filter((m: TravelMode) => ['driving', 'walking', 'transit'].includes(m)));
      } catch { /* A failed capability check leaves every mode unavailable; never guess a mode. */ }
    })();
    return () => { live = false; };
  }, []);
  return modes;
}
export function useDiscoveryTravel(scope: string, origin: Coordinate | null, venues: PlannerVenue[], mode: TravelMode | null) {
  const signature = JSON.stringify([...venues].sort((a, b) => venueKey(a).localeCompare(venueKey(b))).slice(0, 50).map((v) => [venueKey(v), v.address, v.lat, v.lon]));
  const originKey = validCoordinate(origin) ? `${origin.lat},${origin.lon}` : '';
  const requestKey = `${scope}|${originKey}|${mode}|${signature}`;
  const [state, setState] = useState<{ key: string; busy: boolean; seconds: Record<string, number>; coords: Record<string, Coordinate> }>({ key: '', busy: false, seconds: {}, coords: {} });
  useEffect(() => {
    if (!originKey || !mode) return;
    let live = true;
    const [lat, lon] = originKey.split(',').map(Number);
    const candidates = JSON.parse(signature) as [string, string, number | null, number | null][];
    setState({ key: requestKey, busy: true, seconds: {}, coords: {} });
    const timer = setTimeout(() => {
      routedTimes(scope, { lat, lon }, candidates.map(([, address, lat, lon]) => ({ address, lat, lon })), mode).then((results) => {
        if (!live) return;
        const seconds: Record<string, number> = {}, coords: Record<string, Coordinate> = {};
        results.forEach((r, i) => {
          if (typeof r?.durationSeconds === 'number' && !r.error) seconds[candidates[i][0]] = r.durationSeconds;
          if (r?.lat != null && r.lon != null && validCoordinate({ lat: r.lat, lon: r.lon })) coords[candidates[i][0]] = { lat: r.lat, lon: r.lon };
        });
        setState({ key: requestKey, busy: false, seconds, coords });
      }, () => { if (live) setState({ key: requestKey, busy: false, seconds: {}, coords: {} }); });
    }, 650);
    return () => { live = false; clearTimeout(timer); };
  }, [scope, mode, originKey, signature, requestKey]);
  return state.key === requestKey ? state : { key: requestKey, busy: !!originKey && !!mode, seconds: {}, coords: {} };
}
export function useItineraryTravel(scope: string, stops: PlannerVenue[], mode: TravelMode | null) {
  const signature = JSON.stringify(stops.map((s) => [venueKey(s), s.address, s.lat, s.lon]));
  const key = `${scope}|${mode}|${signature}`;
  const [state, setState] = useState<{ key: string; busy: boolean; legs: (number | null)[] }>({ key: '', busy: false, legs: [] });
  useEffect(() => {
    if (!mode) return;
    let live = true;
    const items = JSON.parse(signature) as [string, string, number | null, number | null][];
    setState({ key, busy: items.length > 1, legs: [] });
    const timer = setTimeout(async () => {
      const legs: (number | null)[] = [];
      // At most five one-element requests after a stable reorder, using the same TTL cache.
      for (let i = 1; i < items.length; i++) {
        if (!live) return;
        const [, fromAddress, lat, lon] = items[i - 1];
        const [, address, nextLat, nextLon] = items[i];
        const origin = lat != null && lon != null && validCoordinate({ lat, lon }) ? { lat, lon } : fromAddress;
        try { const [r] = await routedTimes(scope, origin, [{ address, lat: nextLat, lon: nextLon }], mode); legs.push(r?.durationSeconds ?? null); }
        catch { legs.push(null); }
      }
      if (live) setState({ key, busy: false, legs });
    }, 800);
    return () => { live = false; clearTimeout(timer); };
  }, [scope, mode, signature, key]);
  return useMemo(() => state.key === key ? state : { key, busy: !!mode && stops.length > 1, legs: [] }, [state, key, stops.length, mode]);
}
