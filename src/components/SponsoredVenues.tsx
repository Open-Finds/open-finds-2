import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Coins, Globe, Loader2, MapPin, Pencil, Search, Star, Trash2 } from 'lucide-react';
import {
  fetchSponsoredVenues, recordSponsoredEvents, fetchVenueReviews, saveVenueReview, deleteVenueReview, fetchMyCredits,
  type SponsoredVenue, type VenueReview,
} from '../lib/supabase';
import { linkHref } from '../lib/links';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { CheckItOut } from './CheckItOut';
import { LoadError } from './LoadError';
import { Badge, RatingLine } from './PartnerBits';
import { TYPE_LABELS } from '../lib/partners';
import { cn } from '../lib/utils';

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/**
 * The Sponsored Venues list in Plan My Night: live venue partners, nearest
 * first when we know where you are, each with its reviews. Pick up to 3 for
 * the night; tap one to read or write reviews (a review earns a credit).
 */
export function SponsoredVenuePicker({
  selected,
  onToggle,
  origin,
}: {
  selected: Set<string>;
  onToggle: (venue: SponsoredVenue) => void;
  origin: { lat: number; lon: number } | null;
}) {
  const [venues, setVenues] = useState<SponsoredVenue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<SponsoredVenue | null>(null);

  const load = useCallback(async (countViews: boolean) => {
    setFailed(false);
    try {
      const list = await fetchSponsoredVenues();
      setVenues(list);
      if (countViews) void recordSponsoredEvents(list.map((v) => v.id), 'impression');
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  const shown = useMemo(() => {
    if (!venues) return [];
    const q = search.trim().toLowerCase();
    const list = q
      ? venues.filter((v) => selected.has(v.id) || [v.business_name, v.address, TYPE_LABELS[v.type] ?? v.type].some((f) => f.toLowerCase().includes(q)))
      : venues;
    if (!origin) return list;
    const dist = (v: SponsoredVenue) => (v.lat != null && v.lon != null ? km(origin, { lat: v.lat, lon: v.lon }) : Infinity);
    return [...list].sort((a, b) => dist(a) - dist(b));
  }, [venues, search, selected, origin]);

  if (failed) return <LoadError onRetry={() => void load(false)} />;
  if (!venues) return <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin text-muted-foreground" /></div>;
  if (venues.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-background p-8 text-center">
        <p className="text-sm font-medium text-foreground">No sponsored venues yet</p>
        <p className="mt-2 text-xs text-muted-foreground">Local businesses will appear here as they join. Stay tuned!</p>
      </div>
    );
  }

  return (
    <>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sponsored venues…"
          aria-label="Search sponsored venues"
          className="w-full rounded-md border border-input bg-card dark:bg-background py-3 pl-12 pr-4 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
        />
      </div>
      <p className="mb-3 text-xs font-medium text-foreground">{selected.size}/3 selected</p>
      {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No sponsored venues match "{search.trim()}".</p>}
      <div className="space-y-3">
        {shown.map((v) => {
          const isSelected = selected.has(v.id);
          return (
            <div
              key={v.id}
              className={cn(
                'flex w-full items-start gap-3 rounded-md border p-4 transition-all',
                isSelected ? 'border-primary bg-primary-soft' : 'border-border bg-card hover:border-input'
              )}
            >
              <button onClick={() => setOpen(v)} className="min-w-0 flex-1 text-left" aria-label={`${v.business_name}: reviews`}>
                <h3 className="truncate font-semibold text-foreground">{v.business_name}</h3>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin size={13} className="shrink-0 text-muted-foreground" /> <span className="truncate">{v.address}</span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone="gold">{TYPE_LABELS[v.type] ?? v.type}</Badge>
                  <RatingLine average={v.average_rating} count={v.review_count} />
                  <span className="font-semibold text-foreground">Reviews →</span>
                </div>
              </button>
              <button
                onClick={() => onToggle(v)}
                aria-pressed={isSelected}
                aria-label={isSelected ? `Remove ${v.business_name} from your night` : `Add ${v.business_name} to your night`}
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all active:scale-90',
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-foreground hover:bg-muted'
                )}
              >
                {isSelected ? <Check size={16} /> : <span className="text-lg leading-none">+</span>}
              </button>
            </div>
          );
        })}
      </div>
      {open && (
        <VenueReviewsDialog
          venue={open}
          onClose={() => setOpen(null)}
          onChanged={() => void load(false)}
        />
      )}
    </>
  );
}

function Stars({ value, onChange, size = 14 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role={onChange ? 'radiogroup' : undefined} aria-label={onChange ? 'Rating' : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const star = <Star size={size} className={n <= value ? 'fill-primary text-primary-text' : 'text-muted-foreground'} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`} onClick={() => onChange(n)} className="p-0.5 transition-transform active:scale-90">
            {star}
          </button>
        ) : <span key={n}>{star}</span>;
      })}
    </span>
  );
}

/** A sponsored venue's page: details, reviews, and yours. */
export function VenueReviewsDialog({ venue, onClose, onChanged }: { venue: SponsoredVenue; onClose: () => void; onChanged: () => void }) {
  const [reviews, setReviews] = useState<VenueReview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [writing, setWriting] = useState(false);
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setReviews(await fetchVenueReviews(venue.id));
    } catch {
      setFailed(true);
    }
  }, [venue.id]);
  useEffect(() => { void load(); }, [load]);

  const mine = reviews?.find((r) => r.mine) ?? null;
  const others = reviews?.filter((r) => !r.mine) ?? [];
  const count = reviews?.length ?? venue.review_count;
  const average = reviews && reviews.length > 0 ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : venue.average_rating;

  const startWriting = () => {
    setRating(mine?.rating ?? 0);
    setBody(mine?.body ?? '');
    setError(null);
    setThanks(null);
    setWriting(true);
  };

  const submit = async () => {
    if (rating < 1) { setError('Tap the stars to rate it.'); return; }
    if (body.trim().length < 10) { setError('Write at least 10 characters.'); return; }
    setSaving(true);
    setError(null);
    try {
      const isNew = !mine;
      await saveVenueReview(venue.id, rating, body.trim(), mine?.id);
      setWriting(false);
      await load();
      onChanged();
      if (isNew) {
        const credits = await fetchMyCredits().catch(() => null);
        setThanks(credits == null ? 'Thanks for your review!' : `Thanks for your review! You have ${credits} ${credits === 1 ? 'credit' : 'credits'}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post your review. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!mine) return;
    setSaving(true);
    try {
      await deleteVenueReview(mine.id);
      await load();
      onChanged();
    } catch {
      setError("Couldn't delete your review. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const website = linkHref(venue.website);
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.business_name} ${venue.address}`)}`;

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground">{venue.business_name}</DialogTitle>
          <DialogDescription className="flex items-start gap-1"><MapPin size={14} className="mt-0.5 shrink-0 text-muted-foreground" /> {venue.address}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="gold">{TYPE_LABELS[venue.type] ?? venue.type}</Badge>
          <RatingLine average={average} count={count} className="text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <CheckItOut link={venue.instagram_link} variant="pill" />
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
              <Globe size={12} /> Website
            </a>
          )}
          <a href={maps} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted">
            <MapPin size={12} /> Maps
          </a>
        </div>

        {thanks && (
          <p role="status" className="flex items-center gap-2 rounded-md border border-input bg-primary-soft px-4 py-3 text-sm text-primary-soft-foreground">
            <Coins size={16} className="shrink-0" /> {thanks}
          </p>
        )}

        {/* Your review */}
        {!venue.can_review ? (
          <p className="text-sm text-muted-foreground">You look after this venue, so you can't review it.</p>
        ) : writing ? (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="mb-2 text-sm font-semibold text-foreground">{mine ? 'Edit your review' : 'Been here? Leave a review'}</p>
            <Stars value={rating} onChange={setRating} size={26} />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="What was it like? What should people order?"
              aria-label="Your review"
              className="mt-3 w-full rounded-md border border-input bg-card dark:bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring"
            />
            {error && <p role="alert" className="mt-2 text-sm text-destructive-text">{error}</p>}
            <div className="mt-3 flex gap-2">
              <Button disabled={saving} onClick={() => void submit()} className="flex-1">
                {saving ? <Loader2 className="animate-spin" /> : <Check />} {mine ? 'Save' : 'Post review · +1 credit'}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={() => setWriting(false)}>Cancel</Button>
            </div>
          </div>
        ) : !mine ? (
          <Button full onClick={startWriting}><Star /> Write a review · earn 1 credit</Button>
        ) : null}

        {/* Reviews */}
        {failed ? (
          <LoadError onRetry={() => void load()} />
        ) : !reviews ? (
          <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : reviews.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No reviews yet. Be the first.</p>
        ) : (
          <ul className="divide-y divide-border">
            {[...(mine && !writing ? [mine] : []), ...others].map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{r.mine ? 'You' : r.name}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <Stars value={r.rating} />
                <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{r.body}</p>
                {r.mine && (
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="outline" disabled={saving} onClick={startWriting}><Pencil /> Edit</Button>
                    <Button size="sm" variant="ghost" disabled={saving} onClick={() => void remove()} className="text-destructive-text hover:bg-destructive-soft hover:text-destructive-text"><Trash2 /> Delete</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
