import { describe, it, expect } from 'vitest';
import { mapsDirectionsUrl } from './maps';

describe('mapsDirectionsUrl', () => {
  it('puts every stop on one directions link, in order', () => {
    const url = mapsDirectionsUrl([
      '1 George St, Sydney',
      '2 Pitt St, Sydney',
      '3 York St, Sydney',
    ]);
    expect(url).toBeTruthy();
    const params = new URL(url!).searchParams;
    expect(params.get('destination')).toBe('3 York St, Sydney');
    expect(params.get('waypoints')).toBe('1 George St, Sydney|2 Pitt St, Sydney');
  });

  it('uses a single stop as the destination', () => {
    const params = new URL(mapsDirectionsUrl(['55 Gertrude St'])!).searchParams;
    expect(params.get('destination')).toBe('55 Gertrude St');
    expect(params.get('waypoints')).toBeNull();
  });

  it('falls back to the plan location when there are no stops', () => {
    const params = new URL(mapsDirectionsUrl([], 'Sydney')!).searchParams;
    expect(params.get('destination')).toBe('Sydney');
  });

  it('returns null when there is nowhere to go', () => {
    expect(mapsDirectionsUrl([])).toBeNull();
  });
});
