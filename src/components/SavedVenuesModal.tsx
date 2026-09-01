import { useState, useEffect, useCallback } from 'react';
import {
  fetchSavedVenues,
  insertSavedVenue,
  updateSavedVenueCoords,
  type SavedVenue,
  type VenueType,
} from '../lib/supabase';
import { geocodeAddress } from '../lib/apiKeys';
import { extractVenueFromLink } from '../lib/openai';
import { useAuth } from '../context/AuthContext';
import { SavedVenueCard } from './SavedVenueCard';
import {
  X,
  Link2,
  Plus,
  Lock,
  ChevronRight,
} from 'lucide-react';

export function SavedVenuesModal({
  open,
  onClose,
  onConfirm,
  selectedIds = [],
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (venues: SavedVenue[]) => void;
  selectedIds?: string[];
}) {
  const { session } = useAuth();
  const [venues, setVenues] = useState<SavedVenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedIds));
  const [showAddForm, setShowAddForm] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<VenueType>('food');
  const [collection, setCollection] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [extractedCoords, setExtractedCoords] = useState<{ lat: number; lon: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSavedVenues();
      setVenues(data);
    } catch {
      setError('Failed to load venues');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && session) {
      setSelected(new Set(selectedIds));
      setShowAddForm(false);
      setError(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= 3) return next;
      next.add(id);
      return next;
    });
  };

  const handleNext = () => {
    if (selected.size < 1) return;
    const chosen = venues.filter((v) => selected.has(v.id));
    onConfirm(chosen);
  };

  const handleExtract = async () => {
    if (!linkInput.trim()) return;
    setExtracting(true);
    setError(null);
    setExtractedCoords(null);
    try {
      const venue = await extractVenueFromLink(linkInput.trim());
      if (!venue.name && !venue.address) {
        setError("Couldn't extract — enter manually.");
      } else {
        if (venue.name) setName(venue.name);
        if (venue.address) setAddress(venue.address);
        if (venue.type) setType(venue.type);
        if (venue.tags && venue.tags.length > 0) setTags(venue.tags);
        if (venue.lat != null && venue.lon != null) {
          setExtractedCoords({ lat: venue.lat, lon: venue.lon });
        }
      }
    } catch {
      setError("Couldn't extract — enter manually.");
    } finally {
      setExtracting(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !address.trim()) {
      setError('Name and address are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await insertSavedVenue({
        name: name.trim(),
        address: address.trim(),
        type,
        link: linkInput.trim() || null,
        lat: extractedCoords?.lat ?? null,
        lon: extractedCoords?.lon ?? null,
        tags,
        collection: collection.trim() || null,
      });
      if (!extractedCoords) {
        const coords = await geocodeAddress(address.trim());
        if (coords) await updateSavedVenueCoords(saved.id, coords.lat, coords.lon);
      }
      setName('');
      setAddress('');
      setType('food');
      setCollection('');
      setTags([]);
      setLinkInput('');
      setExtractedCoords(null);
      setShowAddForm(false);
      await load();
      toggleSelect(saved.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save venue');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] max-h-[85vh] w-[640px] max-w-[90vw] flex-col overflow-hidden rounded-3xl border border-gold/20 bg-[#0d0d0d]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gold/10 p-5">
          <div>
            <h2 className="text-xl font-bold text-gold">Saved Venues</h2>
            {session && venues.length > 0 && !showAddForm && (
              <p className="mt-0.5 text-xs font-medium text-ink-secondary">
                Selected:{' '}
                <span className={selected.size > 0 ? 'text-gold' : ''}>
                  {selected.size}/3
                </span>
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-secondary transition-colors hover:text-gold"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {!session ? (
            <div className="py-10 text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-gold/30 bg-gold/10">
                <Lock size={20} className="text-gold" />
              </div>
              <p className="text-sm font-medium text-white">Sign in to use saved venues</p>
              <p className="mt-2 text-xs text-ink-secondary">
                Open the Add Venue tab to create your account.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                  {error}
                </p>
              )}

              {loading ? (
                <p className="py-8 text-center text-sm text-ink-secondary">Loading...</p>
              ) : venues.length === 0 && !showAddForm ? (
                <div className="py-8 text-center">
                  <p className="mb-4 text-sm text-ink-secondary">No saved venues yet.</p>
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="inline-flex items-center gap-2 rounded-card bg-gold px-5 py-2.5 text-sm font-bold text-black transition-all active:scale-95"
                  >
                    <Plus size={18} /> Add a Venue
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {venues.map((v) => {
                      const isSelected = selected.has(v.id);
                      return (
                        <SavedVenueCard
                          key={v.id}
                          venue={v}
                          isEditing={editingId === v.id}
                          onEditStart={() => setEditingId(v.id)}
                          onEditEnd={() => setEditingId(null)}
                          onSaved={(updated) =>
                            setVenues((prev) =>
                              prev.map((p) => (p.id === updated.id ? updated : p))
                            )
                          }
                          selectable
                          isSelected={isSelected}
                          onSelect={() => toggleSelect(v.id)}
                        />
                      );
                    })}
                  </div>

                  {!showAddForm && (
                    <button
                      onClick={() => setShowAddForm(true)}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-3 text-sm font-medium text-gold transition-all active:scale-[0.98]"
                    >
                      <Plus size={18} /> Add another venue
                    </button>
                  )}
                </>
              )}

              {/* Add venue form */}
              {showAddForm && (
                <div className="mt-4 space-y-4 border-t border-gold/10 pt-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink-secondary">
                      Paste Instagram or TikTok link
                    </label>
                    <div className="relative">
                      <Link2
                        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold"
                        size={18}
                      />
                      <input
                        type="url"
                        value={linkInput}
                        onChange={(e) => setLinkInput(e.target.value)}
                        placeholder="https://instagram.com/..."
                        className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleExtract}
                    disabled={extracting || !linkInput.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-3 text-sm font-medium text-gold transition-all active:scale-[0.98] disabled:opacity-40"
                  >
                    {extracting ? 'Extracting...' : 'Extract Venue'}
                  </button>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink-secondary">
                      Venue name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Brazico Churrasco"
                      className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink-secondary">
                      Venue address
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Suburb or full address"
                      className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink-secondary">
                      Collection <span className="text-ink-secondary/60">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={collection}
                      onChange={(e) => setCollection(e.target.value)}
                      placeholder="e.g. Bali, Sydney, Activities"
                      className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-ink-secondary">
                      Type
                    </label>
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as VenueType)}
                      className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white focus:border-gold focus:outline-none [color-scheme:dark]"
                    >
                      <option value="food">Food</option>
                      <option value="activity">Activity</option>
                      <option value="dessert">Dessert</option>
                    </select>
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:opacity-40"
                  >
                    {saving ? 'Saving...' : 'Save Venue'}
                  </button>
                  <button
                    onClick={() => setShowAddForm(false)}
                    className="w-full text-center text-sm text-ink-secondary transition-colors hover:text-gold"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-gold/10 p-5">
          <button
            onClick={handleNext}
            disabled={selected.size === 0}
            className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3.5 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
