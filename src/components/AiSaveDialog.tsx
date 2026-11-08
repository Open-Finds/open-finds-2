import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { identifySharedVenue, publishVenue, saveSharedVenue, sendRecommendation, type ExtractedVenueItem } from '../lib/aiSave';
import { updateSavedVenue, type SavedVenue } from '../lib/supabase';
import { UserFacingError } from '../lib/openai';

type Action = 'share' | 'plan';

export function AiSaveDialog({ link, onClose, onPlan }: {
  link: string;
  onClose: () => void;
  onPlan: (venue: SavedVenue) => void;
}) {
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState<SavedVenue>();
  const [candidates, setCandidates] = useState<ExtractedVenueItem[]>([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<SavedVenue['type']>('food');
  const [queued, setQueued] = useState<Action>();
  const [editing, setEditing] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const [error, setError] = useState('');
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("Let's check this out! 🤩");
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const job = useRef<{ attempt: number; promise: ReturnType<typeof identifySharedVenue> }>();
  const swipe = useRef<number>();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    let active = true;
    if (job.current?.attempt !== attempt) job.current = { attempt, promise: identifySharedVenue(link) };
    void job.current.promise.then(result => {
      if (!active) return;
      setSaved(result.saved);
      setCandidates(result.candidates);
      const candidate = result.candidates[0];
      setName(candidate?.name ?? '');
      setAddress(candidate?.address ?? '');
      setType(candidate?.type ?? 'food');
      setEditing(!result.saved);
    }).catch(cause => {
      if (!active) return;
      setError(cause instanceof UserFacingError ? cause.message : 'Could not identify or save this venue. Try again or enter the details.');
      setEditing(true);
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [attempt, link]);

  useEffect(() => {
    if (!saved || busy || editing || queued || sharing || interacted || error) return;
    const timer = window.setTimeout(() => close.current(), 3000);
    return () => window.clearTimeout(timer);
  }, [saved, busy, editing, queued, sharing, interacted, error]);

  useEffect(() => {
    if (!saved || busy || editing || !queued) return;
    setQueued(undefined);
    if (queued === 'plan') onPlan(saved);
    else setSharing(true);
  }, [saved, busy, editing, queued, onPlan]);

  useEffect(() => {
    if (!sharing || !saved) return;
    let active = true;
    void publishVenue(saved).then(url => { if (active) setShareUrl(url); })
      .catch(() => { if (active) setError('Could not create a public link. Go back and try again.'); });
    return () => { active = false; };
  }, [sharing, saved]);

  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const venue = { name: name.trim(), address: address.trim(), type, link };
      setSaved(saved
        ? await updateSavedVenue(saved.id, { name: venue.name, address: venue.address, lat: null, lon: null })
        : await saveSharedVenue(venue, link));
      setEditing(false);
    } catch {
      setError('Could not save this venue. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setShareBusy(true);
    setError('');
    try {
      const result = await sendRecommendation(message, shareUrl);
      if (result === 'copied') setCopied(true);
    } catch {
      setError('Could not share this link. Try again.');
    } finally {
      setShareBusy(false);
    }
  };
  const choose = (action: Action) => {
    setInteracted(true);
    setQueued(action);
  };

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="isolate" onPointerDownCapture={() => setInteracted(true)}
      onKeyDownCapture={() => setInteracted(true)}>
      {busy && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full text-amber-500">
        <rect className="ai-save-trace" x="2" y="2" width="calc(100% - 4px)" height="calc(100% - 4px)" rx="15"
          pathLength="100" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="18 82" />
      </svg>}
      <div className="touch-none pr-10" onPointerDown={event => {
        swipe.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerUp={event => {
        if (swipe.current !== undefined && event.clientY - swipe.current > 60) onClose();
        swipe.current = undefined;
      }} onPointerCancel={() => { swipe.current = undefined; }}>
        <DialogTitle>{sharing ? 'Quick Share' : 'AI Save'}</DialogTitle>
        <DialogDescription aria-live="polite">{busy ? (editing ? 'Saving venue…' : 'Finding the place in your reel...') : sharing
          ? 'Recommend this venue to a friend.' : saved ? 'Saved to My Venues' : 'Confirm the venue details to continue.'}</DialogDescription>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sharing ? <>
        <p className="font-semibold">{saved?.name}</p>
        <label className="grid gap-1 text-sm">Message (optional)<Input value={message} onChange={event => setMessage(event.target.value)} /></label>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setSharing(false); setShareUrl(''); setError(''); setCopied(false); }}>Back</Button>
          <Button disabled={!shareUrl || shareBusy} onClick={() => void send()}>{copied ? 'Link copied' : 'Share recommendation'}</Button>
        </div>
      </> : editing ? <form className="grid gap-3" onSubmit={event => { event.preventDefault(); void confirm(); }}>
        {candidates.length > 1 && !saved && <label className="grid gap-1 text-sm">Places found
          <select className="rounded border bg-background p-2" onChange={event => {
            const candidate = candidates[Number(event.target.value)];
            if (candidate) { setName(candidate.name); setAddress(candidate.address); setType(candidate.type); }
          }}>
            {candidates.map((candidate, index) => <option key={index} value={index}>{candidate.name} — {candidate.address}</option>)}
          </select>
        </label>}
        <label className="grid gap-1 text-sm">Venue name<Input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">Address<Input required maxLength={500} value={address} onChange={event => setAddress(event.target.value)} /></label>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || !name.trim() || !address.trim()}>Save venue</Button>
          {!saved && <Button type="button" variant="outline" disabled={busy} onClick={() => {
            setBusy(true); setEditing(false); setError(''); retry(value => value + 1);
          }}>Retry extraction</Button>}
        </div>
      </form> : <>
        {saved && <div className="flex items-start gap-3 rounded-lg border p-3">
          {saved.photo_url && <img src={saved.photo_url} alt="" className="size-12 rounded object-cover" />}
          <div className="min-w-0 flex-1"><p className="break-words font-semibold">{saved.name}</p><p className="text-sm">{saved.address}</p></div>
          <Button variant="ghost" size="sm" onClick={() => {
            setName(saved.name); setAddress(saved.address); setEditing(true);
          }}>Edit</Button>
        </div>}
        <div className="grid grid-cols-2 gap-2">
          <Button aria-pressed={queued === 'share'} onClick={() => choose('share')}>Quick Share</Button>
          <Button variant="outline" aria-pressed={queued === 'plan'} onClick={() => choose('plan')}>Plan Event</Button>
        </div>
        {busy && queued && <p className="text-sm" role="status">{queued === 'share' ? 'Quick Share' : 'Plan Event'} will open after saving.</p>}
      </>}
    </DialogContent>
  </Dialog>;
}
