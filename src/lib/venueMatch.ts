import type { SavedVenue } from './supabase';

/**
 * Duplicate detection for saved venues.
 *
 * Users paste a reel, forget they saved the place six weeks ago, and paste it
 * again. Nothing here blocks that — two branches of the same chain are a
 * legitimate reason to have "the same" venue twice — it surfaces the likely
 * match so they can compare and decide.
 *
 * Matching is deliberately forgiving on the inputs that vary between sources
 * (punctuation, "&" vs "and", "St" vs "Street", tracking params on links) and
 * strict on what it concludes: a match needs either an exact normalised name,
 * address, or link, or a strong name overlap backed by a shared suburb.
 */

export type MatchReason = 'link' | 'name' | 'address' | 'location' | 'similar-name';

export type VenueMatch = {
  venue: SavedVenue;
  reason: MatchReason;
  /** 1 = certainly the same place; lower = worth a look. */
  confidence: number;
};

export type VenueCandidate = {
  name: string;
  address: string;
  link?: string | null;
  lat?: number | null;
  lon?: number | null;
};

const STREET_ABBREVIATIONS: Record<string, string> = {
  st: 'street', rd: 'road', ave: 'avenue', av: 'avenue', pde: 'parade',
  hwy: 'highway', pl: 'place', ln: 'lane', dr: 'drive', ct: 'court',
  cres: 'crescent', tce: 'terrace', blvd: 'boulevard', esp: 'esplanade',
};

const NAME_NOISE = new Set(['the', 'a', 'an', 'restaurant', 'cafe', 'bar', 'bistro', 'kitchen', 'co', 'and']);

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function normalizeName(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens that actually identify the place — "the", "cafe", "and" carry nothing. */
export function nameTokens(raw: string): string[] {
  return normalizeName(raw).split(' ').filter((t) => t.length >= 2 && !NAME_NOISE.has(t));
}

export function normalizeAddress(raw: string): string {
  return stripDiacritics(raw)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => STREET_ABBREVIATIONS[t] ?? t)
    .join(' ');
}

/**
 * "55 gertrude street" from "55 Gertrude St, Fitzroy VIC 3065" — the part of
 * an address that pins a building, without the suburb/state/postcode noise
 * that different sources format differently.
 */
export function streetKey(raw: string): string | null {
  const norm = normalizeAddress(raw);
  const m = norm.match(/^(\d+[a-z]?)(?:\s*[-/]\s*\d+[a-z]?)?\s+([a-z]+(?:\s+[a-z]+)?)/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

export function normalizeLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '').toLowerCase();
    return `${host}${path}`;
  } catch {
    return raw.trim().toLowerCase() || null;
  }
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Great-circle distance in metres; good enough at venue scale. */
function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Last alphabetic token of an address that isn't a state code — usually the suburb. */
function suburbToken(raw: string): string | null {
  const tokens = normalizeAddress(raw).split(' ').filter((t) => /^[a-z]+$/.test(t));
  const states = new Set(['vic', 'nsw', 'qld', 'wa', 'sa', 'tas', 'act', 'nt', 'australia']);
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (!states.has(tokens[i]) && !(tokens[i] in STREET_ABBREVIATIONS) && !Object.values(STREET_ABBREVIATIONS).includes(tokens[i])) {
      return tokens[i];
    }
  }
  return null;
}

/**
 * Finds saved venues that are probably the same place as `candidate`.
 * Sorted most-confident first; a venue appears at most once.
 */
export function findSimilarVenues(candidate: VenueCandidate, existing: SavedVenue[]): VenueMatch[] {
  const cName = normalizeName(candidate.name);
  const cTokens = nameTokens(candidate.name);
  const cStreet = streetKey(candidate.address);
  const cAddr = normalizeAddress(candidate.address);
  const cLink = normalizeLink(candidate.link);
  const cSuburb = suburbToken(candidate.address);
  const hasCoords = candidate.lat != null && candidate.lon != null;

  const out: VenueMatch[] = [];

  for (const v of existing) {
    let best: VenueMatch | null = null;
    const consider = (reason: MatchReason, confidence: number) => {
      if (!best || confidence > best.confidence) best = { venue: v, reason, confidence };
    };

    if (cLink && normalizeLink(v.link) === cLink) consider('link', 1);

    const vName = normalizeName(v.name);
    if (cName && vName === cName) consider('name', 0.95);

    const vStreet = streetKey(v.address);
    if (cStreet && vStreet && cStreet === vStreet) consider('address', 0.9);
    else if (cAddr && normalizeAddress(v.address) === cAddr) consider('address', 0.9);

    if (hasCoords && v.lat != null && v.lon != null) {
      const d = metresBetween(candidate.lat!, candidate.lon!, v.lat, v.lon);
      if (d <= 40) consider('location', 0.9);
      else if (d <= 150 && jaccard(cTokens, nameTokens(v.name)) >= 0.4) consider('location', 0.8);
    }

    if (!best) {
      const vTokens = nameTokens(v.name);
      const overlap = jaccard(cTokens, vTokens);
      const contains =
        cTokens.length >= 2 && vTokens.length >= 2 &&
        (cTokens.every((t) => vTokens.includes(t)) || vTokens.every((t) => cTokens.includes(t)));
      const sameSuburb = cSuburb && suburbToken(v.address) === cSuburb;

      if (overlap >= 0.75 || contains) consider('similar-name', sameSuburb ? 0.75 : 0.6);
      else if (overlap >= 0.5 && sameSuburb) consider('similar-name', 0.6);
    }

    if (best) out.push(best);
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

export function describeMatch(m: VenueMatch): string {
  switch (m.reason) {
    case 'link': return 'Same link';
    case 'name': return 'Same name';
    case 'address': return 'Same address';
    case 'location': return 'Same spot on the map';
    case 'similar-name': return 'Similar name';
  }
}
