import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { identifySharedVenue, publishVenue, saveSharedVenue, sendRecommendation, shareRecommendationOrigin, type ExtractedVenueItem, type SharedVenue, type SharedVenueProgress, type SharedVenueResult } from '../lib/aiSave';
import { updateSavedVenue, type SavedVenue } from '../lib/supabase';
import { UserFacingError } from '../lib/openai';
import { ProviderUnavailableError, waitText } from '../lib/providerErrors';
import { hasStreetNumber, searchGooglePlaces } from '../lib/apiKeys';
import { fallbackImage } from '../lib/publicRecommendation.js';
import { typeWithIcon } from '../lib/partners';
import { cn } from '../lib/utils';

/** What the user sees when AI Save could not run. Manual entry and saving stay available in every case. */
const serviceProblem = {
  auth: 'Please sign in again to use AI Save. You can also enter the details yourself.',
  busy: 'AI Save is busy with another request. Try again in a moment, or enter the details yourself.',
  duplicate: 'These exact details were already checked. Change something and verify again, or save them as entered.',
  limit: 'AI Save has reached its limit for now. Try again later, or enter the details yourself.',
  unavailable: 'AI Save is temporarily unavailable. Try again, or enter the details yourself.',
  attempt_expired: 'This attempt timed out. Try again to start a fresh one, or enter the details yourself.',
  attempt_limit: 'This attempt made too many requests. Try again to start a fresh one, or enter the details yourself.',
} as const;

/** A venue is verified when it is a Google place: it has the coordinates Google gave. Anything else came from the post. */
const isVerified = (venue: { lat?: number | null; lon?: number | null }) => venue.lat != null && venue.lon != null;

/** The one line under an unverified venue, in plain words. A venue with no street gets a different line. */
export function unverifiedNote(venue: { address: string }): string {
  return hasStreetNumber(venue.address)
    ? 'AI Save might not be accurate. Check the address before you go.'
    : 'AI Save found the area only. Tap Edit to add the street address.';
}

/** What a friend reads next to a shared venue that Google has not confirmed. */
export const unverifiedShareLine = 'Address not verified: check it before you go.';

export function AiSaveDialog({ link, onClose, onPlan, compact = false, initialProgress, onProgress, onSaved }: {
  link: string;
  onClose: () => void;
  onPlan: (venue: SharedVenue) => void;
  compact?: boolean;
  initialProgress?: SharedVenueProgress;
  onSaved?: () => void;
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
  /** Coordinates of a Google place the user chose from the list or a search. Cleared as soon as the text is edited by hand. */
  const [position, setPosition] = useState<{ lat: number; lon: number }>();
  const [placeQuery, setPlaceQuery] = useState('');
  const [searching, setSearching] = useState(false);
  /** The user chose "None of these match": show the details form and the search box instead of the choices. */
  const [manual, setManual] = useState(false);
  /** Which Google place is selected in the Confirm the venue list. */
  const [choice, setChoice] = useState<number>();
  /** Google places for the Confirm the venue list. Never what the AI read. */
  const [choices, setChoices] = useState<ExtractedVenueItem[]>([]);
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
      setManual(false);
      // Best match first. Preselect it unless the choices are only Google's closest results.
      setChoices(result.choices ?? []);
      const choosable = (result.choices?.length ?? 0) > 0 && (result.issue?.reason === 'ambiguous' || result.issue?.reason === 'no_match');
      setChoice(choosable && !result.issue?.weak ? 0 : undefined);
      // A search box that starts with what we know: the name we read, else the creator's handle as words.
      const handle = progress.current.identification?.metadata?.handle ?? '';
      setPlaceQuery(progress.current.candidates?.[0]?.name || handle.replace(/[._]+/g, ' ').trim());
      if (!result.issue) return;
      const { stage, cause, retryable, reason, retryAfterSeconds } = result.issue;
      // A service problem is never worded as a verdict on the venue.
      if (reason === 'testing_limit') setError(typeof retryAfterSeconds === 'number'
        ? `You've reached the testing limit. Try again in ${waitText(retryAfterSeconds)}.`
        : "You've reached the testing limit. Try again later.");
      else if (reason && reason in serviceProblem) setError(serviceProblem[reason as keyof typeof serviceProblem]);
      else if (reason === 'needs_review') setError('We found this from the link but could not confirm it automatically. Check the details, then tap Verify details.');
      // With choices to show, the Confirm the venue list says what happened; no error line is needed.
      else if (reason === 'ambiguous' || (reason === 'no_match' && result.choices?.length)) setError('');
      else if (reason === 'no_match') setError('Google Places could not match this exact venue. Search for it below, or save it as entered.');
      else if (stage === 'lookup') setError('Could not check your saved venues. Try again or enter the details.');
      else if (stage === 'verify') setError(retryable
        ? 'Place verification is temporarily unavailable. Try again or enter the details.'
        : 'Could not verify one exact venue. Check the name and location before saving.');
      else setError(cause instanceof UserFacingError
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

  /** Change location: Google places for what the user typed. Choosing one is still a separate Save. */
  const searchPlaces = async () => {
    const query = placeQuery.trim();
    if (!query || searching) return;
    setSearching(true);
    setError('');
    try {
      const found = await searchGooglePlaces(query, progress.current.attemptId);
      setCandidates(found.map((place, index) => ({
        name: place.name, address: place.address, type: place.type ?? 'food', order: index + 1, tags: [], lat: place.lat, lon: place.lon,
      })));
      if (!found.length) setError('Google Places found nothing for that search. Try another name, or save it as entered.');
    } catch (cause) {
      setError(cause instanceof ProviderUnavailableError && cause.reason in serviceProblem
        ? serviceProblem[cause.reason as keyof typeof serviceProblem]
        : 'Place search is temporarily unavailable. Try again, or enter the details yourself.');
    } finally {
      setSearching(false);
    }
  };

  /** Confirm & Save: save the Google place the user picked, with its coordinates, then show the usual actions. */
  const confirmChoice = async () => {
    const picked = choice === undefined ? undefined : choices[choice];
    if (!picked || picked.lat == null || picked.lon == null || saving) return;
    setSaving(true);
    setError('');
    try {
      const details: SharedVenue = { name: picked.name, address: picked.address, type: picked.type, link, lat: picked.lat, lon: picked.lon };
      setSaved(await saveSharedVenue(details, link));
      onSaved?.();
      setVenue(details);
      setEditing(false);
      setIssue(undefined);
      setShareUrl('');
    } catch {
      setError('Could not save this venue. Try again.');
    } finally {
      setSaving(false);
    }
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
      onSaved?.();
      // Every save, verified or not, shows the saved venue with Save, Quick Share and Create Plan.
      setVenue(details);
      setEditing(false);
      setIssue(undefined);
      setShareUrl('');
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
      // A friend is told when Google has not confirmed the address.
      const text = isVerified(venue) ? message : [message.trim(), unverifiedShareLine].filter(Boolean).join('\n');
      const result = await sendRecommendation(text, url);
      if (result === 'copied') setCopied(true);
    } catch {
      setError('Could not share this venue. Try again.');
    } finally {
      setShareBusy(false);
    }
  };

  /** Google found places that might be the venue: let the user pick instead of showing an error. */
  const choosing = !busy && !sharing && !manual && !venue && !saved && choices.length > 0 &&
    (issue?.reason === 'ambiguous' || issue?.reason === 'no_match');
  /** Only Google places are offered to pick from. What the AI read is shown in the fields, never as a choice. */
  const googlePlaces = candidates.filter(candidate => candidate.lat != null && candidate.lon != null);
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
        <DialogTitle>{sharing ? 'Quick Share' : choosing ? 'Confirm the venue' : compact ? 'AI Save or Create Plan' : 'Venue from link'}</DialogTitle>
        <DialogDescription aria-live="polite">{busy ? (issue?.stage === 'verify' ? 'Verifying venue…' : 'Finding the venue…')
          : sharing ? 'Recommend this venue to a friend.'
          : choosing ? (issue?.weak ? "We couldn't find an exact match. These are the closest Google results."
            : 'We found a few possible matches on Google Maps. Choose the correct one to save.')
          : editing ? 'Check the venue details.' : 'Choose what to do with this venue.'}</DialogDescription>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {sharing ? <>
        <div className="flex items-center gap-3 rounded-xl border bg-muted p-3">
          <img className="size-14 shrink-0 rounded-lg" src={fallbackImage} alt="" />
          <div className="min-w-0">
            <p className="break-words font-semibold">{venue?.name}</p>
            <p className="break-words text-sm">{venue?.address}</p>
            {venue && !isVerified(venue) && <p className="text-xs text-muted-foreground">{unverifiedShareLine}</p>}
            <p className="break-all text-xs text-muted-foreground">{shareRecommendationOrigin()?.replace(/^https:\/\//, '') ?? 'Public sharing is unavailable'}</p>
          </div>
        </div>
        <label className="grid gap-1 text-sm">Message (optional)<Input value={message} onChange={event => setMessage(event.target.value)} /></label>
        <div className="flex gap-2">
          <Button variant="outline" disabled={shareBusy} onClick={() => { setSharing(false); setError(''); setCopied(false); }}>Back</Button>
          <Button disabled={shareBusy || !shareRecommendationOrigin()} onClick={() => void send()}>{copied ? 'Link copied' : 'Share recommendation'}</Button>
        </div>
      </> : choosing ? <>
        <div role="radiogroup" aria-label="Possible matches" className="grid gap-2">
          {choices.map((candidate, index) => {
            const selected = choice === index;
            return <button key={index} type="button" role="radio" aria-checked={selected} onClick={() => setChoice(index)}
              className={cn('flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'border-primary bg-primary-soft' : 'border-border bg-card')}>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="break-words font-semibold">{candidate.name}</span>
                <span className="break-words text-sm">{candidate.address}</span>
                <span className="text-sm text-muted-foreground">{typeWithIcon(candidate.type)}</span>
              </span>
              <span aria-hidden="true" className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-primary' : 'border-border')}>
                {selected && <span className="size-3 rounded-full bg-primary" />}
              </span>
            </button>;
          })}
        </div>
        <div className="grid gap-2">
          <Button disabled={choice === undefined || saving} onClick={() => void confirmChoice()}>{saving ? 'Saving…' : 'Confirm & Save'}</Button>
          <Button variant="outline" disabled={saving} onClick={() => { setManual(true); setError(''); }}>None of these match</Button>
        </div>
      </> : editing ? <form className="grid gap-3" onSubmit={event => {
        event.preventDefault();
        if (validDetails && !busy && !correctionSaved) void save({
          name: name.trim(), address: address.trim(), type, link, lat: position?.lat ?? null, lon: position?.lon ?? null,
        });
      }}>
        {googlePlaces.length > 0 && !saved && <fieldset className="grid gap-2 text-sm">
          <legend className="text-label">Places found</legend>
          {googlePlaces.map((candidate, index) => {
            const chosen = position?.lat === candidate.lat && position?.lon === candidate.lon && name === candidate.name && address === candidate.address;
            return <Button key={index} type="button" variant={chosen ? 'secondary' : 'outline'} aria-pressed={chosen}
              className="h-auto justify-start whitespace-normal py-2 text-left" onClick={() => {
                setName(candidate.name); setAddress(candidate.address); setType(candidate.type);
                setPosition(candidate.lat != null && candidate.lon != null ? { lat: candidate.lat, lon: candidate.lon } : undefined);
              }}>
              <span className="grid min-w-0"><span className="break-words font-semibold">{candidate.name}</span><span className="break-words text-muted-foreground">{candidate.address}</span></span>
            </Button>;
          })}
        </fieldset>}
        <div className="grid gap-2 rounded-lg border p-3">
          <label className="grid gap-1 text-sm" htmlFor="ai-save-place-search">Change location: search Google Places</label>
          <div className="flex gap-2">
            <Input id="ai-save-place-search" autoFocus={candidates.length === 0} maxLength={200} value={placeQuery} placeholder="e.g. Sculpture by the Sea, Bondi"
              onChange={event => setPlaceQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void searchPlaces(); } }} />
            <Button type="button" variant="outline" disabled={searching || !placeQuery.trim() || saving} onClick={() => void searchPlaces()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </div>
        <label className="grid gap-1 text-sm">Venue name<Input required maxLength={200} value={name} onChange={event => { setName(event.target.value); setPosition(undefined); }} /></label>
        <label className="grid gap-1 text-sm">Address<Input required maxLength={500} value={address} onChange={event => { setAddress(event.target.value); setPosition(undefined); }} /></label>
        {position && <p className="text-sm text-muted-foreground">Location chosen from Google Places. Editing the name or address removes it.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy || saving || !validDetails || correctionSaved}>
            {correctionSaved ? 'Saved to My Venues' : saved ? 'Save changes manually' : position ? 'Save this place' : 'Save without verification'}
          </Button>
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
            {!isVerified(venue) && <p className="text-xs text-muted-foreground">{unverifiedNote(venue)}</p>}
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
