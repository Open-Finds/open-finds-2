import { isGoogleMapsLink, verifyVenuePlaceDetailed, type GooglePlaceChoice } from './apiKeys';
import { edgeAuthHeaders } from './edgeAuth';
import { categoryOf } from './taxonomy';
import { extractVenuesFromLink, hasSourceAddress, mentionedInSource, type ExtractedVenueItem, type VenueExtractionProgress } from './openai';
import { supabase, updateSavedVenue, type SavedVenue, type VenueType } from './supabase';
import { shareOrCopy, shareTextOnly } from './invite';
import { ProviderUnavailableError, type ProviderReason } from './providerErrors';
import { attemptIdFor, forgetAttempt } from './attemptId';
import { recommendationOrigin, recommendationPath, stagingSupabase } from './publicRecommendation.js';

export type PublicVenue = { name: string; address: string; type: VenueType; link: string | null };

export { nativeShare, type AndroidShare } from './nativeShare';

export function sourceUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) {
    throw new Error('Share a valid HTTPS link.');
  }
  url.hash = '';
  const host = url.hostname.toLowerCase();
  if (host === 'instagram.com' || host.endsWith('.instagram.com') ||
      host === 'tiktok.com' || host.endsWith('.tiktok.com')) url.search = '';
  return url.href;
}

/**
 * Saves a Google place through save-verified-venue, which links the save to the shared venue record.
 * Null when that is not possible (no stamp, expired stamp, service down): the caller then saves it the usual way.
 */
async function saveVerifiedVenue(venue: SharedVenue, link: string): Promise<SavedVenue | null> {
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/save-verified-venue`, {
      method: 'POST',
      headers: await edgeAuthHeaders(),
      body: JSON.stringify({
        venueToken: venue.venueToken, name: venue.name, address: venue.address, type: venue.type, link,
        category: categoryOf({ type: venue.type, tags: venue.tags ?? [], name: venue.name }),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const row = await res.json().catch(() => null);
    return row && typeof row.id === 'string' ? row as SavedVenue : null;
  } catch {
    return null;
  }
}

export async function saveSharedVenue(venue: SharedVenue, link: string, position?: { lat: number; lon: number }): Promise<SavedVenue> {
  const { tags, venueToken, ...details } = venue;
  // A Google place with its stamp is saved linked to the shared venue; anything else, or any failure there,
  // is saved exactly as before (unlinked), so a venue is never lost.
  const linked = venueToken && !position ? await saveVerifiedVenue(venue, sourceUrl(link)) : null;
  const { data, error } = linked ? { data: linked, error: null } : await supabase.rpc('save_shared_venue', {
    p_venue: { name: details.name, address: details.address, type: details.type, lat: details.lat ?? null, lon: details.lon ?? null, ...position, link: sourceUrl(link) },
  });
  if (error || !data) throw error ?? new Error('Saving returned no venue.');
  // The save ends this AI Save attempt: the next intentional save of the link starts a new one.
  await forgetAttempt(sourceUrl(link));
  const row = data as SavedVenue;
  // The tags AI Save read (cuisine, dietary, category) are what make "dessert" or "pho" find this venue later.
  // They are added after the save; if that fails the venue is still saved.
  const have = new Set((row.tags ?? []).map(tag => tag.toLowerCase()));
  const missing = (tags ?? []).filter(tag => !have.has(tag.toLowerCase()));
  if (missing.length) {
    try {
      return await updateSavedVenue(row.id, { tags: [...(row.tags ?? []), ...missing] });
    } catch (cause) {
      console.warn('[ai-save] the venue was saved but its tags were not', cause);
    }
  }
  return row;
}

export type SharedVenue = PublicVenue & {
  lat?: number | null; lon?: number | null; tags?: string[]; venueToken?: string;
  /** false: Google found this place, but the post never names it (the AI found it elsewhere). Missing means named or unknown. */
  mentioned?: boolean;
};

export type SharedVenueProgress = {
  checkedSaved?: boolean;
  identification?: VenueExtractionProgress;
  candidates?: ExtractedVenueItem[];
  verified?: SharedVenue;
  /** Sent with every request of this attempt, so the server counts it once. Kept across retries and reopened dialogs. */
  attemptId?: string;
  /** The AI with web search has already been asked for this link, so it is not asked again. */
  searched?: boolean;
  /** A post that names several venues: each one, checked against Google. Kept so a reopened dialog does not check again. */
  rows?: VenueRow[];
};

/** One venue from a post that names several: the details to save, and whether Google confirmed them. */
export type VenueRow = {
  venue: SharedVenue; verified: boolean; /** false: the post never names this venue. */ mentioned?: boolean;
  /** Google's closest place when it did not confirm this venue. Offered as "Is this it?", never ticked for the user. */
  suggestion?: GooglePlaceChoice;
};

/**
 * A venue name the AI copied from an @handle ("connection_n_co.rosebery", "@b_side_cafe") reads to Google as words
 * ("connection n co rosebery"). Any other name is sent as it is.
 */
export function searchableName(name: string): string {
  const trimmed = name.trim();
  const handle = trimmed.startsWith('@') || (!/\s/.test(trimmed) && /[_.]/.test(trimmed));
  if (!handle) return trimmed;
  return trimmed.replace(/^@+/, '').replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim() || trimmed;
}

/** The most venues taken from one post. */
export const MAX_VENUES = 5;

/**
 * Checks each venue against Google at the same time. One that Google cannot match stays in the list as the AI read it,
 * unconfirmed, so nothing is lost. Only if every check fails is the failure reported (a service problem).
 */
async function verifyEach(items: ExtractedVenueItem[], link: string, attemptId: string | undefined, identification?: VenueExtractionProgress): Promise<VenueRow[]> {
  const read = (item: ExtractedVenueItem): SharedVenue =>
    ({ name: item.name, address: item.address, type: item.type, link, lat: null, lon: null, tags: item.tags });
  const settled = await Promise.allSettled(items.map(async (item): Promise<VenueRow> => {
    if (!item.address.trim()) return { venue: read(item), verified: false };
    const check = await verifyVenuePlaceDetailed({
      name: searchableName(item.name), address: item.address, outdoor: item.type === 'activity',
      addressFromSource: hasSourceAddress(identification, item.address),
    }, attemptId);
    const match = check.match;
    const mentioned = mentionedInSource(identification, item.name, match?.name ?? item.name);
    return match
      ? { venue: { ...read(item), name: match.name, address: match.address, type: match.type ?? item.type, lat: match.lat, lon: match.lon, venueToken: match.venueToken, ...(mentioned ? {} : { mentioned: false }) }, verified: true, ...(mentioned ? {} : { mentioned: false }) }
      : { venue: read(item), verified: false, ...(mentioned ? {} : { mentioned: false }), ...(check.candidates[0] ? { suggestion: check.candidates[0] } : {}) };
  }));
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failures.length === settled.length) throw failures[0].reason;
  return settled.map((result, index) => result.status === 'fulfilled' ? result.value : { venue: read(items[index]), verified: false });
}

/** The AI found at least one venue with something to look up: a street address or an area. */
function hasAddressEvidence(candidates: ExtractedVenueItem[]): boolean {
  return candidates.length > 0 && candidates.some(item => !!item.address?.trim());
}

function sameVenues(a: ExtractedVenueItem[], b: ExtractedVenueItem[]): boolean {
  return a.length === b.length && a.every((item, index) => item.name === b[index].name && item.address === b[index].address);
}

/**
 * Why AI Save stopped short of a verified venue.
 * - a ProviderReason: the service could not run or refused the call. This says
 *   nothing about the venue, so the screen must not call it unverified.
 * - 'needs_review': nothing was checked yet (several candidates, an ambiguous
 *   caption, or no usable address); the user has to confirm the details first.
 * - 'no_match': Google Places answered and did not match one exact venue.
 * No reason (older callers, other failures) keeps the previous generic wording.
 */
export type SharedVenueIssue = {
  stage: 'identify' | 'verify' | 'lookup';
  cause?: unknown;
  retryable: boolean;
  reason?: ProviderReason | 'needs_review' | 'no_match' | 'ambiguous';
  /** For 'testing_limit': how long until an attempt is available again. */
  retryAfterSeconds?: number;
  /** For 'no_match': the offered places are only Google's closest results, not name matches. */
  weak?: boolean;
};

export type SharedVenueResult = {
  candidates: ExtractedVenueItem[];
  /** Google places the user can choose from (Confirm the venue). Only ever Google results, never what the AI read. */
  choices?: ExtractedVenueItem[];
  saved?: SavedVenue;
  venue?: SharedVenue;
  /** A post that names several venues (up to MAX_VENUES), each checked against Google. */
  rows?: VenueRow[];
  issue?: SharedVenueIssue;
};

async function previouslySaved(link: string): Promise<SavedVenue | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in to save this venue.');
  const { data, error } = await supabase.from('saved_venues').select('*')
    .eq('user_id', session.user.id).eq('link', link).limit(2);
  if (error) throw error;
  return data?.length === 1 ? data[0] as SavedVenue : undefined;
}

export async function identifySharedVenue(input: string, progress: SharedVenueProgress = {}): Promise<SharedVenueResult> {
  let stage: SharedVenueIssue['stage'] = 'identify';
  let link: string | undefined;
  try {
    link = sourceUrl(input);
    const mapsLink = isGoogleMapsLink(link);
    if (!progress.checkedSaved) {
      // An exact-source hit is the current account's previous choice.
      stage = 'lookup';
      const saved = await previouslySaved(link);
      if (saved) {
        const { name, address, type, lat, lon, tags } = saved;
        return { saved, venue: { name, address, type, link, lat, lon, tags: tags ?? [] }, candidates: [] };
      }
      progress.checkedSaved = true;
    }
    stage = 'identify';
    progress.attemptId ??= await attemptIdFor(link);
    const url = link;
    // Cheapest first: the plain AI reads the evidence; the AI with web search runs only when needed.
    const identify = (search: boolean) => extractVenuesFromLink(url, {
      verifySeparately: true, progress: progress.identification, attemptId: progress.attemptId, search,
    });
    let readByAI = false;
    if (!mapsLink && !progress.candidates) {
      progress.identification ??= {};
      readByAI = true;
      progress.candidates = await identify(false);
      if (!hasAddressEvidence(progress.candidates)) {
        progress.searched = true;
        progress.candidates = await identify(true);
      }
    }
    // A post that names several venues: check each one, and let the user tick which to save.
    if (!mapsLink && !progress.verified && (progress.rows || (progress.candidates?.length ?? 0) > 1)) {
      stage = 'verify';
      progress.rows ??= await verifyEach((progress.candidates ?? []).slice(0, MAX_VENUES), url, progress.attemptId, progress.identification);
      return { rows: progress.rows, candidates: progress.candidates ?? [] };
    }
    if (!progress.verified) {
      stage = 'verify';
      let candidates = progress.candidates ?? [];
      for (;;) {
        if (!mapsLink && !candidates.length) {
          progress.candidates = undefined;
          return { candidates, issue: { stage: 'identify', retryable: true } };
        }
        const candidate = candidates.length === 1 ? candidates[0] : undefined;
        const details = mapsLink && !candidate ? { url: link } : candidate?.address && !candidate.requiresManualCorrection
          ? {
            name: candidate.name, address: candidate.address, outdoor: candidate.type === 'activity',
            addressFromSource: hasSourceAddress(progress.identification, candidate.address),
          } : null;
        if (!details) return { candidates, issue: { stage, retryable: false, reason: 'needs_review' } };
        const check = await verifyVenuePlaceDetailed(details, progress.attemptId);
        const match = check.match;
        if (!match) {
          // The plain AI named a venue Google cannot match: ask the AI with web search once, then check Google again.
          // Only for what the AI itself read in this call, never for details the user corrected.
          if (readByAI && !progress.searched && !mapsLink && (check.reason ?? 'no_match') === 'no_match') {
            progress.searched = true;
            stage = 'identify';
            const retry = await identify(true);
            stage = 'verify';
            if (hasAddressEvidence(retry) && !sameVenues(retry, candidates)) {
              candidates = retry;
              progress.candidates = retry;
              continue;
            }
          }
          // Google's places for this search are the choices to offer; nothing is saved from them automatically.
          const choices: ExtractedVenueItem[] = check.candidates.map((place, index) => ({
            name: place.name, address: place.address, type: place.type ?? candidate?.type ?? 'food',
            order: index + 1, tags: [], lat: place.lat, lon: place.lon, venueToken: place.venueToken,
          }));
          return {
            candidates: choices.length ? choices : candidates,
            choices,
            issue: { stage, retryable: false, reason: check.reason ?? 'no_match', ...(check.weak ? { weak: true } : {}) },
          };
        }
        // Google confirms the place exists; whether the post names it is a separate question.
        const mentioned = mentionedInSource(progress.identification, candidate?.name ?? match.name, match.name);
        progress.verified = {
          name: match.name, address: match.address, link,
          type: match.type ?? candidate?.type ?? 'activity', lat: match.lat, lon: match.lon, tags: candidate?.tags ?? [],
          venueToken: match.venueToken, ...(mentioned ? {} : { mentioned: false }),
        };
        progress.candidates ??= [{ ...progress.verified, order: 1, tags: [] }];
        break;
      }
    }
    return { venue: progress.verified, candidates: progress.candidates ?? [] };
  } catch (cause) {
    const candidates = progress.candidates ?? [];
    if (cause instanceof ProviderUnavailableError) {
      if (cause.reason === 'attempt_expired' || cause.reason === 'attempt_limit') {
        // The server will not take this id again, so the next try is a new attempt.
        progress.attemptId = undefined;
        if (link) await forgetAttempt(link);
      }
      // Retrying the identical request can never succeed once it was already seen.
      return {
        candidates,
        issue: { stage, cause, retryable: cause.reason !== 'duplicate', reason: cause.reason, retryAfterSeconds: cause.retryAfterSeconds },
      };
    }
    return { candidates, issue: { stage, cause, retryable: true } };
  }
}

export function shareRecommendationOrigin(): string | null {
  return recommendationOrigin(import.meta.env.VITE_SUPABASE_URL === stagingSupabase,
    import.meta.env.VITE_RECOMMENDATION_ORIGIN, import.meta.env.VITE_STAGING_RECOMMENDATION_ORIGIN);
}

/**
 * The public link for a venue. `unverified` adds a flag the public page reads to say Google has not confirmed the address;
 * the flag only changes a label, never what is shown about the venue.
 */
export async function publishVenue({ name, address, type, link }: PublicVenue, savedVenueId?: string, options: { unverified?: boolean } = {}): Promise<string> {
  const origin = shareRecommendationOrigin();
  if (!origin) throw new Error('Public recommendation URL is unavailable.');
  const { data, error } = savedVenueId
    ? await supabase.rpc('publish_venue_recommendation', { p_venue_id: savedVenueId })
    : await supabase.rpc('publish_standalone_venue_recommendation', { p_venue: { name, address, type, link } });
  if (error || typeof data !== 'string') throw error ?? new Error('No share link returned.');
  return origin + recommendationPath(data, import.meta.env.VITE_SUPABASE_URL === stagingSupabase) + (options.unverified ? '?u=1' : '');
}

export async function readPublicVenue(id: string): Promise<PublicVenue | null> {
  const { data, error } = await supabase.rpc('read_venue_recommendation', { p_id: id });
  if (error) throw error;
  if (!data) return null;
  const { name, address, type, link } = data;
  return { name, address, type, link };
}

export function guestSave(id: string, venue: PublicVenue): void {
  localStorage.setItem('unsaved:guest-venue:' + id, JSON.stringify(venue));
}

export function readGuestSave(id: string): PublicVenue | null {
  try {
    return JSON.parse(localStorage.getItem('unsaved:guest-venue:' + id) ?? 'null') as PublicVenue | null;
  } catch {
    return null;
  }
}

/** Step one of a Quick Share: the optional message, on its own. */
export function sendRecommendationMessage(message: string) {
  return shareTextOnly('Venue recommendation', message);
}

/** Step two: the link alone, so the other app shows it as a preview card instead of a long address. */
export function sendRecommendationLink(url: string, title = 'Venue recommendation') {
  return shareOrCopy(title, '', url);
}

export function sendRecommendation(message: string, url: string) {
  return shareOrCopy('Venue recommendation', message, url);
}

export type { ExtractedVenueItem };
