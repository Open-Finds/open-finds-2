import { fetchDistanceMatrix, type DestinationInput, type OriginInput, type TravelMode, type VenueDistance } from './apiKeys';
export const TRAVEL_MINUTES = [10, 20, 30, 40, 50, 60] as const;
export const MODE_LABELS = { driving: 'drive', walking: 'walk', transit: 'by public transport' };
export type Coordinate = { lat: number; lon: number };
export function validCoordinate(p: Coordinate | null | undefined): p is Coordinate {
  return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}
export function journeyLabel(seconds: number, mode: TravelMode): string {
  return `${Math.max(1, Math.ceil(seconds / 60))} min ${MODE_LABELS[mode]}`;
}
type Entry = { expires: number; result: VenueDistance };
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<VenueDistance[] | null>>();
// Account-scoped, in-memory only: never persist location or route responses.
const keyFor = (scope: string, origin: OriginInput, mode: TravelMode, destination: DestinationInput) => JSON.stringify([scope, origin, mode, destination]);
export function clearTravelCache(): void { cache.clear(); pending.clear(); }
export async function routedTimes(scope: string, origin: OriginInput, destinations: DestinationInput[], mode: TravelMode): Promise<(VenueDistance | null)[]> {
  if (typeof origin === 'string' ? !origin.trim() : !validCoordinate(origin)) return destinations.map(() => null);
  const now = Date.now();
  const keys = destinations.map((d) => keyFor(scope, origin, mode, d));
  const missing = destinations.map((d, i) => ({ d, i })).filter(({ i }) => (cache.get(keys[i])?.expires ?? 0) <= now);
  // Batch 25 elements, bounded callers cap discovery at 50; slider thresholds are not part of this key.
  for (let offset = 0; offset < missing.length; offset += 25) {
    const batch = missing.slice(offset, offset + 25);
    const requestKey = JSON.stringify(batch.map(({ i }) => keys[i]));
    let request = pending.get(requestKey);
    if (!request) {
      request = fetchDistanceMatrix(origin, batch.map(({ d }) => d), mode, typeof origin === 'string');
      pending.set(requestKey, request);
    }
    try {
      const values = await request;
      batch.forEach(({ i }, n) => {
        const value = values?.[n];
        const result = value && typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds >= 0 && !value.error ? value : { venueKey: '', durationSeconds: null, durationText: null, error: true };
        cache.set(keys[i], { result, expires: Date.now() + (result.error ? 30_000 : 300_000) });
      });
    } finally { pending.delete(requestKey); }
  }
  while (cache.size > 500) cache.delete(cache.keys().next().value!);
  return keys.map((k) => cache.get(k)?.result ?? null);
}
