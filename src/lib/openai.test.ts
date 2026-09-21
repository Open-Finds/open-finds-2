import { describe, it, expect } from 'vitest';
import { normalizeType } from './openai';

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
