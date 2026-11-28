import { shareRecommendationOrigin } from './aiSave';

/** Small readers for the venue page. */

/** "12 Liverpool Rd, Ashfield NSW 2131, Australia" → "Ashfield, NSW". */
export function suburbOf(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter((p) => p && !/^australia$/i.test(p));
  const withState = [...parts].reverse().find((p) => /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/.test(p));
  if (withState) {
    const m = withState.replace(/\s*\d{4}\s*$/, '').match(/^(.*?)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)$/);
    if (m && m[1] && !/^\d/.test(m[1])) return `${m[1]}, ${m[2]}`;
  }
  return parts.length > 1 ? parts[parts.length - 1].replace(/\s*\d{4}\s*$/, '') : address;
}

/** Where a saved link came from, for "Originally spotted on …". */
export function sourceOf(url: string): { name: string; video: boolean } {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  if (/instagram\.com$/.test(host)) return { name: 'Instagram', video: true };
  if (/tiktok\.com$/.test(host)) return { name: 'TikTok', video: true };
  if (/youtube\.com$|youtu\.be$/.test(host)) return { name: 'YouTube', video: true };
  if (/facebook\.com$|fb\.watch$/.test(host)) return { name: 'Facebook', video: true };
  if (/google\.[a-z.]+$|goo\.gl$/.test(host) && /maps|goo\.gl/.test(url)) return { name: 'Google Maps', video: false };
  return { name: host || 'the web', video: false };
}

/**
 * The address anyone can open to see a venue's page, signed in or not. The
 * Android app's own address (https://localhost) means nothing to anyone else,
 * so the public website's address is used when one is set (the same one Quick
 * Share links use). /#/place/ because /#/venue/ is Quick Share's page.
 */
export const venuePageUrl = (id: string) => `${shareRecommendationOrigin() ?? window.location.origin}/#/place/${id}`;
