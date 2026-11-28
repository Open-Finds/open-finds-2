import { ProgressBorder } from './ProgressBorder';
import { linkProgress } from '../lib/progressRing';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ImagePlus } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { identifySharedVenue, publishVenue, saveSharedVenue, sendRecommendationLink, sendRecommendationMessage, shareRecommendationOrigin, type ExtractedVenueItem, type SharedVenue, type SharedVenueProgress, type SharedVenueResult, type VenueRow } from '../lib/aiSave';
import { updateSavedVenue, type SavedVenue } from '../lib/supabase';
import { UserFacingError } from '../lib/openai';
import { ProviderUnavailableError, waitText } from '../lib/providerErrors';
import { hasStreetNumber, searchGooglePlaces } from '../lib/apiKeys';
import { quietLocation } from '../lib/geolocation';
import { readProgress, writeProgress } from '../lib/progressStore';
import { cleanVenueName, fallbackImage } from '../lib/publicRecommendation.js';
import { resolveMessage } from '../lib/shareMessage';
import { putInInbox, removeFromInbox, storedResult, type AiSaveItem } from '../lib/aiSaveInbox';
import { attemptIdFor } from '../lib/attemptId';
import { ShareMessageComposer } from './ShareMessageComposer';
import { AddToCollection } from './AddToCollection';
import { ScreenshotSaveDialog } from './ScreenshotSaveDialog';
import { MAX_SCREENSHOTS } from '../lib/aiSaveScreenshots';
import { shrinkImages } from '../lib/screenshotImages';
import { PhoneCheck } from './PhoneCheck';
import { AiSaveFeedback, type FeedbackValue } from './AiSaveFeedback';
import { captionFromShare } from '../lib/openai';
import { describeLink, foundByFrom, recordAiSaveResult, type Outcome } from '../lib/aiSaveResults';
import { typeWithIcon } from '../lib/partners';
import { UnconfirmedAddressMark } from './UnconfirmedAddressMark';
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
function unverifiedNote(venue: { address: string }): string {
  return hasStreetNumber(venue.address)
    ? 'AI Save might not be accurate. Check the address before you go.'
    : 'AI Save found the area only. Tap Edit to add the street address.';
}

/** Shown on a venue Google found that the post itself never names: the AI found it somewhere else, so it may be the wrong place. */
const notMentionedLine = "Not mentioned in the post. Check it's the right place before saving.";

function NotMentionedNote() {
  return <p className="flex items-start gap-1 text-xs text-warning">
    <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /><span>{notMentionedLine}</span>
  </p>;
}

/** What the person sharing is told when Google has not confirmed the address. The friend sees it on the venue page, not in the chat. */
const unverifiedShareLine = 'Address not verified. Your friend will be told to check it before they go.';

export function AiSaveDialog({ link, sharedText, onClose, onPlan, compact = false, initialProgress, onProgress, onSaved, onBackground, onReady, onWorking, closeRequest = 0, stored }: {
  link: string;
  /** The text that came with the link when it was shared (TikTok puts the caption beside the link). */
  sharedText?: string;
  onClose: () => void;
  onPlan: (venue: SharedVenue) => void;
  compact?: boolean;
  initialProgress?: SharedVenueProgress;
  onSaved?: () => void;
  onProgress?: (progress: SharedVenueProgress) => void;
  /** Android: put the share screen behind the other app while the search carries on. False when it cannot notify. */
  onBackground?: () => Promise<boolean>;
  /** Android: a search that was sent to the background has finished. */
  onReady?: (found: boolean) => void;
  onWorking?: (working: boolean) => void;
  /** Rises each time the phone's back button asks to close while a search is running. */
  closeRequest?: number;
  /** A result opened again from Notifications: shown as it was found, without searching again. */
  stored?: AiSaveItem;
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
  /** The optional message, as typed (venue chips still show as placeholders). Can be written while the venue is being checked. */
  const [message, setMessage] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  /** Quick Share is two steps: the message goes first on its own, then the link. */
  const [messageSent, setMessageSent] = useState(false);
  const [copied, setCopied] = useState(false);
  /** A post that names several venues: each one, to tick and save. */
  const [rows, setRows] = useState<VenueRow[]>();
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  /** In a browser, closed while still searching: out of the way until the result is ready. */
  const [hidden, setHidden] = useState(false);
  /** A line shown when closing could not carry on in the background. */
  const [notice, setNotice] = useState('');
  const background = useRef<'asking' | 'waiting' | 'refused'>();
  const working = useRef(true);
  const found = useRef(false);
  /** The person's thumbs up or down on this result (kept in a ref too, so a later write never loses it). */
  const [feedback, setFeedback] = useState<FeedbackValue>();
  const feedbackRef = useRef<FeedbackValue>();
  /** Signals that need no tap, for the success rate: the result was edited, "None of these match" was used, a caption was pasted. */
  const signals = useRef({ edited: false, none: false, pasted: false });
  const lastOutcome = useRef<{ outcome: Outcome; savedId?: string; name?: string; count: number }>();
  const dialogId = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000');
  const openedAt = useRef(Date.now());
  const shownMs = useRef<number>();
  const [savedRows, setSavedRows] = useState<Record<number, SavedVenue>>({});
  const progress = useRef<SharedVenueProgress>(initialProgress ?? stored?.progress ?? {});
  const startedAt = useRef(stored?.at ?? Date.now());
  /** Progress handed in by the caller wins over progress kept on the phone. Read once, when the dialog opens. */
  const hadInitialProgress = useRef(initialProgress !== undefined || stored?.progress !== undefined);
  const progressListener = useRef(onProgress);
  progressListener.current = onProgress;
  const job = useRef<{ attempt: number; promise: ReturnType<typeof identifySharedVenue> }>();
  const swipe = useRef<number>();
  /** When nothing could be confirmed, Google is searched once on its own so the user can tap a place instead of typing. */
  const autoSearch = useRef<(query: string) => void>();
  const autoSearched = useRef(false);
  /** Nothing could be found from the link (and the service itself was fine): offer to read screenshots instead. */
  const [offerShots, setOfferShots] = useState(false);
  /** Screenshots the user picked: read on their own screen (ScreenshotSaveDialog). */
  const [shots, setShots] = useState<{ images: string[]; count: number }>();
  const [readingShots, setReadingShots] = useState(false);
  const shotInput = useRef<HTMLInputElement>(null);
  /** The loading ring: how far the search has got (read from `progress` while busy), and whether it has finished filling. */
  const [ringStep, setRingStep] = useState(() => linkProgress(progress.current));
  const [ringFilled, setRingFilled] = useState(false);
  useEffect(() => {
    if (!busy) return;
    setRingFilled(false);
    const timer = setInterval(() => setRingStep(current => {
      const next = linkProgress(progress.current);
      return next.value === current.value && next.toward === current.toward ? current : next;
    }), 250);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    let active = true;
    if (job.current?.attempt !== attempt) {
      job.current = {
        attempt,
        promise: (async () => {
          const kept = attempt === 0 && stored?.finished ? storedResult(stored) : undefined;
          if (kept) {
            progress.current.attemptId ??= await attemptIdFor(link).catch(() => undefined);
            return kept;
          }
          // Listed under Notifications from the start, so a search that is cut off is not lost.
          void putInInbox({ link, sharedText, at: startedAt.current = Date.now(), finished: false });
          // Sharing the same link again, soon after, picks up where it stopped (the overlay closes when you switch apps).
          if (attempt === 0 && !hadInitialProgress.current) {
            const earlier = await readProgress(link);
            if (earlier) progress.current = earlier;
          }
          // The caption TikTok sent with the link, read from the phone: used when the server cannot read the post.
          if (sharedText?.trim() && !progress.current.candidates && !progress.current.identification?.sharedText) {
            progress.current.identification = { ...progress.current.identification, sharedText };
          }
          return identifySharedVenue(link, progress.current);
        })(),
      };
    }
    void job.current.promise.then(result => {
      if (!active) return;
      if (result.saved) {
        setSaved(result.saved);
        void removeFromInbox(link);
      } else {
        // It waits under Notifications until it is saved or removed.
        void putInInbox({ link, sharedText, at: startedAt.current, finished: true, result, progress: progress.current });
      }
      // A venue the post names, still to be checked, counts as found: the phone and Notifications should say so.
      found.current = !!(result.saved || result.venue || result.rows?.length || result.choices?.length
        || (result.issue?.reason === 'needs_review' && result.candidates.length));
      progressListener.current?.(progress.current);
      void writeProgress(link, progress.current);
      setRows(result.rows);
      // Venues Google confirmed, and that the post itself names, start ticked; the rest are the user's choice.
      setTicked(new Set((result.rows ?? []).flatMap((row, index) => row.verified && row.mentioned !== false && row.venue.address.trim() ? [index] : [])));
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
      // A search box that starts with the name we read, and is empty when we read none. The creator's handle is
      // who posted it, not what it is about, so it is never used to fill the box.
      setPlaceQuery(progress.current.candidates?.[0]?.name ?? '');
      // Nothing confirmed and no Google places to pick from, but the post named a venue: ask Google once, by that name and
      // whatever place the post gave, and show the results to tap. Never from the creator's handle (that finds unrelated places),
      // and never when the service itself is the problem.
      const named = progress.current.candidates?.[0];
      const serviceDown = !!result.issue?.reason && (result.issue.reason in serviceProblem || result.issue.reason === 'testing_limit');
      if (!result.venue && !result.rows && !result.saved && !result.choices?.length && named?.name && !serviceDown && !autoSearched.current) {
        autoSearched.current = true;
        const query = [named.name, named.address].filter(Boolean).join(', ');
        setPlaceQuery(query);
        autoSearch.current?.(query);
      }
      // Only when nothing at all was read: a venue the AI did read keeps its own message and the search box.
      const offer = !found.current && !serviceDown && !result.saved && !result.candidates.some(item => item.name?.trim());
      setOfferShots(offer);
      // The screenshot offer says what happened, in its own words.
      if (offer) { setError(''); return; }
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
    }).finally(() => { shownMs.current ??= Date.now() - openedAt.current; if (active) setBusy(false); });
    return () => { active = false; };
  }, [attempt, link, sharedText, stored]);

  /** The latest callbacks, for effects that must run only when the search state changes. */
  const phone = useRef({ onReady, onWorking });
  phone.current = { onReady, onWorking };
  const announce = () => {
    background.current = undefined;
    phone.current.onReady?.(found.current);
  };

  useEffect(() => {
    working.current = busy;
    phone.current.onWorking?.(busy);
    if (busy) return;
    setHidden(false);
    setNotice('');
    if (background.current === 'waiting') announce();
    else if (background.current === 'refused') background.current = undefined;
  }, [busy]);

  /** The X, the swipe down, a tap outside and the back button all close. While searching, the search carries on. */
  const close = async () => {
    if (!working.current) return onClose();
    if (!onBackground) return setHidden(true);
    if (background.current === 'asking') return;
    if (background.current === 'refused') {
      // The user chose to cancel this search.
      void removeFromInbox(link);
      return onClose();
    }
    background.current = 'asking';
    const moved = await onBackground().catch(() => false);
    if (!moved) {
      background.current = 'refused';
      setNotice('AI Save could not move to the background. Close again to cancel this search.');
      return;
    }
    background.current = 'waiting';
    // The search can finish while the phone is still asking about notifications.
    if (!working.current) announce();
  };
  const closer = useRef(close);
  closer.current = close;
  useEffect(() => {
    if (closeRequest) void closer.current();
  }, [closeRequest]);

  const retryLookup = () => {
    setBusy(true);
    setError('');
    retry(value => value + 1);
  };

  /**
   * The tags the AI read for this post (cuisine, dietary, category). They belong to the venue the post is about:
   * kept for a Google place picked for it or the same name, dropped for a venue typed in from scratch.
   */
  const readTags = (venueName: string, fromGoogle: boolean): string[] => {
    const first = progress.current.candidates?.[0];
    return first && (fromGoogle || first.name.trim().toLowerCase() === venueName.trim().toLowerCase()) ? first.tags : [];
  };

  const verifyCorrection = () => {
    progress.current = {
      checkedSaved: true,
      candidates: [{ name: name.trim(), address: address.trim(), type, order: 1, tags: readTags(name, !!position) }],
    };
    setShareUrl('');
    setIssue({ stage: 'verify', retryable: true });
    retryLookup();
  };

  /** Writes (or updates) this attempt's row for the success rate. Never blocks or fails the save. */
  const sendResult = () => {
    try {
      const last = lastOutcome.current;
      const identification = progress.current.identification;
      const { platform, postKind } = describeLink(identification?.metadata?.url || link);
      const outcome = last?.outcome ?? 'not_saved';
      const found = foundByFrom(identification?.metadata, captionFromShare(identification?.sharedText ?? sharedText), signals.current.pasted);
      void Promise.resolve(recordAiSaveResult({
        attemptId: progress.current.attemptId ?? dialogId.current,
        platform, postKind, link,
        outcome,
        foundBy: outcome === 'manual' ? 'manual' : found,
        venueName: last?.name, venueCount: last?.count ?? 1, savedVenueId: last?.savedId,
        edited: signals.current.edited, usedNoneOfThese: signals.current.none, usedPastedCaption: signals.current.pasted,
        durationMs: shownMs.current,
        ...(feedbackRef.current ?? {}),
      })).catch(() => undefined);
    } catch {
      // Tracking is never allowed to get in the way of saving a venue.
    }
  };

  const logResult = (outcome: Outcome, extra: { savedId?: string; name?: string; count?: number } = {}) => {
    lastOutcome.current = { outcome, savedId: extra.savedId, name: extra.name, count: extra.count ?? 1 };
    sendResult();
  };

  const rate = (value: FeedbackValue) => {
    feedbackRef.current = value;
    setFeedback(value);
    sendResult();
  };

  /** Set once the user types in the name or address box, so a search that finishes later leaves them alone. */
  const typed = useRef(false);

  /** Change location: Google places for what the user typed. Choosing one is still a separate Save. */
  const searchPlaces = async (automatic?: string) => {
    const query = (automatic ?? placeQuery).trim();
    if (!query || searching) return;
    setSearching(true);
    // An automatic search keeps the message already on screen; only a search the user asked for replaces it.
    if (automatic === undefined) setError('');
    try {
      // Ranked near the phone when location is already allowed (never asks), so "Boulangerie de Saigon" finds the local one.
      const found = await searchGooglePlaces(query, progress.current.attemptId, await quietLocation());
      if (found.length || automatic === undefined) {
        setCandidates(found.map((place, index) => ({
          name: place.name, address: place.address, type: place.type ?? 'food', order: index + 1, tags: [], lat: place.lat, lon: place.lon,
          venueToken: place.venueToken,
        })));
      }
      // The post names the venue but no street: when exactly one Google place has that name, fill the empty boxes
      // with it. The user still checks it and saves. Never over anything typed, and never between two branches.
      const named = progress.current.candidates?.[0];
      if (automatic !== undefined && named && !named.address.trim()) {
        const sameName = (value: string) => value.trim().toLowerCase() === named.name.trim().toLowerCase();
        const matches = found.filter(place => sameName(place.name));
        if (matches.length === 1 && !typed.current) {
          const [place] = matches;
          setName(place.name);
          setAddress(place.address);
          setType(place.type ?? named.type);
          setPosition(place.lat != null && place.lon != null ? { lat: place.lat, lon: place.lon } : undefined);
        }
      }
      if (!found.length && automatic === undefined) setError('Google Places found nothing for that search. Try another name, or save it as entered.');
    } catch (cause) {
      if (automatic === undefined) setError(cause instanceof ProviderUnavailableError && cause.reason in serviceProblem
        ? serviceProblem[cause.reason as keyof typeof serviceProblem]
        : 'Place search is temporarily unavailable. Try again, or enter the details yourself.');
    } finally {
      setSearching(false);
    }
  };
  autoSearch.current = query => { void searchPlaces(query); };

  /** Confirm & Save: save the Google place the user picked, with its coordinates, then show the usual actions. */
  const confirmChoice = async () => {
    const picked = choice === undefined ? undefined : choices[choice];
    if (!picked || picked.lat == null || picked.lon == null || saving) return;
    setSaving(true);
    setError('');
    try {
      const details: SharedVenue = {
        name: picked.name, address: picked.address, type: picked.type, link, lat: picked.lat, lon: picked.lon, tags: readTags(picked.name, true),
        venueToken: picked.venueToken,
      };
      const row = await saveSharedVenue(details, link);
      void removeFromInbox(link);
      setSaved(row);
      onSaved?.();
      logResult('chosen', { savedId: row.id, name: row.name });
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
      void removeFromInbox(link);
      setSaved(row);
      onSaved?.();
      // From the details form: a Google place picked by searching, or typed by hand. Otherwise what AI Save found.
      logResult(editing ? (position ? 'searched' : 'manual') : (isVerified(details) ? 'confirmed' : 'unconfirmed'), { savedId: row.id, name: row.name });
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

  const toggleRow = (index: number) => setTicked(current => {
    const next = new Set(current);
    if (!next.delete(index)) next.add(index);
    return next;
  });

  /** "Is this it?": the user accepts Google's closest place for a venue Google did not confirm. It becomes that place, ticked. */
  const acceptSuggestion = (index: number) => {
    const row = rows?.[index];
    const place = row?.suggestion;
    if (!rows || !row || !place) return;
    const next = [...rows];
    next[index] = {
      ...row, verified: true, suggestion: undefined,
      venue: { ...row.venue, name: place.name, address: place.address, type: place.type ?? row.venue.type, lat: place.lat, lon: place.lon, venueToken: place.venueToken },
    };
    setRows(next);
    setTicked(current => new Set(current).add(index));
  };

  /** Save every ticked venue that is not saved yet, one after another. A failure leaves that venue ticked to try again. */
  const saveSelected = async () => {
    if (!rows || saving) return;
    setSaving(true);
    setError('');
    const done: Record<number, SavedVenue> = { ...savedRows };
    let failed = 0;
    for (const index of [...ticked].sort((a, b) => a - b)) {
      if (done[index]) continue;
      try {
        done[index] = await saveSharedVenue(rows[index].venue, link);
      } catch {
        failed++;
      }
    }
    setSavedRows(done);
    if (!failed && Object.keys(done).length) void removeFromInbox(link);
    if (Object.keys(done).length > Object.keys(savedRows).length) {
      onSaved?.();
      const first = Object.values(done)[0];
      logResult('multiple', { name: first?.name, count: Object.keys(done).length, savedId: first?.id });
    }
    if (failed) setError(failed === 1 ? 'One venue could not be saved. Try again.' : `${failed} venues could not be saved. Try again.`);
    setSaving(false);
  };

  /** The message with the venue chips filled in from the verified details. */
  const outgoing = resolveMessage(message, venue);

  const startSharing = (forVenue?: SharedVenue) => {
    if (forVenue) setVenue(forVenue);
    setShareUrl('');
    setCopied(false);
    setMessageSent(false);
    setSharing(true);
    setError('');
  };

  /** Step one: the message, on its own. */
  const sendMessage = async () => {
    if (!outgoing || shareBusy) return;
    setShareBusy(true);
    setError('');
    try {
      const result = await sendRecommendationMessage(outgoing);
      if (result !== 'cancelled') setMessageSent(true);
    } catch {
      setError('Could not send the message. Try again.');
    } finally {
      setShareBusy(false);
    }
  };

  /** Step two: the link alone, so the other app shows it as a preview card. */
  const sendLink = async () => {
    if (!venue || shareBusy) return;
    setShareBusy(true);
    setError('');
    try {
      const url = shareUrl || await publishVenue(venue, undefined, { unverified: !isVerified(venue) });
      setShareUrl(url);
      const result = await sendRecommendationLink(url, cleanVenueName(venue.name));
      if (result === 'copied') setCopied(true);
    } catch {
      setError('Could not share this venue. Try again.');
    } finally {
      setShareBusy(false);
    }
  };

  /**
   * "None of these match": start the details form clean. The closest Google results were just rejected, so none of them
   * (and nothing guessed from the creator's handle) is left in the boxes. The only suggestions are the ones from the user's own search.
   */
  const noneMatch = () => {
    signals.current.none = true;
    setManual(true);
    setError('');
    setName('');
    setAddress('');
    setPosition(undefined);
    setPlaceQuery('');
    setCandidates([]);
    setChoices([]);
    setChoice(undefined);
  };

  /** Google found places that might be the venue: let the user pick instead of showing an error. */
  const choosing = !busy && !sharing && !manual && !venue && !saved && choices.length > 0 &&
    (issue?.reason === 'ambiguous' || issue?.reason === 'no_match');
  /** Only Google places are offered to pick from. What the AI read is shown in the fields, never as a choice. */
  const googlePlaces = candidates.filter(candidate => candidate.lat != null && candidate.lon != null);
  const validDetails = Boolean(name.trim() && address.trim());
  const detailsMatchSaved = !!saved && saved.name === venue?.name && saved.address === venue?.address;
  const correctionSaved = !!saved && saved.name === name.trim() && saved.address === address.trim();

  if (hidden) return <p role="status" className="pointer-events-none fixed inset-x-4 bottom-4 z-50 rounded-lg border border-border bg-popover p-3 text-center text-sm shadow-2">
    AI Save is still searching. It will open here when it's ready.
  </p>;

  if (shots) return <ScreenshotSaveDialog count={shots.count} loadImages={async () => shots.images} onClose={onClose} />;

  return <Dialog open onOpenChange={open => { if (!open) void close(); }}>
    {/* Phones close with the swipe line; the X is only for wide screens, where there is nothing to swipe. */}
    <DialogContent className="isolate focus-visible:outline-none focus-visible:ring-0" closeClassName="hidden sm:flex"
      onOpenAutoFocus={event => { event.preventDefault(); (event.target as HTMLElement).focus(); }}>
      {(busy || !ringFilled) && <ProgressBorder key={attempt} {...(busy ? ringStep : { value: 1, toward: 1 })} onFilled={() => setRingFilled(true)} />}
      <div className="touch-none" onPointerDown={event => {
        swipe.current = event.clientY;
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerUp={event => {
        if (swipe.current !== undefined && event.clientY - swipe.current > 60) void close();
        swipe.current = undefined;
      }} onPointerCancel={() => { swipe.current = undefined; }}>
        <button type="button" onClick={() => void close()}
          className="-mt-2 mb-2 grid w-full justify-items-center gap-1.5 rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:hidden">
          <span aria-hidden="true" className="h-1 w-10 rounded-full bg-muted-foreground/70" />
          <span className="text-xs text-muted-foreground">{busy ? "Swipe down to close. We'll keep searching." : 'Swipe down to close'}</span>
        </button>
        {compact && <img className="mb-4 size-8 rounded-lg" src={fallbackImage} alt="The Unsaved" />}
        <div className="sm:pr-10">
        <DialogTitle>{sharing ? 'Quick Share' : rows ? 'Venues from this link' : choosing ? 'Confirm the venue' : compact ? 'AI Save or Create Plan' : 'Venue from link'}</DialogTitle>
        <DialogDescription aria-live="polite">{busy ? (issue?.stage === 'verify' ? 'Verifying venue…' : 'Finding the venue…')
          : sharing ? 'Recommend this venue to a friend.'
          : rows ? `We found ${rows.length} venues. Tick the ones to save.`
          : choosing ? (issue?.weak ? "We couldn't find an exact match. These are the closest Google results."
            : 'We found a few possible matches on Google Maps. Choose the correct one to save.')
          : editing ? 'Check the venue details.' : 'Choose what to do with this venue.'}</DialogDescription>
        </div>
      </div>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && !sharing && <div className="grid gap-2">
        <p className="text-small text-muted-foreground">While we check the venue, write a message to send with it.</p>
        <ShareMessageComposer value={message} onChange={setMessage} />
      </div>}
      {sharing ? <>
        <ShareMessageComposer value={message} onChange={setMessage} disabled={shareBusy} />
        <div className="flex items-center gap-3 rounded-xl border bg-muted p-3">
          <img className="size-14 shrink-0 rounded-lg" src={fallbackImage} alt="" />
          <div className="min-w-0">
            <p className="break-words text-lg font-semibold">{cleanVenueName(venue?.name)}</p>
            <p className="break-words text-sm text-muted-foreground">{venue?.address}</p>
            {venue && !isVerified(venue) && <p className="text-xs text-muted-foreground">{unverifiedShareLine}</p>}
            <p className="text-xs text-muted-foreground">The Unsaved</p>
          </div>
        </div>
        <div className="grid gap-2">
          {outgoing && <Button variant="outline" disabled={shareBusy} onClick={() => void sendMessage()}>
            {messageSent ? 'Message sent. Send again' : '1. Send message'}
          </Button>}
          <Button disabled={shareBusy || !shareRecommendationOrigin()} onClick={() => void sendLink()}>
            {copied ? 'Link copied' : outgoing ? '2. Send link' : 'Send link'}
          </Button>
          <Button variant="ghost" disabled={shareBusy} onClick={() => { setSharing(false); setError(''); setCopied(false); }}>Back</Button>
        </div>
      </> : rows ? <>
        <div role="group" aria-label="Venues found" className="grid gap-2">
          {rows.map((row, index) => {
            const done = savedRows[index];
            const on = ticked.has(index) || !!done;
            const hasAddress = !!row.venue.address.trim();
            // The whole card is the tap target (not just the tick box). Quick Share sits beside it, outside the button.
            const suggestion = !done && !row.verified ? row.suggestion : undefined;
            return <div key={index} className={cn('rounded-lg border p-3', on ? 'border-primary bg-primary-soft' : 'border-border bg-card')}>
              <div className="flex items-start gap-3">
              <button type="button" role="checkbox" aria-checked={on} aria-label={`Save ${row.venue.name}`} disabled={!hasAddress || !!done || saving}
                onClick={() => toggleRow(index)}
                className="-m-3 flex min-w-0 flex-1 items-start gap-3 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold">{row.venue.name}</span>
                  <span className="flex items-start gap-1 break-words text-sm">{hasAddress && !row.verified && <UnconfirmedAddressMark />}<span>{hasAddress ? row.venue.address : 'No address found'}</span></span>
                  {!done && row.mentioned === false ? <span className="flex items-start gap-1 text-xs text-warning">
                    <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" /><span>{notMentionedLine}</span>
                  </span> : <span className="block text-xs text-muted-foreground">{done ? 'Saved to My Venues'
                    : row.verified ? 'Confirmed on Google Maps'
                    : hasAddress ? unverifiedNote(row.venue) : 'This venue cannot be saved without an address.'}</span>}
                </span>
              </button>
              {done && <Button variant="outline" size="sm" onClick={() => startSharing(row.venue)}>Quick Share</Button>}
              </div>
              {suggestion && <div className="relative mt-3 grid gap-1 rounded-md border border-border bg-background p-3">
                <p className="text-xs text-muted-foreground">Is this it? Google's closest match:</p>
                <p className="break-words text-sm font-semibold">{suggestion.name}</p>
                <p className="break-words text-sm">{suggestion.address}</p>
                <Button variant="outline" size="sm" className="mt-1 w-fit" disabled={saving} onClick={() => acceptSuggestion(index)}
                  aria-label={`Yes, use this: ${suggestion.name}`}>Yes, use this</Button>
              </div>}
            </div>;
          })}
        </div>
        <Button disabled={saving || [...ticked].filter(index => !savedRows[index]).length === 0} onClick={() => void saveSelected()}>
          {saving ? 'Saving…' : `Save selected (${[...ticked].filter(index => !savedRows[index]).length})`}
        </Button>
        <AiSaveFeedback value={feedback} onRate={rate} />
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
          <Button variant="outline" disabled={saving} onClick={() => noneMatch()}>None of these match</Button>
        </div>
      </> : editing ? <form className="grid gap-3" onSubmit={event => {
        event.preventDefault();
        if (validDetails && !busy && !correctionSaved) void save({
          name: name.trim(), address: address.trim(), type, link, lat: position?.lat ?? null, lon: position?.lon ?? null,
          tags: readTags(name, !!position),
          // Only a Google place picked above and left unedited is linked to the shared venue (editing clears position).
          venueToken: position ? googlePlaces.find(place => place.lat === position.lat && place.lon === position.lon &&
            place.name === name.trim() && place.address === address.trim())?.venueToken : undefined,
        });
      }}>
        {offerShots && !saved && <div className="grid gap-2 rounded-lg border p-3">
          <p role="alert" className="text-body">Sorry, we couldn't AI Save this. Add screenshots and we'll try again!</p>
          <Button type="button" variant="ai" className="w-fit" disabled={readingShots || saving} onClick={() => shotInput.current?.click()}>
            <ImagePlus aria-hidden="true" />{readingShots ? 'Opening screenshots…' : 'Add screenshots'}
          </Button>
          <input ref={shotInput} type="file" accept="image/*" multiple hidden data-testid="screenshot-input" onChange={event => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            if (!files.length) return;
            setReadingShots(true);
            void shrinkImages(files, MAX_SCREENSHOTS).then(images => {
              if (images.length) setShots({ images, count: files.length });
              else setError("We couldn't open those pictures. Try other screenshots.");
            }).finally(() => setReadingShots(false));
          }} />
        </div>}
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
            <Input id="ai-save-place-search" autoFocus={candidates.length === 0} maxLength={200} value={placeQuery} placeholder="Enter venue name…"
              onChange={event => setPlaceQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void searchPlaces(); } }} />
            <Button type="button" variant="outline" disabled={searching || !placeQuery.trim() || saving} onClick={() => void searchPlaces()}>
              {searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </div>
        <label className="grid gap-1 text-sm">Venue name<Input required maxLength={200} value={name} onChange={event => { typed.current = true; setName(event.target.value); setPosition(undefined); }} /></label>
        <label className="grid gap-1 text-sm">Address<Input required maxLength={500} value={address} onChange={event => { typed.current = true; setAddress(event.target.value); setPosition(undefined); }} /></label>
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
            <p className="flex items-start gap-1 text-sm">{!isVerified(venue) && <UnconfirmedAddressMark />}<span>{venue.address}</span></p>
            {candidates[0]?.address && candidates[0].address !== venue.address &&
              <p className="text-xs text-muted-foreground">Extracted address: {candidates[0].address}</p>}
            {!isVerified(venue) && <p className="text-xs text-muted-foreground">{unverifiedNote(venue)}</p>}
            {venue.mentioned === false && <NotMentionedNote />}
          </div>
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => { signals.current.edited = true; setEditing(true); setError(''); }}>Edit</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={saving || detailsMatchSaved} onClick={() => void save(venue)}>
            {saving ? 'Saving…' : detailsMatchSaved ? 'Saved to My Venues' : 'Save Venue'}
          </Button>
          <Button variant="outline" onClick={() => startSharing()}>Quick Share</Button>
          <Button variant="outline" onClick={() => onPlan(venue)}>Create Plan</Button>
          {saved && <AddToCollection venueId={saved.id} />}
        </div>
        <AiSaveFeedback value={feedback} onRate={rate} />
      </>}
      {!sharing && <PhoneCheck link={link} />}
    </DialogContent>
  </Dialog>;
}
