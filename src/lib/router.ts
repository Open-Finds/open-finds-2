import { useEffect, useState, useCallback } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'create' }
  | { name: 'build' }
  | { name: 'saved' }
  | { name: 'plan'; id: string }
  | { name: 'share'; id: string }
  | { name: 'rsvp'; id: string }
  | { name: 'confirmed'; id: string }
  | { name: 'declined'; id: string }
  | { name: 'dashboard'; id: string }
  | { name: 'trip'; id: string }
  | { name: 'trip-rsvp'; id: string }
  | { name: 'trip-setup' }
  | { name: 'trip-day'; tripId: string; dayId: string }
  | { name: 'venue-portal' }
  | { name: 'venue-dashboard' }
  | { name: 'subscription' };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  // Strip query string before splitting so ?rsvp=xxx doesn't corrupt segment matching
  const pathOnly = hash.split('?')[0];
  const parts = pathOnly.split('/').filter(Boolean);

  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'create') {
    if (parts[1] === 'build') return { name: 'build' };
    return { name: 'create' };
  }
  if (parts[0] === 'saved') return { name: 'saved' };
  if (parts[0] === 'plan' && parts[1]) {
    const id = parts[1];
    if (parts[2] === 'share') return { name: 'share', id };
    if (parts[2] === 'rsvp') return { name: 'rsvp', id };
    if (parts[2] === 'confirmed') return { name: 'confirmed', id };
    if (parts[2] === 'declined') return { name: 'declined', id };
    if (parts[2] === 'dashboard') return { name: 'dashboard', id };
    // Bare /plan/[id] — treat as the guest RSVP view so share links work
    return { name: 'rsvp', id };
  }
  if (parts[0] === 'trip' && parts[1]) {
    const id = parts[1];
    if (parts[2] === 'rsvp') return { name: 'trip-rsvp', id };
    if (parts[2] === 'day' && parts[3]) return { name: 'trip-day', tripId: id, dayId: parts[3] };
    return { name: 'trip', id };
  }
  if (parts[0] === 'trip-setup') return { name: 'trip-setup' };
  if (parts[0] === 'venue-portal') return { name: 'venue-portal' };
  if (parts[0] === 'venue-dashboard') return { name: 'venue-dashboard' };
  if (parts[0] === 'subscription') return { name: 'subscription' };
  return { name: 'home' };
}

export function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseHash());

  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((path: string) => {
    const clean = path.startsWith('#') ? path : `#${path}`;
    window.location.hash = clean;
    window.scrollTo(0, 0);
  }, []);

  return { route, navigate };
}

export function navigate(path: string) {
  const clean = path.startsWith('#') ? path : `#${path}`;
  window.location.hash = clean;
  window.scrollTo(0, 0);
}
