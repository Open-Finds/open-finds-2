import { describe, expect, it } from 'vitest';
import { CATEGORIES, CATEGORY_LABELS, categoryOf, categoryStorage, classifyVenue, displayTags, matchesTaxonomy, matchesVibes, normalizeTags, supportedExtractionTags, tagsFromText } from './taxonomy';
describe('compatible six-category taxonomy', () => {
  it('keeps legacy Activity distinct from Outdoors and outdoor seating', () => {
    expect(CATEGORIES).toHaveLength(7);
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
  it('shows Nature and Nightlife by name and stores Cafe as a food venue with its own category tag', () => {
    expect(CATEGORY_LABELS.outdoors).toBe('Nature');
    expect(CATEGORY_LABELS.nightlife).toBe('Nightlife');
    expect(categoryStorage('cafe', ['Matcha'])).toEqual({ type: 'food', tags: ['specialty:matcha', 'category:cafe'] });
    expect(categoryOf({ type: 'food', tags: ['category:cafe'] })).toBe('cafe');
  });
  it('does not repeat category tags as descriptive tags on cards', () => {
    expect(displayTags(['category:outdoors', 'hike', 'loop track', 'category:outdoors'])).toEqual(['attribute:hike', 'attribute:loop_track']);
  });
  it('reads descriptive tags the caption says outright, and never categories', () => {
    expect(tagsFromText('Seoul Garden - all you can eat Korean BBQ buffet in Sydney')).toEqual(
      expect.arrayContaining(['specialty:buffet', 'cuisine:korean', 'specialty:korean_bbq']));
    expect(tagsFromText('Lovely loop track and a short hike to the lookout')).toEqual(
      expect.arrayContaining(['attribute:loop_track', 'attribute:hike', 'attribute:lookout']));
    expect(tagsFromText('Best nightlife and outdoors in town')).toEqual([]);
    expect(tagsFromText('Plain Kitchen')).toEqual([]);
  });
  it('keeps an AI tag only when the caption or name supports it', () => {
    expect(supportedExtractionTags(['matcha', 'brunch'], 'Matcha Lab - iced raspberry earl grey')).toEqual(['specialty:matcha']);
  });
});
