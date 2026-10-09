import { describe, it, expect, vi } from 'vitest';
import { checkAddresses, normalizeType, withoutKnownVenues, type ExtractedVenueItem } from './openai';

// Google lookups for checkAddresses: answers by venue name, so each test says
// what Google "knows". Unknown names find nothing.
const known = new Map<string, { address: string; lat: number; lon: number; types: string[] }>();
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));
vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
  const query = JSON.parse(String(init?.body ?? '{}')).address as string;
  const hit = [...known.entries()].find(([name]) => query.startsWith(name));
  return new Response(JSON.stringify(hit ? hit[1] : { lat: null, lon: null }), { status: 200 });
}));
const venue = (name: string, address: string): ExtractedVenueItem =>
  ({ name, address, type: 'food', order: 1, tags: [], lat: null, lon: null });
import type { SavedVenue } from './supabase';

/**
 * The model returns free text; this is the gate that turns it into one of the
 * three types the rest of the app can rely on. Everything downstream — the
 * vibe filter, the default stop time, the itinerary composition — keys off it.
 */
describe('normalizeType', () => {
  it('accepts the four canonical values', () => {
    expect(normalizeType('food')).toBe('food');
    expect(normalizeType('activity')).toBe('activity');
    expect(normalizeType('dessert')).toBe('dessert');
    expect(normalizeType('bar')).toBe('bar');
  });

  it('is case and whitespace insensitive', () => {
    expect(normalizeType('  FOOD  ')).toBe('food');
    expect(normalizeType('Dessert')).toBe('dessert');
  });

  it('maps food synonyms', () => {
    for (const s of ['restaurant', 'a great cafe', 'dinner spot', 'somewhere to eat']) {
      expect(normalizeType(s)).toBe('food');
    }
  });

  it('maps bar synonyms to bar, not food', () => {
    // "bar" was a food keyword until the 4th type was added; a wine bar is
    // now its own thing.
    for (const s of ['wine bar', 'cocktail lounge', 'a pub', 'brewery', 'drinks', 'nightclub']) {
      expect(normalizeType(s)).toBe('bar');
    }
  });

  it('maps activity synonyms', () => {
    for (const s of ['escape room', 'fun activity', 'an experience', 'mini golf game', 'sports']) {
      expect(normalizeType(s)).toBe('activity');
    }
  });

  it('maps dessert synonyms', () => {
    for (const s of ['gelato', 'ice creamery', 'cake shop', 'bakery', 'something sweet']) {
      expect(normalizeType(s)).toBe('dessert');
    }
  });

  it('classifies dessert bars as dessert, not food', () => {
    // Regression: the food branch matches on "bar", so when it ran first these
    // came back as food — contradicting the extraction prompt, which defines a
    // dessert bar as a dessert venue.
    expect(normalizeType('dessert bar')).toBe('dessert');
    expect(normalizeType('ice cream bar')).toBe('dessert');
  });

  it('rejects anything it cannot place', () => {
    expect(normalizeType('museum')).toBeNull();
    expect(normalizeType('')).toBeNull();
    expect(normalizeType(null)).toBeNull();
    expect(normalizeType(undefined)).toBeNull();
    expect(normalizeType(42)).toBeNull();
    expect(normalizeType({ type: 'food' })).toBeNull();
  });
});

/**
 * "Something New" must be new: the model is asked to skip saved and visited
 * places, but this is what actually guarantees it.
 */
describe('withoutKnownVenues', () => {
  const saved = [
    { id: '1', name: 'Bar Lune', address: '123 Collins St, Melbourne VIC 3000', link: 'https://instagram.com/barlune', lat: null, lon: null },
  ] as unknown as SavedVenue[];
  const history = [{ title: 'Friday', date: '2026-09-20', location: 'Fitzroy', stops: [{ name: 'Gelato Lab', address: '210 Brunswick St, Fitzroy VIC 3065', type: 'dessert' }] }];
  const candidate = (name: string, address: string, vibe_link: string | null = null) => ({ name, address, type: 'food' as const, vibe_link });

  it('drops a suggestion the user has already saved, however it is written', () => {
    const out = withoutKnownVenues([candidate('bar lune', '123 Collins Street, Melbourne'), candidate('Pho Nom', '45 Swanston St, Melbourne')], saved);
    expect(out.map((c) => c.name)).toEqual(['Pho Nom']);
  });

  it('drops a place from a recent night out', () => {
    const out = withoutKnownVenues([candidate('Gelato Lab', '210 Brunswick St, Fitzroy'), candidate('Messina', '237 Smith St, Fitzroy')], [], history);
    expect(out.map((c) => c.name)).toEqual(['Messina']);
  });

  it('drops a suggestion that links to a saved venue', () => {
    const out = withoutKnownVenues([candidate('Lune Bar', 'Melbourne', 'instagram.com/barlune/')], saved);
    expect(out).toEqual([]);
  });

  it('keeps everything when the user has nothing saved or visited', () => {
    const list = [candidate('A', '1 A St'), candidate('B', '2 B St')];
    expect(withoutKnownVenues(list, [], [])).toEqual(list);
  });
});

/**
 * The AI finds venue names in any language but not always their addresses: a
 * Japanese reel of 7 Tokyo cafés came back with one address on all 7, or
 * invented ones. Those are looked up by name; the rest are left alone.
 */
describe('checkAddresses', () => {
  it('replaces made-up overseas addresses with the real ones', async () => {
    known.clear();
    known.set('茶亭 羽當', { address: '1-chōme-15-19 Shibuya, Tokyo 150-0002, Japan', lat: 35.66, lon: 139.70, types: ['establishment', 'cafe'] });
    const items = [venue('茶亭 羽當 (Chatei Hatou)', '1-1-1 Shibuya, Shibuya City, Tokyo 150-0002, Japan')];
    await checkAddresses(items);
    expect(items[0].address).toBe('1-chōme-15-19 Shibuya, Tokyo 150-0002, Japan');
    expect(items[0].lat).toBe(35.66);
  });

  it('never leaves one address on several venues', async () => {
    known.clear();
    known.set('Cafe A', { address: '2-14-1 Kamimeguro, Meguro City, Tokyo 153-0051, Japan', lat: 1, lon: 1, types: ['establishment'] });
    const same = '1-1-1 Shibuya, Shibuya City, Tokyo, Japan';
    const items = [venue('Cafe A', same), venue('Cafe B', same)];
    await checkAddresses(items);
    expect(items[0].address).toContain('Kamimeguro');
    // Not found: cut back to the area rather than sending people to the wrong door.
    expect(items[1].address).toBe('Shibuya City, Tokyo, Japan');
    expect(items[1].lat).toBeNull();
  });

  it('ignores a park or neighbourhood matched instead of the venue', async () => {
    known.clear();
    known.set('Fuglen Tokyo', { address: 'Yoyogi Park, 2-1 Yoyogikamizonocho, Shibuya, Tokyo 151-0052, Japan', lat: 1, lon: 1, types: ['establishment', 'park'] });
    const items = [venue('Fuglen Tokyo', '1-16-11 Tomigaya, Shibuya City, Tokyo, Japan')];
    await checkAddresses(items);
    expect(items[0].address).toBe('1-16-11 Tomigaya, Shibuya City, Tokyo, Japan');
  });

  it('trusts an Australian street address the AI found', async () => {
    known.clear();
    known.set('Bar Lune', { address: '9 Other St, Somewhere VIC 3000', lat: 1, lon: 1, types: ['establishment'] });
    const items = [venue('Bar Lune', '123 Collins St, Melbourne VIC 3000')];
    await checkAddresses(items);
    expect(items[0].address).toBe('123 Collins St, Melbourne VIC 3000');
  });
});
