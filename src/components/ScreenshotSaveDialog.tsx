import { ProgressBorder } from './ProgressBorder';
import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { AddToCollection } from './AddToCollection';
import { AiSaveFeedback, type FeedbackValue } from './AiSaveFeedback';
import { findFromScreenshots, MAX_SCREENSHOTS } from '../lib/aiSaveScreenshots';
import { searchGooglePlaces } from '../lib/apiKeys';
import { quietLocation } from '../lib/geolocation';
import { insertSavedVenue, type SavedVenue } from '../lib/supabase';
import { recordAiSaveResult, type Outcome } from '../lib/aiSaveResults';
import { ProviderUnavailableError, waitText } from '../lib/providerErrors';
import { fallbackImage } from '../lib/publicRecommendation.js';
import type { VenueRow } from '../lib/aiSave';
import { cn } from '../lib/utils';

/**
 * AI Save for screenshots shared to the app (see aiSaveScreenshots). Its own screen, so the link flow is unchanged.
 * The AI reads the venues once; the user ticks which to save. A search box is always there as the backup.
 */
export function ScreenshotSaveDialog({ count, loadImages, onClose }: {
  /** How many pictures were shared (the phone keeps at most MAX_SCREENSHOTS). */
  count: number;
  loadImages: () => Promise<string[]>;
  onClose: () => void;
}) {
  const attemptId = useRef(crypto.randomUUID());
  const started = useRef(Date.now());
  const [phase, setPhase] = useState<'reading' | 'ready'>('reading');
  const [rows, setRows] = useState<VenueRow[]>([]);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [saved, setSaved] = useState<Record<number, SavedVenue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState<VenueRow[] | null>(null);
  const [feedback, setFeedback] = useState<FeedbackValue>();
  const usedSearch = useRef(false);
  /** The loading ring: opening the pictures, then the AI reading them (the slow part), then the Google checks. */
  const [ring, setRing] = useState(0);
  const [ringFilled, setRingFilled] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const images = await loadImages();
        if (!images.length) throw new Error('unreadable');
        if (active) setRing(0.15);
        const found = await findFromScreenshots(images, attemptId.current, value => {
          if (active) setRing(value);
        });
        if (!active) return;
        setRows(found);
        setTicked(new Set(found.flatMap((row, index) => row.verified ? [index] : [])));
        if (!found.length) setError("We couldn't read a venue from these screenshots. Search for it by name below.");
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof ProviderUnavailableError && cause.retryAfterSeconds
          ? `AI Save is busy. ${waitText(cause.retryAfterSeconds)} Or search for the venue below.`
          : cause instanceof Error && cause.message === 'unreadable'
            ? "We couldn't open these pictures. Search for the venue by name below."
            : "We couldn't read these screenshots. Search for the venue by name below.");
      } finally {
        if (active) setPhase('ready');
      }
    })();
    return () => { active = false; };
    // Read once per share.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (index: number) => setTicked(current => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    return next;
  });

  const accept = (index: number) => {
    const suggestion = rows[index].suggestion;
    if (!suggestion) return;
    setRows(current => current.map((row, i) => i === index ? {
      venue: { ...row.venue, name: suggestion.name, address: suggestion.address, type: suggestion.type ?? row.venue.type,
        lat: suggestion.lat, lon: suggestion.lon },
      verified: true,
    } : row));
    setTicked(current => new Set(current).add(index));
  };

  const search = async () => {
    const text = query.trim();
    if (!text || searching) return;
    setSearching(true);
    setError('');
    try {
      const places = await searchGooglePlaces(text, attemptId.current, await quietLocation());
      setSearched(places.map(place => ({ venue: { name: place.name, address: place.address, type: place.type ?? 'food', link: '',
        lat: place.lat, lon: place.lon, tags: [] }, verified: true })));
    } catch {
      setError('Search is not available right now. Try again in a moment.');
    } finally {
      setSearching(false);
    }
  };

  const pick = (row: VenueRow) => {
    usedSearch.current = true;
    setRows(current => [...current, row]);
    setTicked(current => new Set(current).add(rows.length));
    setSearched(null);
    setQuery('');
  };

  const record = (outcome: Outcome, done: SavedVenue[], value?: FeedbackValue) => {
    void recordAiSaveResult({
      attemptId: attemptId.current, platform: 'other', postKind: 'photo', outcome,
      foundBy: usedSearch.current ? 'manual' : 'ai', venueName: done[0]?.name ?? rows[0]?.venue.name,
      venueCount: done.length || rows.length, savedVenueId: done[0]?.id, edited: false, usedNoneOfThese: false, usedPastedCaption: false,
      durationMs: Date.now() - started.current, ...value,
    });
  };

  const waiting = [...ticked].filter(index => !saved[index]);
  const saveSelected = async () => {
    setSaving(true);
    setError('');
    const done = { ...saved };
    let failed = false;
    for (const index of waiting) {
      const { venue } = rows[index];
      try {
        done[index] = await insertSavedVenue({
          name: venue.name, address: venue.address, type: venue.type, link: null, lat: venue.lat ?? null, lon: venue.lon ?? null, tags: [],
        });
      } catch {
        failed = true;
      }
    }
    setSaved(done);
    setSaving(false);
    if (failed) setError('Some venues were not saved. Try again.');
    const list = Object.values(done);
    if (list.length) record(usedSearch.current ? 'searched' : list.length > 1 ? 'multiple' : 'confirmed', list, feedback);
  };

  const rate = (value: FeedbackValue) => {
    setFeedback(value);
    const list = Object.values(saved);
    record(list.length ? (usedSearch.current ? 'searched' : list.length > 1 ? 'multiple' : 'confirmed') : 'not_saved', list, value);
  };

  const savedList = Object.values(saved);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="isolate">
      {(phase === 'reading' || !ringFilled) && <ProgressBorder value={ring} done={phase !== 'reading'}
        onFilled={() => setRingFilled(true)} />}
      <img className="size-8 rounded-lg" src={fallbackImage} alt="The Unsaved" />
      <DialogTitle>AI Save from screenshots</DialogTitle>
      <DialogDescription aria-live="polite">
        {phase === 'reading' ? `Reading ${Math.min(count, MAX_SCREENSHOTS)} screenshot${count === 1 ? '' : 's'}…`
          : rows.length ? 'Tick the venues to save.' : 'Search for the venue to save it.'}
      </DialogDescription>
      {count > MAX_SCREENSHOTS && <p className="text-small text-muted-foreground">Only the first {MAX_SCREENSHOTS} screenshots are read.</p>}
      {error && <p role="alert" className="text-small text-destructive-text">{error}</p>}
      {phase === 'reading' ? <div className="grid gap-2" aria-hidden="true">
        <Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" />
      </div> : <>
        {rows.length > 0 && <div role="group" aria-label="Venues found" className="grid gap-2">
          {rows.map((row, index) => {
            const done = saved[index];
            const on = ticked.has(index) || !!done;
            const hasAddress = !!row.venue.address.trim();
            const suggestion = !done && !row.verified ? row.suggestion : undefined;
            return <div key={index} className={cn('rounded-lg border p-3', on ? 'border-primary bg-primary-soft' : 'border-border bg-card')}>
              <button type="button" role="checkbox" aria-checked={on} aria-label={`Save ${row.venue.name}`} disabled={!hasAddress || !!done || saving}
                onClick={() => toggle(index)}
                className="-m-3 flex w-[calc(100%+1.5rem)] min-w-0 items-start gap-3 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold">{row.venue.name}</span>
                  <span className="block break-words text-small">{hasAddress ? row.venue.address : 'Not found on Google Maps'}</span>
                  <span className="block text-small text-muted-foreground">{done ? 'Saved to My Venues'
                    : row.verified ? 'Confirmed on Google Maps' : suggestion ? 'Check the closest match below.' : 'Search for it below to save it.'}</span>
                </span>
              </button>
              {suggestion && <div className="mt-3 grid gap-1 rounded-md border border-border bg-background p-3">
                <p className="text-small text-muted-foreground">Is this it? Google's closest match:</p>
                <p className="break-words text-small font-semibold">{suggestion.name}</p>
                <p className="break-words text-small">{suggestion.address}</p>
                <Button variant="outline" size="sm" className="mt-1 w-fit" disabled={saving} onClick={() => accept(index)}
                  aria-label={`Yes, use this: ${suggestion.name}`}>Yes, use this</Button>
              </div>}
            </div>;
          })}
        </div>}
        {rows.length > 0 && <Button disabled={saving || waiting.length === 0} onClick={() => void saveSelected()}>
          {saving ? 'Saving…' : `Save selected (${waiting.length})`}
        </Button>}
        {savedList.length === 1 && <AddToCollection venueId={savedList[0].id} />}
        <div className="grid gap-2 rounded-lg border p-3">
          <label className="text-label" htmlFor="screenshot-place-search">Search Google Maps</label>
          <div className="flex gap-2">
            <Input id="screenshot-place-search" maxLength={200} value={query} placeholder="Venue name and suburb or city"
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} />
            <Button type="button" variant="outline" disabled={searching || !query.trim() || saving} onClick={() => void search()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
          {searched && (searched.length ? <div className="grid gap-2">
            {searched.map((row, index) => <Button key={index} type="button" variant="outline" className="h-auto justify-start whitespace-normal py-2 text-left"
              onClick={() => pick(row)}>
              <span className="grid min-w-0"><span className="break-words font-semibold">{row.venue.name}</span>
                <span className="break-words text-muted-foreground">{row.venue.address}</span></span>
            </Button>)}
          </div> : <p className="text-small text-muted-foreground">No places found. Try adding the suburb or city.</p>)}
        </div>
        {(rows.length > 0 || savedList.length > 0) && <AiSaveFeedback value={feedback} onRate={rate} />}
        <Button variant="ghost" onClick={onClose}>{savedList.length ? 'Done' : 'Close'}</Button>
      </>}
    </DialogContent>
  </Dialog>;
}
