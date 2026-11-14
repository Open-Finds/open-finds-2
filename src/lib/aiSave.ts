import { isGoogleMapsLink, verifyVenuePlace } from './apiKeys';
import { extractVenuesFromLink, hasSourceAddress, type ExtractedVenueItem, type VenueExtractionProgress } from './openai';
import { supabase, type SavedVenue, type VenueType } from './supabase';
import { shareOrCopy } from './invite';
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

export async function saveSharedVenue(venue: PublicVenue, link: string, position?: { lat: number; lon: number }): Promise<SavedVenue> {
  const { data, error } = await supabase.rpc('save_shared_venue', {
    p_venue: { ...venue, ...position, link: sourceUrl(link) },
  });
  if (error || !data) throw error ?? new Error('Saving returned no venue.');
  return data as SavedVenue;
}

export type SharedVenue = PublicVenue & { lat?: number | null; lon?: number | null; tags?: string[] };

export type SharedVenueProgress = {
  checkedSaved?: boolean;
  identification?: VenueExtractionProgress;
  candidates?: ExtractedVenueItem[];
  verified?: SharedVenue;
};

export type SharedVenueResult = {
  candidates: ExtractedVenueItem[];
  saved?: SavedVenue;
  venue?: SharedVenue;
  issue?: { stage: 'identify' | 'verify' | 'lookup'; cause?: unknown; retryable: boolean };
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
  let stage: NonNullable<SharedVenueResult['issue']>['stage'] = 'identify';
  try {
    const link = sourceUrl(input);
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
    if (!mapsLink && !progress.candidates) {
      progress.identification ??= {};
      progress.candidates = await extractVenuesFromLink(link, { verifySeparately: true, progress: progress.identification });
    }
    if (!progress.verified) {
      stage = 'verify';
      const candidates = progress.candidates ?? [];
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
      const match = details ? await verifyVenuePlace(details) : null;
      if (!match) return { candidates, issue: { stage, retryable: false } };
      progress.verified = {
        name: match.name, address: match.address, link,
        type: match.type ?? candidate?.type ?? 'activity', lat: match.lat, lon: match.lon, tags: candidate?.tags ?? [],
      };
      progress.candidates ??= [{ ...progress.verified, order: 1, tags: [] }];
    }
    return { venue: progress.verified, candidates: progress.candidates ?? [] };
  } catch (cause) {
    return { candidates: progress.candidates ?? [], issue: { stage, cause, retryable: true } };
  }
}

export function shareRecommendationOrigin(): string | null {
  return recommendationOrigin(import.meta.env.VITE_SUPABASE_URL === stagingSupabase,
    import.meta.env.VITE_RECOMMENDATION_ORIGIN, import.meta.env.VITE_STAGING_RECOMMENDATION_ORIGIN);
}

export async function publishVenue({ name, address, type, link }: PublicVenue, savedVenueId?: string): Promise<string> {
  const origin = shareRecommendationOrigin();
  if (!origin) throw new Error('Public recommendation URL is unavailable.');
  const { data, error } = savedVenueId
    ? await supabase.rpc('publish_venue_recommendation', { p_venue_id: savedVenueId })
    : await supabase.rpc('publish_standalone_venue_recommendation', { p_venue: { name, address, type, link } });
  if (error || typeof data !== 'string') throw error ?? new Error('No share link returned.');
  return origin + recommendationPath(data, import.meta.env.VITE_SUPABASE_URL === stagingSupabase);
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

export function sendRecommendation(message: string, url: string) {
  return shareOrCopy('Venue recommendation', message, url);
}

export type { ExtractedVenueItem };
