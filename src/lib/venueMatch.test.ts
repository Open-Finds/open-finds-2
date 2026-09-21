import { describe, it, expect } from 'vitest';
import {
  findSimilarVenues, normalizeName, normalizeAddress, streetKey, normalizeLink,
} from './venueMatch';
import type { SavedVenue } from './supabase';

const venue = (over: Partial<SavedVenue>): SavedVenue => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: 'X', address: 'Y', type: 'food', link: null, user_id: 'u',
  created_at: '2026-01-01', lat: null, lon: null, tags: [], collection: null,
  ...over,
} as SavedVenue);

describe('normalisers', () => {
  it('treats & and "and" alike, ignores punctuation and case', () => {
    expect(normalizeName('Cutler & Co.')).toBe(normalizeName('cutler and co'));
    expect(normalizeName('Señor Tacos!')).toBe('senor tacos');
  });

  it('expands street abbreviations', () => {
    expect(normalizeAddress('55 Gertrude St, Fitzroy VIC')).toBe('55 gertrude street fitzroy vic');
  });

  it('extracts a building-level street key', () => {
    expect(streetKey('55 Gertrude St, Fitzroy VIC 3065')).toBe('55 gertrude street');
    expect(streetKey('Shop 3/55 Gertrude Street')).toBeNull(); // no leading number
    expect(streetKey('Fitzroy')).toBeNull();
  });

  it('normalises links to host+path', () => {
    expect(normalizeLink('https://www.instagram.com/p/ABC123/?igsh=xyz')).toBe('instagram.com/p/abc123');
    expect(normalizeLink('https://instagram.com/p/ABC123')).toBe('instagram.com/p/abc123');
    expect(normalizeLink(null)).toBeNull();
  });
});

describe('findSimilarVenues', () => {
  const cutler = venue({ id: 'cutler', name: 'Cutler & Co', address: '55 Gertrude St, Fitzroy VIC 3065', link: 'https://www.instagram.com/cutlerandco/' });
  const marion = venue({ id: 'marion', name: 'Marion', address: '53 Gertrude St, Fitzroy VIC 3065' });
  const unrelated = venue({ id: 'other', name: 'Bar Liberty', address: '234 Johnston St, Fitzroy VIC 3065' });
  const existing = [cutler, marion, unrelated];

  it('finds nothing for a genuinely new venue', () => {
    expect(findSimilarVenues({ name: 'Supernormal', address: '180 Flinders Ln, Melbourne' }, existing)).toEqual([]);
  });

  it('matches the same link despite tracking params and www', () => {
    const m = findSimilarVenues(
      { name: 'whatever', address: 'nowhere', link: 'https://instagram.com/cutlerandco?utm=1' },
      existing
    );
    expect(m[0]?.venue.id).toBe('cutler');
    expect(m[0]?.reason).toBe('link');
  });

  it('matches the same name written differently', () => {
    const m = findSimilarVenues({ name: 'cutler and co.', address: 'unknown' }, existing);
    expect(m[0]?.venue.id).toBe('cutler');
    expect(m[0]?.reason).toBe('name');
  });

  it('matches the same building even with a different name', () => {
    // A renamed venue, or a source that used the business name vs the brand.
    const m = findSimilarVenues({ name: 'Gertrude Street Enoteca', address: '55 Gertrude Street Fitzroy' }, existing);
    expect(m[0]?.venue.id).toBe('cutler');
    expect(m[0]?.reason).toBe('address');
  });

  it('does not confuse neighbours on the same street', () => {
    // 53 and 55 Gertrude are different buildings; neither name nor number match.
    const m = findSimilarVenues({ name: 'Napier Quarter', address: '359 Napier St, Fitzroy' }, existing);
    expect(m).toEqual([]);
  });

  it('matches by coordinates when both sides have them', () => {
    const withCoords = [venue({ id: 'geo', name: 'Some Place', address: 'somewhere', lat: -37.8065, lon: 144.9782 })];
    const m = findSimilarVenues({ name: 'Totally Different', address: 'elsewhere', lat: -37.80652, lon: 144.97823 }, withCoords);
    expect(m[0]?.reason).toBe('location');
  });

  it('flags a strong name overlap in the same suburb as similar', () => {
    const m = findSimilarVenues({ name: 'Cutler & Co Fitzroy', address: 'Fitzroy VIC' }, existing);
    expect(m[0]?.venue.id).toBe('cutler');
    expect(m[0]?.reason).toBe('similar-name');
    expect(m[0]?.confidence).toBeLessThan(0.9);
  });

  it('ignores generic words when comparing names', () => {
    // "The Bar" vs "Bar Liberty" share only noise.
    const m = findSimilarVenues({ name: 'The Bar', address: 'Fitzroy' }, existing);
    expect(m).toEqual([]);
  });

  it('returns each venue once, at its strongest reason', () => {
    const m = findSimilarVenues(
      { name: 'Cutler & Co', address: '55 Gertrude St Fitzroy', link: 'https://instagram.com/cutlerandco' },
      existing
    );
    expect(m.filter((x) => x.venue.id === 'cutler')).toHaveLength(1);
    expect(m[0]?.reason).toBe('link');
    expect(m[0]?.confidence).toBe(1);
  });
});
