import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { guestSave, readGuestSave, readPublicVenue, sourceUrl, type PublicVenue } from '../lib/aiSave';
import { fallbackImage, publicVenueLink, stagingSupabase, validRecommendationId, venuePhoto } from '../lib/publicRecommendation.js';

const PLAN_KEY = 'unsaved:pending-venue-plan';

function originalLink(link: string | null) {
  try { return link ? sourceUrl(link) : null; } catch { return null; }
}

export function PublicVenuePage({ id }: { id: string }) {
  const [venue, setVenue] = useState(() => readGuestSave(id));
  const [stored, setStored] = useState(() => Boolean(readGuestSave(id)));
  const [loading, setLoading] = useState(!venue);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void readPublicVenue(id).then(value => {
      if (!active) return;
      if (value) setVenue(value);
      else if (!readGuestSave(id)) setError('This recommendation is unavailable.');
    }).catch(() => {
      if (active && !readGuestSave(id)) setError('Could not load this recommendation.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  if (!venue) return <main className="mx-auto max-w-md p-6">{loading ? 'Loading venue…' : error}</main>;
  const link = publicVenueLink(venue.link);
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue.name + ', ' + venue.address);
  const photo = imageFailed ? null : venuePhoto(import.meta.env.VITE_SUPABASE_URL === stagingSupabase, id, venue);
  return <div className="venue-public">
    <link rel="stylesheet" href="/venue-public.css" />
    <main className="venue-shell">
      <header className="venue-brand"><img src="/brand/wordmark-light.webp" alt="The Unsaved" /></header>
      <article className="venue-card">
        <div className={photo ? 'venue-hero' : 'venue-hero venue-fallback'}>
          <img src={photo ?? fallbackImage} alt={photo ? venue.name : 'The Unsaved app icon'} onError={() => setImageFailed(true)} />
        </div>
        <div className="venue-content">
          <p className="venue-category capitalize">{venue.type}</p>
          <h1>{venue.name}</h1>
          <p className="venue-address">{venue.address}</p>
          <div className="venue-actions">
            <button className="venue-primary" type="button" disabled={stored} onClick={() => {
              try { guestSave(id, venue); setStored(true); setError(''); }
              catch { setError('Could not save on this device.'); }
            }}>{stored ? 'Saved on this device' : 'Save Venue'}</button>
            <a className="venue-secondary" href={maps} target="_blank" rel="noreferrer">Open in Maps</a>
            {link && <a className="venue-secondary" href={link} target="_blank" rel="noreferrer">Watch Reel</a>}
            <a className="venue-plan" href={'/?planVenue=' + encodeURIComponent(id)}>Create Plan</a>
          </div>
          {error && <p className="venue-status" role="alert">{error}</p>}
        </div>
      </article>
    </main>
  </div>;
}

export function PendingVenuePlan({ onPlan }: { onPlan: (venue: PublicVenue) => void }) {
  const [id] = useState(() => {
    const queryId = new URLSearchParams(window.location.search).get('planVenue');
    if (validRecommendationId(queryId)) return queryId;
    try {
      const legacyId = sessionStorage.getItem(PLAN_KEY);
      return validRecommendationId(legacyId) ? legacyId : null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  const handler = useRef(onPlan);
  handler.current = onPlan;
  const job = useRef<{ attempt: number; promise: Promise<PublicVenue> }>();
  useEffect(() => {
    if (!id) return;
    let active = true;
    if (job.current?.attempt !== attempt) job.current = { attempt, promise: (async () => {
      const venue = readGuestSave(id) ?? await readPublicVenue(id);
      if (!venue) throw new Error('Venue unavailable');
      return { ...venue, link: originalLink(venue.link) };
    })() };
    void job.current.promise.then(venue => {
      if (!active) return;
      try { sessionStorage.removeItem(PLAN_KEY); } catch { /* The current handoff can still proceed. */ }
      const url = new URL(window.location.href);
      if (url.searchParams.get('planVenue') === id) {
        url.searchParams.delete('planVenue');
        window.history.replaceState(window.history.state, '', url);
      }
      handler.current(venue);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, attempt]);
  return error ? <div role="alert" className="p-4">
    Could not open the venue in the planner.{' '}
    <Button size="sm" onClick={() => { setError(false); retry(value => value + 1); }}>Retry</Button>
  </div> : null;
}
