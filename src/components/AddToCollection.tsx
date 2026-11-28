import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { addVenueToCollection, createCollection, fetchCollections, type Collection } from '../lib/supabase';

/** Puts a saved venue into one of the user's collections, or into a new one. */
export function AddToCollection({ venueId }: { venueId: string }) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [newName, setNewName] = useState('');
  const [added, setAdded] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const openList = async () => {
    setOpen(true); setError('');
    try { setCollections(await fetchCollections()); } catch { setError('Could not load your collections.'); }
  };
  const finish = (name: string) => { setAdded(name); setOpen(false); setNewName(''); };
  const addTo = async (collection: Collection) => {
    setBusy(true); setError('');
    try { await addVenueToCollection(collection.id, venueId); finish(collection.name); }
    catch { setError('Could not add it. Try again.'); }
    finally { setBusy(false); }
  };
  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true); setError('');
    try { const created = await createCollection(name); await addVenueToCollection(created.id, venueId); finish(created.name); }
    catch { setError('Could not create it. Try again.'); }
    finally { setBusy(false); }
  };

  if (added) return <p role="status" className="col-span-full self-center text-sm text-muted-foreground">Added to {added}.</p>;
  if (!open) return <Button variant="outline" onClick={() => void openList()}>Add to collection</Button>;
  return (
    <div className="col-span-full grid w-full gap-2 rounded-lg border border-border bg-card p-3">
      <p className="text-sm font-semibold">Add to which collection?</p>
      {collections.map(collection => (
        <Button key={collection.id} variant="outline" disabled={busy} onClick={() => void addTo(collection)}>{collection.name}</Button>
      ))}
      <div className="flex gap-2">
        <Input aria-label="New collection name" placeholder="New collection" maxLength={60} value={newName} onChange={event => setNewName(event.target.value)} />
        <Button variant="outline" disabled={busy || !newName.trim()} onClick={() => void createAndAdd()}>Create</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive-text">{error}</p>}
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
