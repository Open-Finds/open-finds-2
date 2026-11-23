const defaultOrigin = 'https://www.theunsaved.app';
export const stagingSupabase = 'https://crpkzysdtnoomzimibhe.supabase.co';
export const stagingBranch = 'feature/ai-save-quick-share';
export const fallbackImage = '/icon-512.png';
const stagingPhoto = 'https://tb-static.uber.com/prod/image-proc/processed_images/0e733286e4a4d55d86d5eb6acaacb847/1651207c9cb2a7942b37b3f3e4a0b899.jpeg';

export function recommendationOrigin(staging, productionUrl, stagingUrl) {
  const value = staging ? stagingUrl : productionUrl || defaultOrigin;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash) return null;
    if (staging && (!url.hostname.includes('.') || /^(?:\d+\.){3}\d+$|\.(?:localhost|local|internal)$/i.test(url.hostname))) return null;
    if (staging && [productionUrl, defaultOrigin, 'https://theunsaved.app', 'https://open-finds-2.vercel.app']
      .some(origin => origin?.replace(/\/$/, '') === url.origin)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function validRecommendationId(id) {
  return typeof id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id);
}

export function recommendationPath(id, staging) {
  return (staging ? '/venue/' : '/v/') + id;
}

export function venuePhoto(staging, id, venue) {
  if (staging && id === '497dfa0b-29bf-446d-a272-f8a9211d53bd' &&
    /^gorilla smokers$/i.test(venue.name.trim()) && /^53 Hoskins Ave(?:nue)?\b/i.test(venue.address.trim()) &&
    /\bBankstown\b/i.test(venue.address)) return stagingPhoto;
  return null;
}

export function publicVenueLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
