import { useState } from 'react';
import { MapPin, Pencil, Save, X, Plus, Tag, Folder, Check, Star, CheckCircle2, Trash2 } from 'lucide-react';
import {
  deleteSavedVenue,
  updateSavedVenue,
  updateSavedVenueCoords,
  type SavedVenue,
  type VenueType,
  type Collection,
} from '../lib/supabase';
import { geocodeAddress } from '../lib/apiKeys';

const TYPE_LABELS: Record<VenueType, string> = {
  food: 'Food',
  activity: 'Activity',
  dessert: 'Dessert',
  bar: 'Bar',
};

type Props = {
  venue: SavedVenue;
  isEditing: boolean;
  onEditStart: () => void;
  onEditEnd: () => void;
  onSaved: (updated: SavedVenue) => void;
  /** Called after the venue has been removed. Omit to hide the delete control. */
  onDeleted?: (id: string) => void;
  /** Someone else's venue in a shared collection: viewable, not editable. */
  readOnly?: boolean;
  selectable?: boolean;
  isSelected?: boolean;
  onSelect?: () => void;
  collections?: Collection[];
  venueCollectionIds?: string[];
  onToggleCollection?: (collectionId: string) => void;
};

export function SavedVenueCard({
  venue,
  isEditing,
  onEditStart,
  onEditEnd,
  onSaved,
  onDeleted,
  readOnly = false,
  selectable = false,
  isSelected = false,
  onSelect,
  collections = [],
  venueCollectionIds = [],
  onToggleCollection,
}: Props) {
  const [editName, setEditName] = useState(venue.name);
  const [editAddress, setEditAddress] = useState(venue.address);
  const [editType, setEditType] = useState<VenueType>(venue.type);
  const [editTags, setEditTags] = useState<string[]>((venue.tags ?? []).map((t) => t));
  const [tagInput, setTagInput] = useState('');
  // Two-tap delete: the first tap arms it, the second confirms. Cheap
  // protection against a mis-tap on a card full of adjacent controls.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteSavedVenue(venue.id);
      onDeleted?.(venue.id);
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };
  const [editCollection, setEditCollection] = useState(venue.collection ?? '');
  const [editNote, setEditNote] = useState(venue.personal_note ?? '');
  const [editRating, setEditRating] = useState(venue.rating ?? 0);
  const [editVisited, setEditVisited] = useState(venue.visited ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEdit = () => {
    setEditName(venue.name);
    setEditAddress(venue.address);
    setEditType(venue.type);
    setEditTags((venue.tags ?? []).map((t) => t));
    setTagInput('');
    setEditCollection(venue.collection ?? '');
    setError(null);
    onEditStart();
  };

  const handleCancel = () => {
    setEditName(venue.name);
    setEditAddress(venue.address);
    setEditType(venue.type);
    setEditTags((venue.tags ?? []).map((t) => t));
    setTagInput('');
    setEditCollection(venue.collection ?? '');
    setError(null);
    onEditEnd();
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || editTags.includes(tag)) {
      setTagInput('');
      return;
    }
    setEditTags([...editTags, tag]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter((t) => t !== tag));
  };

  const handleSave = async () => {
    if (!editName.trim() || !editAddress.trim()) {
      setError('Name and address are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateSavedVenue(venue.id, {
        name: editName.trim(),
        address: editAddress.trim(),
        type: editType,
        tags: editTags,
        collection: editCollection.trim() || null,
        personal_note: editNote.trim() || null,
        rating: editRating || null,
        visited: editVisited,
      });
      if (editAddress.trim() !== venue.address.trim()) {
        const coords = await geocodeAddress(editAddress.trim());
        if (coords) {
          await updateSavedVenueCoords(venue.id, coords.lat, coords.lon);
          updated.lat = coords.lat;
          updated.lon = coords.lon;
        } else {
          updated.lat = null;
          updated.lon = null;
        }
      }
      onSaved(updated);
      onEditEnd();
    } catch {
      setError('Failed to update venue');
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="rounded-card border border-gold/40 bg-[#1a1a1a] p-4">
        {error && (
          <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error}
          </p>
        )}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Address</label>
            <input
              type="text"
              value={editAddress}
              onChange={(e) => setEditAddress(e.target.value)}
              className="w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white focus:border-gold focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Type</label>
            <select
              value={editType}
              onChange={(e) => setEditType(e.target.value as VenueType)}
              className="w-full rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white focus:border-gold focus:outline-none [color-scheme:dark]"
            >
              <option value="food">Food</option>
              <option value="activity">Activity</option>
              <option value="dessert">Dessert</option>
              <option value="bar">Bar</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Tags</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add a tag (e.g. pho, pizza)"
                className="flex-1 rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
              />
              <button
                onClick={addTag}
                type="button"
                className="flex shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 px-3 text-gold transition-all active:scale-90"
              >
                <Plus size={16} />
              </button>
            </div>
            {editTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {editTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      type="button"
                      className="text-gold/60 transition-colors hover:text-danger"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-secondary">Personal note</label>
            <textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              rows={2}
              placeholder="What should you remember about this place?"
              className="w-full resize-none rounded-lg border border-gold/30 bg-black/50 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-gold/20 bg-black/30 px-3 py-2">
            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" checked={editVisited} onChange={(e) => setEditVisited(e.target.checked)} className="accent-gold" />
              Been here
            </label>
            <div className="flex items-center gap-1" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((value) => (
                <button key={value} type="button" onClick={() => setEditRating(editRating === value ? 0 : value)} className="p-0.5 text-gold transition-transform hover:scale-110">
                  <Star size={16} fill={value <= editRating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
          </div>
          {collections.length > 0 && onToggleCollection && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-secondary">Collections</label>
              <div className="flex flex-wrap gap-1.5">
                {collections.map((c) => {
                  const isMember = venueCollectionIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => onToggleCollection(c.id)}
                      type="button"
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all active:scale-90 ${
                        isMember
                          ? 'border-gold bg-gold/20 text-gold'
                          : 'border-gold/20 bg-black/40 text-ink-secondary hover:border-gold/40'
                      }`}
                    >
                      {isMember ? <Check size={10} /> : <Plus size={10} />}
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gold py-2.5 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-ink-secondary/40 bg-transparent py-2.5 text-sm font-medium text-ink-secondary transition-all active:scale-95 disabled:opacity-50"
          >
            <X size={16} /> Cancel
          </button>
        </div>
        {onDeleted && (
          <button
            type="button"
            onClick={handleDelete}
            onBlur={() => setConfirmDelete(false)}
            disabled={saving || deleting}
            className={`mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border py-2.5 text-sm font-medium transition-all active:scale-95 disabled:opacity-50 ${
              confirmDelete
                ? 'border-danger bg-danger/15 text-danger'
                : 'border-danger/30 bg-transparent text-danger/80 hover:bg-danger/10'
            }`}
          >
            <Trash2 size={16} />
            {deleting ? 'Removing…' : confirmDelete ? 'Tap again to remove this venue' : 'Remove venue'}
          </button>
        )}
      </div>
    );
  }

  const tags = venue.tags ?? [];
  const venueCollections = collections.filter((c) => venueCollectionIds.includes(c.id));

  return (
    <div
      onClick={selectable ? onSelect : undefined}
      className={`group relative flex items-start gap-3 rounded-card border p-4 transition-all ${
        selectable ? 'cursor-pointer active:scale-[0.98]' : ''
      } ${
        isSelected
          ? 'border-gold bg-gold/10 shadow-gold-glow'
          : 'border-gold/20 bg-[#1a1a1a] hover:border-gold/50'
      }`}
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-white">{venue.name}</h3>
        <p className="mt-1 flex items-center gap-1 text-sm text-ink-secondary">
          <MapPin size={13} className="text-gold/70" /> {venue.address}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {venue.visited && (
            <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success"><CheckCircle2 size={11} /> Visited</span>
          )}
          {venue.rating && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs text-gold"><Star size={11} fill="currentColor" /> {venue.rating}/5</span>
          )}
          {venueCollections.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 rounded-full border border-gold/40 bg-gold/15 px-2.5 py-0.5 text-xs font-bold text-gold"
            >
              <Folder size={10} /> {c.name}
            </span>
          ))}
          <span className="inline-flex items-center rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold">
            {TYPE_LABELS[venue.type as VenueType] ?? venue.type}
          </span>
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 rounded-full border border-gold/20 bg-black/40 px-2 py-0.5 text-xs text-gold/80"
            >
              <Tag size={9} className="text-gold/50" />
              {tag}
            </span>
          ))}
        </div>
        {venue.personal_note && <p className="mt-2 line-clamp-2 text-xs italic text-ink-secondary">“{venue.personal_note}”</p>}
      </div>
      {!readOnly && <button
        onClick={(e) => {
          e.stopPropagation();
          handleEdit();
        }}
        aria-label="Edit venue"
        className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full border border-gold/30 bg-black/40 text-gold transition-all hover:bg-gold/20 active:scale-90 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <Pencil size={14} />
      </button>}
      {isSelected && (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
    </div>
  );
}
