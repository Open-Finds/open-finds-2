import { findVenueAddress } from './apiKeys';
import { extractVenuesFromLink, type ExtractedVenueItem } from './openai';
import { supabase, type SavedVenue, type VenueType } from './supabase';
import { APP_URL, copyToClipboard } from './invite';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type PublicVenue = { name: string; address: string; type: VenueType; link: string | null };

const nativeShare = registerPlugin<{
  send(options: { text: string }): Promise<void>;
  take(): Promise<{ text?: string }>;
  addListener(event: 'incoming', listener: () => void): Promise<{ remove(): Promise<void> }>;
}>('UnsavedShare');

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

export async function identifySharedVenue(input: string) {
  const link = sourceUrl(input);
  const candidates = await extractVenuesFromLink(link);
  const candidate = candidates.length === 1 ? candidates[0] : undefined;
  if (!candidate?.name.trim() || !candidate.address.trim()) return { candidates };
  const match = await findVenueAddress(candidate.name, candidate.address);
  const comparableAddress = (address: string) => address.toLowerCase()
    .replace(/,\s*australia$/i, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  if (!match || comparableAddress(candidate.address) !== comparableAddress(match.address)) return { candidates };
  const saved = await saveSharedVenue({ ...candidate, address: match.address, link }, link, match);
  return { saved, candidates };
}

export async function publishVenue(venue: SavedVenue): Promise<string> {
  const { data, error } = await supabase.rpc('publish_venue_recommendation', { p_venue_id: venue.id });
  if (error || typeof data !== 'string') throw error ?? new Error('No share link returned.');
  return APP_URL + '/v/' + data;
}

export async function readPublicVenue(id: string): Promise<PublicVenue | null> {
  const { data, error } = await supabase.rpc('read_venue_recommendation', { p_id: id });
  if (error) throw error;
  return data as PublicVenue | null;
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

export async function sendRecommendation(message: string, url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  const text = [message.trim(), url].filter(Boolean).join('\n');
  if (Capacitor.getPlatform() === 'android') {
    await nativeShare.send({ text });
    return 'shared';
  }
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  if (!await copyToClipboard(text)) throw new Error('Could not copy the recommendation.');
  return 'copied';
}

export async function listenToNativeShares(onText: (text: string) => void) {
  if (Capacitor.getPlatform() !== 'android') return;
  const drain = async () => {
    const { text } = await nativeShare.take();
    if (text) onText(text);
  };
  const listener = await nativeShare.addListener('incoming', () => { void drain().catch(console.error); });
  try {
    await drain();
    return listener;
  } catch (error) {
    await listener.remove();
    throw error;
  }
}

export type { ExtractedVenueItem };
