import { edgeAuthHeaders } from './edgeAuth';
import { venueKey, type PlannerVenue } from './planner';
import { validCoordinate, type Coordinate } from './travel';
export function providerCategories(types: string[]): PlannerVenue['category'][] {
  const categories: PlannerVenue['category'][] = [];
  if (types.some((t) => /restaurant|food|cafe/.test(t))) categories.push('food');
  if (types.some((t) => /bakery|dessert|ice_cream/.test(t))) categories.push('dessert');
  if (types.some((t) => ['bar', 'pub', 'wine_bar'].includes(t))) categories.push('bar');
  if (types.some((t) => ['night_club', 'live_music_venue', 'concert_hall'].includes(t))) categories.push('nightlife');
  if (types.some((t) => ['park', 'national_park', 'hiking_area', 'beach', 'campground'].includes(t))) categories.push('outdoors');
  if (!categories.length || types.some((t) => ['bowling_alley', 'amusement_center', 'escape_room', 'movie_theater'].includes(t))) categories.push('activity');
  return categories;
}
export function newProviderVenues(records: unknown[], saved: PlannerVenue[]): PlannerVenue[] {
  const seen = new Set(saved.map(venueKey));
  const ids = new Set(saved.flatMap((v) => [v.providerId ?? '', ...v.tags.filter((t) => t.startsWith('google-place:')).map((t) => t.slice(13))]));
  return records.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const v = raw as { id?: string; name?: string; address?: string; lat?: number; lon?: number; types?: string[]; attributions?: { provider?: string; providerUri?: string }[] };
    if (!v.id || !/^[\w-]{1,200}$/.test(v.id) || !v.name?.trim() || !v.address?.trim() || !validCoordinate(v as Coordinate) || ids.has(v.id)) return [];
    const categories = providerCategories(Array.isArray(v.types) ? v.types : []);
    const venue: PlannerVenue = { id: `google:${v.id}`, providerId: v.id, name: v.name, address: v.address, lat: v.lat!, lon: v.lon!, category: categories[0],
      tags: [...categories.map((c) => `category:${c}`), `google-place:${v.id}`], attributions: Array.isArray(v.attributions) ? v.attributions.filter((a) => typeof a.provider === 'string').map((a) => ({ provider: a.provider!, url: a.providerUri?.startsWith('https://') ? a.providerUri : undefined })) : [], source: 'external', entityKind: 'venue', link: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.name)}&query_place_id=${encodeURIComponent(v.id)}` };
    if (seen.has(venueKey(venue))) return [];
    ids.add(v.id); seen.add(venueKey(venue)); return [venue];
  });
}
export async function discoverVenues(query: string, origin: Coordinate, saved: PlannerVenue[]): Promise<PlannerVenue[]> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/discover-venues`, { method: 'POST', headers: await edgeAuthHeaders(), body: JSON.stringify({ query: query.slice(0, 400), origin }) });
  if (!response.ok) throw new Error('AI Finds external discovery is unavailable. The Places-search function and provider access must be enabled on this backend. Your itinerary is kept.');
  const data = await response.json();
  if (!Array.isArray(data.venues)) throw new Error('External discovery returned no verified venue records.');
  return newProviderVenues(data.venues, saved);
}
