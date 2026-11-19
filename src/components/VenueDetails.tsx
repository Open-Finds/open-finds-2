import { useState } from 'react';
import { CalendarPlus, Check, Pencil, Share2, MapPin } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import { updateSavedVenue, type SavedVenue } from '../lib/supabase';
import { linkHref } from '../lib/links';
import { savedCandidate, CATEGORY_LABELS } from '../lib/planner';
import { publishVenue, sendRecommendation, shareRecommendationOrigin } from '../lib/aiSave';

export function VenueDetails({ venue, onClose, onPlan, onEdit, onSaved, owned }: {
  venue: SavedVenue; onClose: () => void; onPlan: () => void; onEdit: () => void;
  onSaved: (v: SavedVenue) => void; owned: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const candidate = savedCandidate(venue);
  const source = linkHref(venue.link);
  const share = async () => {
    if (!owned || sharing) return;
    setSharing(true);
    setError('');
    try {
      const url = shareUrl || await publishVenue({ name: venue.name, address: venue.address, type: venue.type, link: venue.link }, venue.id);
      setShareUrl(url);
      setShared(await sendRecommendation(venue.name, url) === 'copied');
    } catch {
      setError('Could not share this venue. Try again.');
    } finally {
      setSharing(false);
    }
  };
  return <Sheet open onOpenChange={(open) => !open && onClose()}><SheetContent side="bottom" className="lg:mx-auto lg:max-w-2xl"><SheetHeader><SheetTitle>{venue.name}</SheetTitle><SheetDescription>{CATEGORY_LABELS[candidate.category]} · {owned ? 'Your saved venue' : 'Shared collection venue'}</SheetDescription></SheetHeader>
    {venue.photo_url && <img src={venue.photo_url} alt="" className="mt-5 max-h-64 w-full rounded-lg object-cover" />}
    <p className="my-5 flex items-start gap-2 text-small text-muted-foreground"><MapPin size={17} className="shrink-0" />{venue.address}</p>
    {owned && venue.personal_note && <p className="mb-5 text-small">{venue.personal_note}</p>}
    {shareUrl && <input aria-label="Venue share link" readOnly value={shareUrl} className="mb-3 w-full rounded border border-input bg-background p-2 text-small" />}
    {error && <p role="alert" className="my-3 text-small text-destructive-text">{error}</p>}
    <div className="grid grid-cols-2 gap-3"><button className="btn-primary" onClick={onPlan}><CalendarPlus size={17} />Plan</button>{owned && <button className="btn-outline" onClick={share} disabled={sharing || !shareRecommendationOrigin()}><Share2 size={17} />{shared ? 'Copied' : sharing ? 'Preparing link…' : 'Quick Share'}</button>}
      {owned && <><button className="btn-outline" disabled={busy} aria-pressed={venue.visited} onClick={async () => { setBusy(true); setError(''); try { onSaved(await updateSavedVenue(venue.id, { visited: !venue.visited })); } catch { setError('Visited status could not be saved. Please try again.'); } finally { setBusy(false); } }}><Check size={17} />{busy ? 'Saving…' : venue.visited ? 'Visited' : 'Not visited'}</button><button className="btn-outline" onClick={onEdit}><Pencil size={17} />Edit</button></>}
    </div>{source && <a className="mt-5 inline-block text-small text-primary-text underline" href={source} target="_blank" rel="noopener noreferrer">Open original source</a>}
  </SheetContent></Sheet>;
}
