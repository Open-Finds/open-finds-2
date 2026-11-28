import { useEffect, useState } from 'react';
import { Bookmark, FolderPlus, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
import { copyVenueToLibrary, createCollection, fetchCollections, type Collection, type SavedVenue } from '../lib/supabase';

type Source = Pick<SavedVenue, 'name' | 'address' | 'type' | 'link' | 'lat' | 'lon' | 'tags' | 'photo_url'>;

/** Save someone else's venue to my venues, optionally into a collection. */
export function SaveVenueSheet({ venue, onClose, onSaved }: {
  venue: Source; onClose: () => void; onSaved: (saved: SavedVenue, existed: boolean) => void;
}) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [choice, setChoice] = useState<string>('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    fetchCollections().then((c) => { if (live) setCollections(c); }, () => { if (live) setCollections([]); });
    return () => { live = false; };
  }, []);

  const save = async () => {
    setBusy(true); setError('');
    try {
      let collectionId: string | null = choice && choice !== 'new' ? choice : null;
      if (choice === 'new') {
        if (!newName.trim()) { setError('Give the new collection a name.'); setBusy(false); return; }
        collectionId = (await createCollection(newName.trim())).id;
      }
      const { venue: saved, existed } = await copyVenueToLibrary(venue, collectionId);
      onSaved(saved, existed);
    } catch (e) {
      setError(e instanceof Error && e.message ? `Could not save: ${e.message}` : 'Could not save. Please try again.');
      setBusy(false);
    }
  };

  const option = 'flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-border px-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring';
  return (
    <Sheet open onOpenChange={(open) => !open && !busy && onClose()}>
      <SheetContent side="bottom" className="lg:mx-auto lg:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Save {venue.name}</SheetTitle>
          <SheetDescription>Add it to your venues, and to a collection if you like.</SheetDescription>
        </SheetHeader>
        <fieldset className="mt-5 space-y-2">
          <legend className="mb-2 text-label">Collection</legend>
          <label className={option}><input type="radio" name="collection" value="" checked={choice === ''} onChange={() => setChoice('')} className="accent-primary" />No collection</label>
          {collections === null
            ? <p role="status" className="flex items-center gap-2 py-2 text-small text-muted-foreground"><Loader2 size={16} className="animate-spin" />Loading your collections…</p>
            : collections.map((c) => (
              <label key={c.id} className={option}><input type="radio" name="collection" value={c.id} checked={choice === c.id} onChange={() => setChoice(c.id)} className="accent-primary" /><span className="min-w-0 truncate">{c.name}</span></label>
            ))}
          <label className={option}><input type="radio" name="collection" value="new" checked={choice === 'new'} onChange={() => setChoice('new')} className="accent-primary" /><FolderPlus size={17} aria-hidden />New collection</label>
          {choice === 'new' && (
            <div className="pl-1 pt-1">
              <label htmlFor="new-collection" className="text-label">Collection name</label>
              <input id="new-collection" className="ux-field mt-1 w-full" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Sydney cafés" autoFocus />
            </div>
          )}
        </fieldset>
        {error && <p role="alert" className="mt-3 text-small text-destructive-text">{error}</p>}
        <button type="button" className="btn-primary btn-lg mt-5 w-full" disabled={busy} onClick={save}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Bookmark size={18} />}{busy ? 'Saving…' : 'Save venue'}
        </button>
      </SheetContent>
    </Sheet>
  );
}
