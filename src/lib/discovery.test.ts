import { describe, expect, it, vi } from 'vitest';
vi.mock('./edgeAuth', () => ({ edgeAuthHeaders: async () => ({}) }));
import { newProviderVenues, providerCategories } from './discovery';
import { categoriesOf } from './taxonomy';
const record = { id: 'verified-place', name: 'Fixture provider venue', address: '1 Fixture Street', lat: -33.8, lon: 151.2, types: ['bar'] };
describe('verified external venue records', () => {
  it('deduplicates provider IDs and already-saved name/address records', () => {
    const first = newProviderVenues([record, record], []); expect(first).toHaveLength(1);
    expect(newProviderVenues([record], first)).toEqual([]);
    expect(newProviderVenues([{ ...record, id: 'another-id' }], first)).toEqual([]);
    expect(newProviderVenues([{ ...record, name: 'Renamed' }], [{ ...first[0], providerId: undefined }])).toEqual([]);
  });
  it('rejects names without verified addresses, identifiers or coordinates', () => {
    expect(newProviderVenues([{ ...record, address: '' }, { ...record, lat: 999 }, { name: 'Invented' }, null], [])).toEqual([]);
  });
  it('requires evidence for overlapping Bar and Nightlife categories', () => {
    expect(providerCategories(['bar'])).toEqual(['bar']);
    expect(providerCategories(['live_music_venue'])).toEqual(['nightlife']);
    const [v] = newProviderVenues([{ ...record, types: ['bar', 'night_club'] }], []);
    expect(categoriesOf({ type: v.category, tags: v.tags })).toEqual(['bar', 'nightlife']);
    expect(providerCategories(['hiking_area'])).toEqual(['outdoors']);
    expect(providerCategories(['bowling_alley'])).toEqual(['activity']);
  });
});
