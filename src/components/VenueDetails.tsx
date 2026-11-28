import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Bookmark, BookmarkCheck, CalendarPlus, Check, LogIn, ChevronLeft, ChevronRight, ExternalLink, MapPin, Navigation, Pencil, Share2, Star, Tag,
} from 'lucide-react';
import { updateSavedVenue, type SavedVenue } from '../lib/supabase';
import { linkHref } from '../lib/links';
import { mapsDirectionsUrl } from '../lib/maps';
import { CATEGORY_EMOJI, CATEGORY_SHORT, categoryOf, tagLabel } from '../lib/taxonomy';
import { copyToClipboard } from '../lib/invite';
import { BrandWordmark } from './BrandWordmark';
import { HeaderActions } from './HeaderActions';
import { VenueThumb } from './VenueThumb';
import { SaveVenueSheet } from './SaveVenueSheet';
import type { VenueAction } from '../lib/pendingVenue';
import { sourceOf, suburbOf, venuePageUrl } from '../lib/venuePage';

const pill = 'inline-flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full px-5 text-body font-bold transition-[background-color,transform] duration-150 active:scale-[0.98] disabled:opacity-50 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const panel = 'rounded-[19px] border border-border/70 bg-card shadow-1 dark:border-border dark:shadow-none';

/**
 * A venue's own page: photo, what it is and where, the two main actions
 * (save state and Add to plan), directions, the map, the post it was saved
 * from, and more saved places like it. Full screen over the current view;
 * Back (or Escape) returns to it.
 *
 * Someone else's venue (a shared collection, or a link) offers Save instead
 * of Mark visited. Signed out, Save and Add to plan ask to log in first.
 */

export function VenueDetails({
  venue, onClose, onPlan, onEdit, onSaved, owned, related = [], onOpenVenue, unreadCount, onNotifications, onSettings,
  signedIn = true, onLoginRequired, autoSave = false, onCopied,
}: {
  venue: SavedVenue; onClose: () => void; onPlan: () => void; onEdit: () => void;
  onSaved: (v: SavedVenue) => void; owned: boolean;
  /** Other saved venues, for "You might also like". */
  related?: SavedVenue[];
  onOpenVenue?: (v: SavedVenue) => void;
  unreadCount?: number;
  onNotifications?: () => void;
  onSettings?: () => void;
  /** Signed out: Save and Add to plan call onLoginRequired instead. */
  signedIn?: boolean;
  onLoginRequired?: (action: VenueAction | null) => void;
  /** Open the Save sheet straight away (carrying on after logging in). */
  autoSave?: boolean;
  /** Someone else's venue was saved to my venues. */
  onCopied?: (saved: SavedVenue) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(autoSave && signedIn && !owned);
  const [copied, setCopied] = useState<{ venue: SavedVenue; existed: boolean } | null>(null);
  const [error, setError] = useState('');
  const [shared, setShared] = useState(false);
  const [showDock, setShowDock] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const category = categoryOf(venue);
  const source = linkHref(venue.link);
  const origin = source ? sourceOf(source) : null;
  const directions = mapsDirectionsUrl([venue.address], venue.name);
  const place = venue.lat != null && venue.lon != null ? `${venue.lat},${venue.lon}` : `${venue.name}, ${venue.address}`;
  const mapsLink = `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: place })}`;
  const area = suburbOf(venue.address);
  const tags = (venue.tags ?? []).filter((t) => !/^favourite$/i.test(t.trim()) && !t.startsWith('category:'));
  const alsoLike = [
    ...related.filter((v) => v.id !== venue.id && categoryOf(v) === category),
    ...related.filter((v) => v.id !== venue.id && categoryOf(v) !== category),
  ].slice(0, 6);

  // Back to the top when moving to another venue from "You might also like".
  useEffect(() => { scroller.current?.scrollTo?.({ top: 0 }); setError(''); setShared(false); setCopied(null); }, [venue.id]);
  const plan = () => (signedIn ? onPlan() : onLoginRequired?.('plan'));
  const startSave = () => (signedIn ? setSaveOpen(true) : onLoginRequired?.('save'));

  // The bottom bar repeats the main actions once they have scrolled away.
  const onScroll = () => {
    const root = scroller.current, target = actions.current;
    if (root && target) setShowDock(target.getBoundingClientRect().bottom < root.getBoundingClientRect().top);
  };

  const share = async () => {
    setError('');
    try {
      const url = venuePageUrl(venue.id);
      if (navigator.share) await navigator.share({ title: venue.name, text: `${venue.name}, ${suburbOf(venue.address)}`, url });
      else if (await copyToClipboard(`${venue.name}\n${url}`)) setShared(true);
      else setError('Could not copy. You can select the address above.');
    } catch (e) { if (!(e instanceof Error && e.name === 'AbortError')) setError('Sharing is unavailable in this browser.'); }
  };
  const toggleVisited = async () => {
    setBusy(true); setError('');
    try { onSaved(await updateSavedVenue(venue.id, { visited: !venue.visited })); }
    catch { setError('Visited status could not be saved. Please try again.'); }
    finally { setBusy(false); }
  };

  const mainActions = (dock = false) => (
    <div className="grid grid-cols-2 gap-3">
      {!owned && (
        <button type="button" className={`${pill} ${dock || copied ? 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/80' : 'bg-primary-gradient text-primary-foreground hover:bg-primary-gradient-hover'}`}
          disabled={!!copied} aria-pressed={copied ? true : undefined} onClick={startSave} tabIndex={dock && !showDock ? -1 : undefined}>
          {copied ? <BookmarkCheck size={22} strokeWidth={2.2} /> : <Bookmark size={22} strokeWidth={2.2} />}{copied ? 'Saved' : 'Save'}
        </button>
      )}
      {owned && (
        <button type="button" className={`${pill} ${dock || venue.visited ? 'bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/80' : 'bg-primary-gradient text-primary-foreground hover:bg-primary-gradient-hover'}`}
          disabled={busy} aria-pressed={venue.visited} onClick={toggleVisited} tabIndex={dock && !showDock ? -1 : undefined}>
          <Check size={22} strokeWidth={2.4} />{busy ? 'Saving…' : venue.visited ? 'Visited' : 'Mark visited'}
        </button>
      )}
      <button type="button" className={`${pill} bg-ai text-ai-foreground hover:bg-ai/90`} onClick={plan} tabIndex={dock && !showDock ? -1 : undefined}>
        <CalendarPlus size={22} strokeWidth={2.2} />Add to plan
      </button>
    </div>
  );

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content aria-describedby={undefined}
          onOpenAutoFocus={(e) => { e.preventDefault(); scroller.current?.focus(); }}
          className="fixed inset-0 z-50 bg-background text-foreground data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-8 motion-reduce:animate-none">
          <div ref={scroller} tabIndex={-1} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain outline-none">
            <div className="mx-auto w-full max-w-2xl px-4 pb-32 pt-[max(12px,env(safe-area-inset-top,0px))] sm:px-6">
              <header className="flex min-h-16 items-center gap-2">
                <DialogPrimitive.Close className="reference-bell shrink-0 rounded-full border border-border bg-card" aria-label="Back">
                  <ChevronLeft size={24} />
                </DialogPrimitive.Close>
                <BrandWordmark className="block w-[clamp(120px,38vw,170px)] min-w-0" />
                <span className="flex-1" />
                {!signedIn && <button type="button" onClick={() => onLoginRequired?.(null)} className="btn-outline btn-sm shrink-0 rounded-full"><LogIn size={16} />Log in</button>}
                <HeaderActions unreadCount={unreadCount}
                  onNotifications={onNotifications} onSettings={onSettings} />
              </header>

              <div className="relative mt-3 grid aspect-[16/10] place-items-center overflow-hidden rounded-[22px] bg-muted">
                <span aria-hidden className="text-6xl">{CATEGORY_EMOJI[category]}</span>
                <VenueThumb venueId={venue.id} type={venue.type} photoUrl={venue.photo_url} checked={!!venue.photo_checked_at}
                  canFetch={owned} className="absolute inset-0 size-full rounded-none" />
              </div>

              <DialogPrimitive.Title className="mt-5 text-[clamp(28px,8vw,40px)] font-extrabold leading-[1.08] tracking-[-0.03em] [overflow-wrap:anywhere]">
                {venue.name}
              </DialogPrimitive.Title>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-semibold">
                <span className="inline-flex items-center gap-1.5"><MapPin size={19} aria-hidden />{area}</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1.5"><span aria-hidden>{CATEGORY_EMOJI[category]}</span>{CATEGORY_SHORT[category]}</span>
                {owned && <button type="button" onClick={onEdit} className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-small font-semibold text-info hover:bg-info-soft"><Pencil size={16} />Edit</button>}
              </p>
              {owned && venue.personal_note && <p className="mt-3 text-body text-muted-foreground">{venue.personal_note}</p>}
              {tags.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Tags">{tags.map((t) => (
                <li key={t} className="inline-flex items-center gap-1 rounded-full bg-ai-soft px-3 py-1 text-small text-ai-soft-foreground"><Tag size={13} aria-hidden />{tagLabel(t)}</li>
              ))}</ul>}

              <div ref={actions} className="mt-6">{mainActions()}</div>
              {error && <p role="alert" className="mt-3 text-small text-destructive-text">{error}</p>}
              {copied && <p role="status" className="mt-3 rounded-md bg-success-soft px-4 py-3 text-small">{copied.existed ? 'Already in your venues' : 'Saved to your venues'}.</p>}

              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-center">
                {directions
                  ? <a href={directions} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md font-semibold hover:bg-muted"><Navigation size={19} aria-hidden />Get directions</a>
                  : <span />}
                <span aria-hidden className="h-7 bg-border" />
                <button type="button" onClick={share} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-md font-semibold hover:bg-muted"><Share2 size={19} aria-hidden />{shared ? 'Copied' : 'Share'}</button>
              </div>

              <section aria-labelledby="glance" className={`${panel} mt-4 p-4`}>
                <h2 id="glance" className="text-heading font-bold">At a glance</h2>
                <dl className={`mt-3 grid ${owned ? 'grid-cols-4' : 'grid-cols-2'} divide-x divide-border text-center`}>
                  <div className="min-w-0 px-1"><dt className="sr-only">Category</dt><dd className="flex flex-col items-center gap-1 text-small"><span aria-hidden className="text-xl">{CATEGORY_EMOJI[category]}</span>{CATEGORY_SHORT[category]}</dd></div>
                  <div className="min-w-0 px-1"><dt className="sr-only">Area</dt><dd className="flex flex-col items-center gap-1 text-small [overflow-wrap:anywhere]"><MapPin size={20} aria-hidden />{area}</dd></div>
                  {owned && <div className="min-w-0 px-1"><dt className="sr-only">Your rating</dt><dd className="flex flex-col items-center gap-1 text-small tabular-nums"><Star size={20} aria-hidden fill={venue.rating ? 'currentColor' : 'none'} />{venue.rating ? `${venue.rating}/5` : 'Not rated'}</dd></div>}
                  {owned && <div className="min-w-0 px-1"><dt className="sr-only">Visited</dt><dd className={`flex flex-col items-center gap-1 text-small ${venue.visited ? 'text-success' : ''}`}><Check size={20} aria-hidden />{venue.visited ? 'Been here' : 'Not yet'}</dd></div>}
                </dl>
              </section>

              <a href={mapsLink} target="_blank" rel="noopener noreferrer" aria-label={`View ${venue.name} on Google Maps`}
                className={`${panel} relative mt-4 block h-36 overflow-hidden`}>
                {/* Shown until (or if) Google's map loads. */}
                <span aria-hidden className="absolute inset-0 grid place-items-center bg-muted text-primary"><MapPin size={34} fill="currentColor" className="stroke-card" /></span>
                <iframe title={`Map of ${venue.name}`} src={`https://maps.google.com/maps?${new URLSearchParams({ q: place, z: '15', output: 'embed' })}`}
                  loading="lazy" tabIndex={-1} aria-hidden className="pointer-events-none relative size-full border-0" />
                <span className="absolute bottom-3 right-3 inline-flex min-h-10 items-center gap-2 rounded-full bg-card px-4 text-small font-semibold shadow-2">View on Maps<ExternalLink size={15} aria-hidden /></span>
              </a>
              <p className="mt-2 px-1 text-small text-muted-foreground">{venue.address}</p>

              {source && origin && (
                <section aria-labelledby="origin" className={`${panel} mt-4 flex items-center gap-4 p-3`}>
                  <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-md bg-muted text-3xl" aria-hidden>
                    {venue.photo_url ? <img src={venue.photo_url} alt="" referrerPolicy="no-referrer" className="size-full object-cover" /> : CATEGORY_EMOJI[category]}
                  </span>
                  <div className="min-w-0">
                    <h2 id="origin" className="text-body font-bold">Originally spotted on {origin.name}</h2>
                    <p className="text-small text-muted-foreground">{origin.video ? 'Check out the original post for more!' : 'See where you found it.'}</p>
                    <a href={source} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 text-small font-semibold hover:bg-muted">
                      {origin.video ? 'Watch reel' : 'Open link'}<ExternalLink size={15} aria-hidden />
                    </a>
                  </div>
                </section>
              )}

              {alsoLike.length > 0 && onOpenVenue && (
                <section aria-labelledby="also-like" className="mt-7">
                  <h2 id="also-like" className="text-heading font-bold">You might also like</h2>
                  <ul className="-mx-4 mt-3 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:scroll-px-6 sm:px-6">
                    {alsoLike.map((v) => {
                      const c = categoryOf(v);
                      return <li key={v.id} className="w-40 shrink-0 snap-start">
                        <button type="button" onClick={() => onOpenVenue(v)} className="block w-full text-left">
                          <span className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-lg bg-muted text-3xl">
                            <span aria-hidden>{CATEGORY_EMOJI[c]}</span>
                            <VenueThumb venueId={v.id} type={v.type} photoUrl={v.photo_url} checked canFetch={false} className="absolute inset-0 size-full rounded-none" />
                          </span>
                          <span className="mt-2 block truncate text-small font-bold">{v.name}</span>
                          <span className="flex items-center gap-1 truncate text-caption normal-case text-muted-foreground">{CATEGORY_SHORT[c]} · {suburbOf(v.address)}<ChevronRight size={12} aria-hidden /></span>
                        </button>
                      </li>;
                    })}
                  </ul>
                </section>
              )}
            </div>
          </div>

          {saveOpen && <SaveVenueSheet venue={venue} onClose={() => setSaveOpen(false)}
            onSaved={(saved, existed) => { setSaveOpen(false); setCopied({ venue: saved, existed }); onCopied?.(saved); }} />}
          <div aria-hidden={!showDock}
            className={`fixed inset-x-0 bottom-0 border-t border-border bg-background/95 px-4 pb-[calc(12px+env(safe-area-inset-bottom,0px))] pt-3 transition-transform duration-200 motion-reduce:transition-none ${showDock ? 'translate-y-0' : 'pointer-events-none translate-y-full'}`}>
            <div className="mx-auto max-w-2xl">{mainActions(true)}</div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
