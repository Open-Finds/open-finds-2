import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryOf, categoryStorage, classifyVenue, matchesTaxonomy, matchesVibes, normalizeTags, supportedExtractionTags } from './taxonomy';
describe('compatible six-category taxonomy', () => {
  it('keeps legacy Activity distinct from Outdoors and outdoor seating', () => {
    expect(CATEGORIES).toHaveLength(6);
    expect(categoryOf({ type: 'activity', name: 'Beach-themed bowling', tags: [] })).toBe('activity');
    expect(categoryOf({ type: 'food', tags: ['outdoor seating'] })).toBe('food');
    expect(categoryOf({ type: 'activity', tags: ['outdoors-adventure'] })).toBe('outdoors');
    expect(categoryOf({ type: 'bar', tags: ['nightlife-music'] })).toBe('nightlife');
  });
  it('stores an explicit correction without changing the database enum or losing custom tags', () => {
    const changed = categoryStorage('outdoors', ['My favourite', 'nightlife-music']);
    expect(changed).toEqual({ type: 'activity', tags: ['My favourite', 'category:outdoors'] });
    expect(categoryOf(changed)).toBe('outdoors');
    expect(categoryStorage('activity', changed.tags)).toEqual({ type: 'activity', tags: ['My favourite', 'category:activity'] });
  });
  it('normalizes aliases without deriving specialties from cuisine', () => {
    expect(normalizeTags(['phở', 'pho', 'bánh mì', 'kbbq', 'Korean barbecue', 'My tag'])).toEqual(['specialty:pho', 'specialty:banh_mi', 'specialty:korean_bbq', 'My tag']);
    expect(classifyVenue({ type: 'food', tags: ['vietnamese'] }).specialties).toEqual([]);
    expect(matchesTaxonomy({ name: 'Existing', address: 'Test', tags: ['bánh mì'] }, 'banh mi')).toBe(true);
    expect(matchesTaxonomy({ name: 'Existing', address: 'Test', tags: ['pho'] }, 'noodle soup')).toBe(true);
    expect(matchesTaxonomy({ name: 'Existing', address: 'Test', tags: ['noodle soup'] }, 'pho')).toBe(false);
  });
  it('requires explicit venue-specific evidence for automatically extracted structured tags', () => {
    expect(supportedExtractionTags(['pho', 'vietnamese', 'budget-friendly'], 'Pho Kitchen')).toEqual(['specialty:pho']);
    expect(supportedExtractionTags(['pho'], 'Vietnamese Restaurant')).toEqual([]);
  });
  it('filters structured cuisine/category preferences before AI without inventing budget claims', () => {
    expect(matchesVibes({ category: 'food', tags: [] }, ['japanese'])).toBe(false);
    expect(matchesVibes({ category: 'food', tags: ['japanese'] }, ['japanese', 'date', 'cheap'])).toBe(true);
    expect(matchesVibes({ category: 'activity', tags: [] }, ['adventure'])).toBe(false);
    expect(matchesVibes({ category: 'outdoors', tags: [] }, ['adventure'])).toBe(true);
  });
});
