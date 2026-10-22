import { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Film, Loader2, MapPin } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { DuplicateVenueDialog, type PendingDuplicate } from './DuplicateVenueDialog';
import { extractVenuesFromLink, fetchLinkThumbnail, UserFacingError, type ExtractedVenueItem } from '../lib/openai';
import { fetchSavedVenues, insertSavedVenue, updateSavedVenueCoords } from '../lib/supabase';
import { geocodeAddress } from '../lib/apiKeys';
import { findSimilarVenues } from '../lib/venueMatch';
import { copyToClipboard } from '../lib/invite';
import { composeShareMessage, DEFAULT_SHARE_MESSAGE } from '../lib/shareMessage';

export function ShareToAppFlow({ link, onClose, onSaved }: {
  link: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<'loading' | 'review' | 'send'>('loading');
  const [venues, setVenues] = useState<ExtractedVenueItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [message, setMessage] = useState(DEFAULT_SHARE_MESSAGE);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [duplicates, setDuplicates] = useState<PendingDuplicate[] | null>(null);
  const saveMode = useRef(false);
  const busyRef = useRef(false);
  const extraction = useRef<Promise<ExtractedVenueItem[]> | null>(null);
  const imageRequest = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    let active = true;
    // Reuse the requests during React StrictMode's effect replay.
    extraction.current ??= extractVenuesFromLink(link);
    imageRequest.current ??= fetchLinkThumbnail(link);
    void imageRequest.current.then((image) => { if (active) setThumbnail(image); });
    void extraction.current.then((items) => {
      if (!active) return;
      setVenues(items);
      setName(items[0]?.name ?? '');
      setAddress(items[0]?.address ?? '');
      if (!items.length) setError("Couldn't find a venue. Enter its name and address to save it.");
      setStep('review');
    }).catch((err: unknown) => {
      if (!active) return;
      setError(err instanceof UserFacingError ? err.message : "Couldn't find a venue. Enter its name and address to save it.");
      setStep('review');
    });
    return () => { active = false; };
  }, [link]);

  const venue = venues[selected];
  const type = venue?.type ?? 'food';
  const tags = venue?.tags ?? [];

  async function performSave(send: boolean) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await insertSavedVenue({
        name: name.trim(), address: address.trim(), type, tags, link,
        lat: venue?.lat ?? null, lon: venue?.lon ?? null,
      });
      // A coordinate lookup failure must not turn a successful insert into a retry.
      if (venue?.lat == null || venue?.lon == null) {
        void geocodeAddress(address.trim()).then((coords) => {
          if (coords) return updateSavedVenueCoords(saved.id, coords.lat, coords.lon);
        }).catch(() => {});
      }
      onSaved();
      if (send) setStep('send');
      else onClose();
    } catch {
      setError('Could not save this venue. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function save(send: boolean) {
    if (busyRef.current) return;
    if (!name.trim() || !address.trim()) {
      setError('Name and address are required.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const candidate = { name: name.trim(), address: address.trim(), link, lat: venue?.lat, lon: venue?.lon };
      const existing = await fetchSavedVenues();
      const matches = findSimilarVenues(candidate, existing);
      if (matches.length) {
        saveMode.current = send;
        setDuplicates([{ candidate, matches }]);
        return;
      }
    } catch {
      setError('Could not check your saved venues. Please try again.');
      return;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    await performSave(send);
  }

  async function send() {
    if (busyRef.current) return;
    if (!name.trim() || !address.trim()) {
      setError('Event name and address are required.');
      return;
    }
    const text = composeShareMessage({ message, name, address, link });
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      if (typeof navigator.share === 'function') {
        // The original link is already in text; a separate url field duplicates it.
        await navigator.share({ text });
        onClose();
      } else if (await copyToClipboard(text)) {
        setCopied(true);
      } else {
        setError('Sharing is unavailable in this browser. Open the app in your phone’s browser and try again.');
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setError('Could not open sharing. Please try again in your phone’s browser.');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const preview = (
    <a href={link} target="_blank" rel="noopener noreferrer" aria-label="Preview original shared reel"
      className="group flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        {thumbnail && !imageFailed
          ? <img src={thumbnail} alt="Shared reel thumbnail" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="h-full w-full object-cover" />
          : <Film className="text-muted-foreground" size={26} />}
      </span>
      <span className="flex-1 text-sm font-medium">Preview original reel<span className="mt-1 block text-xs font-normal text-muted-foreground">Tap to watch</span></span>
      <ExternalLink size={16} className="mr-2 text-muted-foreground" />
    </a>
  );

  return <>
    <Dialog open={!duplicates} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="inset-x-auto bottom-auto left-1/2 top-1/2 flex h-[min(620px,90dvh)] w-[calc(100%_-_2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-lg text-left sm:max-w-md"
        onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (busy) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{step === 'send' ? 'Send to friends' : 'Save this venue'}</DialogTitle>
          <DialogDescription>{step === 'send' ? 'Venue saved. Make it an invitation and share it.' : 'A good find deserves a spot in your saved venues.'}</DialogDescription>
        </DialogHeader>
        {step === 'loading' ? <div role="status" className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"><Loader2 className="animate-spin" /><p>Finding the venue…</p></div> : <>
          <div className="space-y-4">
            {step === 'review' && venues.length > 1 && <div className="space-y-1.5">
              <Label htmlFor="shared-venue-choice">This reel mentions {venues.length} venues. Choose one to save.</Label>
              <select id="shared-venue-choice" value={selected} disabled={busy}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setSelected(index); setName(venues[index].name); setAddress(venues[index].address); setError(null);
                }}>
                {venues.map((item, index) => <option key={index} value={index}>{item.name}</option>)}
              </select>
            </div>}
            {step === 'review' && venue?.name && venue.address ? <div className="space-y-3 rounded-lg border border-border p-4">
              <h3 className="text-lg font-semibold">{venue.name}</h3>
              <p className="flex items-start gap-2 text-sm text-muted-foreground"><MapPin size={16} className="mt-0.5 shrink-0" />{venue.address}</p>
              <div className="flex flex-wrap gap-1.5"><Badge className="capitalize">{type}</Badge>{tags.map((tag, index) => <Badge key={index} variant="secondary">{tag}</Badge>)}</div>
            </div> : <>
              <div className="space-y-1.5"><Label htmlFor="shared-event-name">{step === 'send' ? 'Event name' : 'Venue name'}</Label><Input id="shared-event-name" value={name} disabled={busy} onChange={(event) => { setName(event.target.value); setCopied(false); }} /></div>
              <div className="space-y-1.5"><Label htmlFor="shared-address">Address</Label><Input id="shared-address" value={address} disabled={busy} onChange={(event) => { setAddress(event.target.value); setCopied(false); }} /></div>
            </>}
            {step === 'send' && <div className="space-y-1.5"><Label htmlFor="shared-message">Message</Label><Textarea id="shared-message" value={message} disabled={busy} rows={3} onChange={(event) => { setMessage(event.target.value); setCopied(false); }} /></div>}
            {preview}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {copied && <p role="status" className="flex items-center gap-2 text-sm text-success"><Check size={16} />Message copied. Paste it into WhatsApp, Telegram, or your DMs.</p>}
          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            {step === 'review' ? <>
              <Button variant="outline" disabled={busy} onClick={() => void save(false)} className="flex-1">{busy && <Loader2 size={16} className="mr-2 animate-spin" />}Save to app</Button>
              <Button disabled={busy} onClick={() => void save(true)} className="flex-1">Save &amp; Send</Button>
              <Button variant="ghost" disabled={busy} onClick={onClose} className="w-full">Cancel</Button>
            </> : <>
              <Button variant="ghost" disabled={busy} onClick={onClose}>Close</Button>
              <Button disabled={busy} onClick={() => void send()} className="flex-1">{busy && <Loader2 size={16} className="mr-2 animate-spin" />}Send</Button>
            </>}
          </div>
        </>}
      </DialogContent>
    </Dialog>
    <DuplicateVenueDialog pending={duplicates} onCancel={() => setDuplicates(null)} onAddAnyway={() => { setDuplicates(null); void performSave(saveMode.current); }} />
  </>;
}
