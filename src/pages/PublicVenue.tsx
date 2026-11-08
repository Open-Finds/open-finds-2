import { useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { guestSave, readGuestSave, readPublicVenue, saveSharedVenue, sourceUrl } from '../lib/aiSave';
import { APP_URL } from '../lib/invite';
import { navigate } from '../lib/router';
import type { SavedVenue } from '../lib/supabase';

const PLAN_KEY = 'unsaved:pending-venue-plan';

function originalLink(link: string | null) {
  try { return link ? sourceUrl(link) : null; } catch { return null; }
}

export function PublicVenuePage({ id }: { id: string }) {
  const [venue, setVenue] = useState(() => readGuestSave(id));
  const [stored, setStored] = useState(() => Boolean(readGuestSave(id)));
  const [loading, setLoading] = useState(!venue);
  const [error, setError] = useState('');
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
  const link = originalLink(venue.link);
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(venue.name + ', ' + venue.address);
  return <main className="mx-auto grid max-w-md gap-4 p-6">
    <p className="text-sm font-semibold text-primary">The Unsaved</p>
    <h1 className="text-2xl font-bold">{venue.name}</h1>
    <p>{venue.address}</p>
    <div className="flex gap-4">
      <a className="underline" href={maps} target="_blank" rel="noreferrer">Open in Maps</a>
      {link && <a className="underline" href={link} target="_blank" rel="noreferrer">Watch original Reel</a>}
    </div>
    <Button disabled={stored} onClick={() => {
      try { guestSave(id, venue); setStored(true); setError(''); }
      catch { setError('Could not save on this device.'); }
    }}>{stored ? 'Saved on this device' : 'Save Venue'}</Button>
    <Button variant="outline" onClick={() => {
      try { sessionStorage.setItem(PLAN_KEY, id); navigate('/'); }
      catch { setError('Could not keep this venue for planning.'); }
    }}>Create Plan</Button>
    {error && <p role="alert">{error}</p>}
  </main>;
}

export function PendingVenuePlan({ onPlan }: { onPlan: (venue: SavedVenue) => void }) {
  const [id] = useState(() => sessionStorage.getItem(PLAN_KEY));
  const [error, setError] = useState(false);
  const [attempt, retry] = useState(0);
  const handler = useRef(onPlan);
  handler.current = onPlan;
  const job = useRef<{ attempt: number; promise: Promise<SavedVenue> }>();
  useEffect(() => {
    if (!id) return;
    let active = true;
    if (job.current?.attempt !== attempt) job.current = { attempt, promise: (async () => {
      const venue = readGuestSave(id) ?? await readPublicVenue(id);
      if (!venue) throw new Error('Venue unavailable');
      return saveSharedVenue(venue, originalLink(venue.link) ?? APP_URL + '/v/' + id);
    })() };
    void job.current.promise.then(venue => {
      if (!active) return;
      sessionStorage.removeItem(PLAN_KEY);
      handler.current(venue);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [id, attempt]);
  return error ? <div role="alert" className="p-4">
    Could not open the venue in the planner.{' '}
    <Button size="sm" onClick={() => { setError(false); retry(value => value + 1); }}>Retry</Button>
  </div> : null;
}
