import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { identifySharedVenue, publishVenue, saveSharedVenue, sendRecommendation, shareRecommendationOrigin, type ExtractedVenueItem, type SharedVenue, type SharedVenueProgress, type SharedVenueResult } from '../lib/aiSave';
import { updateSavedVenue, type SavedVenue } from '../lib/supabase';
import { UserFacingError } from '../lib/openai';
import { fallbackImage } from '../lib/publicRecommendation.js';

export function AiSaveDialog({ link, onClose, onPlan, compact = false, initialProgress, onProgress }: {
  link: string;
  onClose: () => void;
  onPlan: (venue: SharedVenue) => void;
  compact?: boolean;
  initialProgress?: SharedVenueProgress;
  onProgress?: (progress: SharedVenueProgress) => void;
}) {
  const [attempt, retry] = useState(0);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedVenue>();
  const [venue, setVenue] = useState<SharedVenue>();
  const [candidates, setCandidates] = useState<ExtractedVenueItem[]>([]);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<SavedVenue['type']>('food');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [issue, setIssue] = useState<SharedVenueResult['issue']>();
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("Let's check this out! 🤩");
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const progress = useRef<SharedVenueProgress>(initialProgress ?? {});
  const progressListener = useRef(onProgress);
  progressListener.current = onProgress;
  const job = useRef<{ attempt: number; promise: ReturnType<typeof identifySharedVenue> }>();
  const swipe = useRef<number>();

  useEffect(() => {
    let active = true;
    if (job.current?.attempt !== attempt) {
      job.current = { attempt, promise: identifySharedVenue(link, progress.current) };
    }
    void job.current.promise.then(result => {
      if (!active) return;
      if (result.saved) setSaved(result.saved);
      progressListener.current?.(progress.current);
      setVenue(result.venue);
      setCandidates(result.candidates);
      const candidate = result.venue ?? result.candidates[0];
      setName(candidate?.name ?? '');
      setAddress(candidate?.address ?? '');
      setType(candidate?.type ?? 'food');
      setEditing(!result.venue);
      setIssue(result.issue);
      if (!result.issue) return;
      const { stage, cause, retryable } = result.issue;
      if (stage === 'lookup') setError('Could not check your saved venues. Try again or enter the details.');
      if (stage === 'verify') setError(retryable
        ? 'Place verification is temporarily unavailable. Try again or enter the details.'
        : 'Could not verify one exact venue. Check the name and location before saving.');
      if (stage === 'identify') setError(cause instanceof UserFacingError
        ? cause.message : 'Could not identify a venue from this link. Try again or enter the details.');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [attempt, link]);

  const retryLookup = () => {
    setBusy(true);
    setError('');
    retry(value => value + 1);
  };

  const verifyCorrection = () => {
    progress.current = {
      checkedSaved: true,
      candidates: [{ name: name.trim(), address: address.trim(), type, order: 1, tags: [] }],
    };
    setShareUrl('');
    setIssue({ stage: 'verify', retryable: true });
    retryLookup();
  };

  const save = async (details: SharedVenue) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const row = saved
        ? await updateSavedVenue(saved.id, {
          name: details.name, address: details.address, type: details.type,
          lat: details.lat ?? null, lon: details.lon ?? null,
        })
        : await saveSharedVenue(details, details.link ?? link);
      setSaved(row);
      if (editing) {
        setVenue(undefined);
        setIssue(undefined);
        setShareUrl('');
      }
    } catch {
      setError('Could not save this venue. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const send = async () => {
    if (!venue || shareBusy) return;
    setShareBusy(true);
    setError('');
    try {
      const url = shareUrl || await publishVenue(venue);
      setShareUrl(url);
      const result = await sendRecommendation(message, url);
      if (result === 'copied') setCopied(true);
    } catch {
      setError('Could not share this venue. Try again.');
    } finally {
      setShareBusy(false);
    }
  };

  const validDetails = Boolean(name.trim() && address.trim());
  const detailsMatchSaved = !!saved && saved.name === venue?.name && saved.address === venue?.address;
  const correctionSaved = !!saved && saved.name === name.trim() && saved.address === address.trim();

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="isolate">
      {compact && <img className="size-8 rounded-lg" src={fallbackImage} alt="The Unsaved" />}
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
        <DialogTitle>{sharing ? 'Quick Share' : compact ? 'AI Save or Create Plan' : 'Venue from link'}</DialogTitle>
        <DialogDescription aria-live="polite">{busy ? (issue?.stage === 'verify' ? 'Verifying venue…' : 'Finding the venue…')
          : sharing ? 'Recommend this venue to a friend.' : editing ? 'Check the venue details.' : 'Choose what to do with this venue.'}</DialogDescription>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sharing ? <>
        <div className="flex items-center gap-3 rounded-xl border bg-muted p-3">
          <img className="size-14 shrink-0 rounded-lg" src={fallbackImage} alt="" />
          <div className="min-w-0">
            <p className="break-words font-semibold">{venue?.name}</p>
            <p className="break-words text-sm">{venue?.address}</p>
            <p className="break-all text-xs text-muted-foreground">{shareRecommendationOrigin()?.replace(/^https:\/\//, '') ?? 'Public sharing is unavailable'}</p>
          </div>
        </div>
        <label className="grid gap-1 text-sm">Message (optional)<Input value={message} onChange={event => setMessage(event.target.value)} /></label>
        <div className="flex gap-2">
          <Button variant="outline" disabled={shareBusy} onClick={() => { setSharing(false); setError(''); setCopied(false); }}>Back</Button>
          <Button disabled={shareBusy || !shareRecommendationOrigin()} onClick={() => void send()}>{copied ? 'Link copied' : 'Share recommendation'}</Button>
        </div>
      </> : editing ? <form className="grid gap-3" onSubmit={event => {
        event.preventDefault();
        if (validDetails && !busy && !correctionSaved) void save({ name: name.trim(), address: address.trim(), type, link });
      }}>
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
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || saving || !validDetails || correctionSaved}>{correctionSaved ? 'Saved to My Venues' : saved ? 'Save changes' : 'Save Venue'}</Button>
          <Button type="button" variant="outline" disabled={busy || saving || !validDetails} onClick={verifyCorrection}>Verify details</Button>
          {issue?.retryable && <Button type="button" variant="outline" disabled={busy || saving} onClick={retryLookup}>
            {issue.stage === 'identify' ? 'Retry identification' : issue.stage === 'verify' ? 'Retry verification' : 'Retry lookup'}
          </Button>}
        </div>
      </form> : venue && <>
        <div className="flex items-start gap-3 rounded-lg border p-3">
          {detailsMatchSaved && saved?.photo_url && <img src={saved.photo_url} alt="" className="size-12 rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold">{venue.name}</p>
            <p className="text-sm">{venue.address}</p>
            {candidates[0]?.address && candidates[0].address !== venue.address &&
              <p className="text-xs text-muted-foreground">Extracted address: {candidates[0].address}</p>}
          </div>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setEditing(true); setError(''); }}>Edit</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving || detailsMatchSaved} onClick={() => void save(venue)}>
            {saving ? 'Saving…' : detailsMatchSaved ? 'Saved to My Venues' : 'Save Venue'}
          </Button>
          <Button variant="outline" onClick={() => { setSharing(true); setError(''); }}>Quick Share</Button>
          <Button variant="outline" onClick={() => onPlan(venue)}>Create Plan</Button>
        </div>
      </>}
    </DialogContent>
  </Dialog>;
}
