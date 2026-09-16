import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRouter, navigate } from './router';

/**
 * Routing is the app's access-control surface for guests: App.tsx decides
 * whether to require auth purely from the parsed route name. A parse bug here
 * either breaks every share link or exposes an authenticated page.
 */
function routeFor(hash: string) {
  window.location.hash = hash;
  const { result } = renderHook(() => useRouter());
  return result.current.route;
}

describe('parseHash', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('treats an empty hash as home', () => {
    expect(routeFor('')).toEqual({ name: 'home' });
    expect(routeFor('#/')).toEqual({ name: 'home' });
  });

  it('parses plan sub-routes', () => {
    expect(routeFor('#/plan/abc/rsvp')).toEqual({ name: 'rsvp', id: 'abc' });
    expect(routeFor('#/plan/abc/confirmed')).toEqual({ name: 'confirmed', id: 'abc' });
    expect(routeFor('#/plan/abc/declined')).toEqual({ name: 'declined', id: 'abc' });
    expect(routeFor('#/plan/abc/share')).toEqual({ name: 'share', id: 'abc' });
    expect(routeFor('#/plan/abc/dashboard')).toEqual({ name: 'dashboard', id: 'abc' });
  });

  it('treats a bare /plan/[id] as the guest RSVP view', () => {
    // Share links are handed out without a suffix; this fallback is what makes
    // them work at all.
    expect(routeFor('#/plan/abc')).toEqual({ name: 'rsvp', id: 'abc' });
  });

  it('strips the query string before matching segments', () => {
    // The confirmed/declined flow appends ?rsvp=<id>. If the query were not
    // stripped first, the last segment would be "confirmed?rsvp=xyz" and the
    // route would silently fall through to the guest RSVP page.
    expect(routeFor('#/plan/abc/confirmed?rsvp=xyz')).toEqual({ name: 'confirmed', id: 'abc' });
    expect(routeFor('#/plan/abc/declined?rsvp=xyz')).toEqual({ name: 'declined', id: 'abc' });
  });

  it('parses trip routes including day sub-routes', () => {
    expect(routeFor('#/trip/t1')).toEqual({ name: 'trip', id: 't1' });
    expect(routeFor('#/trip/t1/rsvp')).toEqual({ name: 'trip-rsvp', id: 't1' });
    expect(routeFor('#/trip/t1/day/d2')).toEqual({ name: 'trip-day', tripId: 't1', dayId: 'd2' });
  });

  it('parses standalone routes', () => {
    expect(routeFor('#/trip-setup')).toEqual({ name: 'trip-setup' });
    expect(routeFor('#/venue-portal')).toEqual({ name: 'venue-portal' });
    expect(routeFor('#/subscription')).toEqual({ name: 'subscription' });
    expect(routeFor('#/saved')).toEqual({ name: 'saved' });
    expect(routeFor('#/create')).toEqual({ name: 'create' });
    expect(routeFor('#/create/build')).toEqual({ name: 'build' });
  });

  it('falls back to home for anything unrecognised', () => {
    expect(routeFor('#/nonsense')).toEqual({ name: 'home' });
    expect(routeFor('#/plan')).toEqual({ name: 'home' }); // no id
  });

  it('tolerates extra and repeated slashes', () => {
    expect(routeFor('#//plan//abc//rsvp')).toEqual({ name: 'rsvp', id: 'abc' });
  });
});

describe('useRouter', () => {
  it('re-parses when the hash changes', () => {
    window.location.hash = '#/';
    const { result } = renderHook(() => useRouter());
    expect(result.current.route).toEqual({ name: 'home' });

    act(() => {
      window.location.hash = '#/plan/xyz/rsvp';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(result.current.route).toEqual({ name: 'rsvp', id: 'xyz' });
  });
});

describe('navigate', () => {
  it('prefixes a bare path with #', () => {
    navigate('/plan/abc/rsvp');
    expect(window.location.hash).toBe('#/plan/abc/rsvp');
  });

  it('leaves an already-prefixed path alone', () => {
    navigate('#/trip-setup');
    expect(window.location.hash).toBe('#/trip-setup');
  });
});
