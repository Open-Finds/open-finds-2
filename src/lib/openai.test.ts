import { describe, it, expect } from 'vitest';
import { normalizeType, withoutKnownVenues } from './openai';
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
