/**
 * Name-first step, for a post that names a venue but says nothing about where it is (no address, suburb or city).
 * Before this, the AI with web search guessed the place, and once picked a cafe in the USA for a bakery in the UK
 * ("Boulangerie de Saigon"). Google's own search, ranked near the phone, finds the right one, so it is asked first:
 *   - exactly one Google place with that name: the venue. The name came from the post, so it is confirmed.
 *   - several (a chain, or the same name in different cities): offered as choices; the user picks one.
 *   - none: null, and AI Save carries on as before (the AI with web search).
 * The account's handle is used only when the AI read no name at all, and its places are only ever offered, never
 * confirmed, because a handle is often the creator ("kei_eats"), not the venue.
 * One free-to-the-user Google search per attempt (rate-limited by resolve-place). No AI call.
 */
import { searchGooglePlaces, type GooglePlaceChoice } from './apiKeys';
import { quietLocation } from './geolocation';
import type { ExtractedVenueItem, VenueExtractionProgress } from './openai';
import type { SharedVenue } from './aiSave';

const key = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export type NameHint = { name: string; fromHandle: boolean };
export type NameHintResult = { venue: SharedVenue } | { choices: ExtractedVenueItem[] } | null;

/** "boulangeriedesaigon" or "@b_side.cafe" read as words Google understands. */
function handleWords(handle: string): string {
  return handle.replace(/^@+/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** What to search: the one venue name the AI read, else the account's handle. Null when there is nothing usable. */
export function nameHint(candidates: ExtractedVenueItem[], handle: string | null | undefined): NameHint | null {
  if (candidates.length > 1) return null; // several venues: the branch step handles lists.
  const name = candidates[0]?.name?.trim();
  if (name && key(name).length >= 4) return { name, fromHandle: false };
  const words = handle ? handleWords(handle) : '';
  return key(words).length >= 4 ? { name: words, fromHandle: true } : null;
}

/** A Google place is this venue when one name contains the other ("Boulangerie de Saigon" / "boulangeriedesaigon"). */
export function sameName(hint: string, place: GooglePlaceChoice): boolean {
  const a = key(hint);
  const b = key(place.name);
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}

export async function findByName(candidates: ExtractedVenueItem[], identification: VenueExtractionProgress | undefined,
  link: string, attemptId: string | undefined): Promise<NameHintResult> {
  const hint = nameHint(candidates, identification?.metadata?.handle);
  if (!hint) return null;
  const near = await quietLocation();
  const matches = (await searchGooglePlaces(hint.name, attemptId, near)).filter(place => sameName(hint.name, place));
  if (!matches.length) return null;
  const read = candidates[0];
  if (matches.length === 1 && !hint.fromHandle) {
    const [place] = matches;
    return { venue: {
      name: place.name, address: place.address, type: place.type ?? read?.type ?? 'food', link,
      lat: place.lat, lon: place.lon, tags: read?.tags ?? [], venueToken: place.venueToken,
    } };
  }
  return { choices: matches.map((place, index) => ({
    name: place.name, address: place.address, type: place.type ?? read?.type ?? 'food', order: index + 1, tags: read?.tags ?? [],
    lat: place.lat, lon: place.lon, venueToken: place.venueToken,
  })) };
}
