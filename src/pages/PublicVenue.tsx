import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2, MapPinOff } from 'lucide-react';
import { fetchPublicVenue, fetchSavedVenue, type PublicVenue, type SavedVenue } from '../lib/supabase';
import { clearVenueAction, pendingVenueAction, rememberVenueAction, type VenueAction } from '../lib/pendingVenue';
import { VenueDetails } from '../components/VenueDetails';
import { SavedVenueCard } from '../components/SavedVenueCard';
import { BrandWordmark } from '../components/BrandWordmark';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { LoginPage } from './Login';

/** A public venue in the shape the venue page takes; nothing personal in it. */
const asVenue = (v: PublicVenue): SavedVenue => ({
  id: v.id, name: v.name, address: v.address, type: v.type, link: v.link, lat: v.lat, lon: v.lon,
  tags: v.tags ?? [], photo_url: v.photo_url, photo_checked_at: 'public',
  user_id: '', created_at: '', collection: null, visited: false, personal_note: null, rating: null,
});

/**
 * /#/venue/<id>: a venue's page from a shared link. Anyone can open it.
 * Signed out, Save or Add to plan opens the log-in screen over the page and
 * the action carries on once they're in (rememberVenueAction). Your own
 * venue opens as your full page.
 */
export function PublicVenuePage({ id, signedIn, onClose, onPlan, unreadCount, onNotifications, onSettings }: {
  id: string; signedIn: boolean; onClose: () => void;
  onPlan?: (venue: SavedVenue) => void;
  unreadCount?: number; onNotifications?: () => void; onSettings?: () => void;
}) {
  const [state, setState] = useState<'loading' | 'missing' | 'error' | 'ready'>('loading');
  const [venue, setVenue] = useState<SavedVenue | null>(null);
  const [owned, setOwned] = useState(false);
  const [login, setLogin] = useState<VenueAction | null | false>(false);
  const [editing, setEditing] = useState(false);
  const [autoSave, setAutoSave] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      const pub = await fetchPublicVenue(id);
      if (!pub) return live && setState('missing');
      const mine = signedIn && pub.is_mine ? await fetchSavedVenue(id) : null;
      if (!live) return;
      setVenue(mine ?? asVenue(pub)); setOwned(!!mine); setState('ready');
      // Carry on with what they were doing before logging in.
      const pending = signedIn ? pendingVenueAction() : null;
      if (pending?.id === id) {
        clearVenueAction();
        if (pending.action === 'save' && !mine) setAutoSave(true);
        if (pending.action === 'plan' && onPlan) onPlan(mine ?? asVenue(pub));
      }
    })().catch(() => { if (live) setState('error'); });
    return () => { live = false; };
    // onPlan is the app's own callback; re-running for it would re-plan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, signedIn, retry]);

  const askLogin = (action: VenueAction | null) => { rememberVenueAction(id, action); setLogin(action); };
  // Changed their mind: a later, unrelated log-in shouldn't bring them back here.
  const cancelLogin = () => { clearVenueAction(); setLogin(false); };

  if (state !== 'ready' || !venue) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <BrandWordmark className="block w-44" />
        {state === 'loading' ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 size={18} className="animate-spin" />Opening venue…</p>
          : <>
            <MapPinOff size={36} aria-hidden className="text-muted-foreground" />
            <h1 className="text-heading">{state === 'missing' ? 'This venue isn’t available' : 'Could not open this venue'}</h1>
            <p className="max-w-sm text-small text-muted-foreground">{state === 'missing' ? 'It may have been removed by the person who shared it.' : 'Check your connection and try again.'}</p>
            {state === 'error' && <button type="button" className="btn-outline" onClick={() => { setState('loading'); setRetry((n) => n + 1); }}>Try again</button>}
            <button type="button" className="btn-primary" onClick={onClose}>Go to The Unsaved</button>
          </>}
      </main>
    );
  }

  return (
    <>
      <VenueDetails key={`${venue.id}-${signedIn}`} venue={venue} owned={owned} signedIn={signedIn} autoSave={autoSave}
        onClose={onClose} onPlan={() => onPlan?.(venue)} onEdit={() => setEditing(true)} onSaved={setVenue}
        onLoginRequired={askLogin} unreadCount={unreadCount} onNotifications={onNotifications} onSettings={onSettings} />
      {owned && <Sheet open={editing} onOpenChange={(open) => !open && setEditing(false)}>
        <SheetContent side="bottom" className="lg:mx-auto lg:max-w-2xl">
          <SheetHeader><SheetTitle>Edit saved venue</SheetTitle><SheetDescription>Changes update your saved library.</SheetDescription></SheetHeader>
          <SavedVenueCard venue={venue} isEditing onEditStart={() => {}} onEditEnd={() => setEditing(false)} onSaved={setVenue} />
        </SheetContent>
      </Sheet>}
      {login !== false && !signedIn && (
        <DialogPrimitive.Root open onOpenChange={(open) => !open && cancelLogin()}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-scrim/60" />
            <DialogPrimitive.Content aria-describedby={undefined} className="fixed inset-0 z-[60] overflow-y-auto bg-background">
              <DialogPrimitive.Title className="mx-auto max-w-md px-5 pt-6 text-center text-body font-semibold">
                {login === 'save' ? `Log in to save ${venue.name}` : login === 'plan' ? `Log in to plan a night at ${venue.name}` : 'Log in to The Unsaved'}
              </DialogPrimitive.Title>
              <LoginPage onBack={cancelLogin} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      )}
    </>
  );
}
