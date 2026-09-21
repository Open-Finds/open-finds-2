import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Plus, X, Loader2, Check, Link2, Sparkles, Folder, FolderPlus, Trash2, Pencil, ChevronLeft, MapPin, Share2, Users, UserMinus } from 'lucide-react';
import {
  fetchSavedVenues,
  insertSavedVenue,
  updateSavedVenueCoords,
  fetchCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  addVenueToCollection,
  removeVenueFromCollection,
  fetchAllCollectionMemberships,
  fetchCollectionVenues,
  fetchCollectionMembers,
  removeCollectionMember,
  type CollectionVenue,
  type SavedVenue,
  type VenueType,
  type Collection,
} from '../lib/supabase';
import { extractVenuesFromLink, type ExtractedVenueItem } from '../lib/openai';
import { geocodeAddress } from '../lib/apiKeys';
import { navigate } from '../lib/router';
import { SavedVenueCard } from '../components/SavedVenueCard';
import { ShareCollectionModal } from '../components/ShareCollectionModal';
import { useAuth } from '../context/AuthContext';

export function VenuesPage() {
  const [venues, setVenues] = useState<SavedVenue[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [memberships, setMemberships] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dietaryFilter, setDietaryFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Collection management state
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  const { session } = useAuth();
  const myId = session?.user.id ?? null;

  /* ── Shared collections ──
     Other members' venues are not in `venues` (that list is mine, via RLS), so
     an open collection fetches its full contents through the RPC and the view
     merges them: my rows stay live and editable, theirs render read-only. */
  const [sharedVenues, setSharedVenues] = useState<CollectionVenue[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [showShare, setShowShare] = useState(false);

  const loadCollectionContents = useCallback(async (collectionId: string) => {
    try {
      const [cv, members] = await Promise.all([
        fetchCollectionVenues(collectionId),
        fetchCollectionMembers(collectionId),
      ]);
      setSharedVenues(cv);
      setMemberCount(members.length);
    } catch {
      setSharedVenues([]);
      setMemberCount(0);
    }
  }, []);

  useEffect(() => {
    if (openCollectionId) loadCollectionContents(openCollectionId);
    else { setSharedVenues([]); setMemberCount(0); }
  }, [openCollectionId, loadCollectionContents]);

  // Deep link: /venues?collection=<id> (from a notification or the Friends tab).
  useEffect(() => {
    const q = window.location.hash.split('?')[1];
    const id = q ? new URLSearchParams(q).get('collection') : null;
    if (id) setOpenCollectionId(id);
  }, []);

  // Add form state
  const [linkInput, setLinkInput] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<VenueType>('food');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [collection, setCollection] = useState('');
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [extractedItems, setExtractedItems] = useState<ExtractedVenueItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [savingMulti, setSavingMulti] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [v, c, m] = await Promise.all([
        fetchSavedVenues(),
        fetchCollections(),
        fetchAllCollectionMemberships(),
      ]);
      setVenues(v);
      setCollections(c);
      setMemberships(m);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const collectionMap = useMemo(() => {
    const map: Record<string, Collection> = {};
    for (const c of collections) map[c.id] = c;
    return map;
  }, [collections]);

  const collectionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const vid of Object.keys(memberships)) {
      for (const cid of memberships[vid]) {
        counts[cid] = (counts[cid] ?? 0) + 1;
      }
    }
    return counts;
  }, [memberships]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result: SavedVenue[] = venues;
    if (openCollectionId) {
      const mine = result.filter((v) => (memberships[v.id] ?? []).includes(openCollectionId));
      const mineIds = new Set(mine.map((v) => v.id));
      const theirs = sharedVenues.filter((v) => !mineIds.has(v.id) && v.user_id !== myId);
      result = [...mine, ...theirs];
    }
    if (dietaryFilter) {
      result = result.filter((v) => (v.tags ?? []).some((tag) => tag.toLowerCase().includes(dietaryFilter)));
    }
    if (q) {
      result = result.filter((v) => {
        const inName = v.name.toLowerCase().includes(q);
        const inAddress = v.address.toLowerCase().includes(q);
        const inTags = (v.tags ?? []).some((t) => t.toLowerCase().includes(q));
        const inCollection = (v.collection ?? '').toLowerCase().includes(q);
        return inName || inAddress || inTags || inCollection;
      });
    }
    return result;
  }, [venues, search, dietaryFilter, openCollectionId, memberships, sharedVenues, myId]);

  const resetForm = () => {
    setName('');
    setAddress('');
    setType('food');
    setTags([]);
    setTagInput('');
    setCollection('');
    setLinkInput('');
    setExtractedItems([]);
    setSelectedItems(new Set());
    setError(null);
  };

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || tags.includes(tag)) {
      setTagInput('');
      return;
    }
    setTags([...tags, tag]);
    setTagInput('');
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleCreateCollection = async () => {
    const n = newCollectionName.trim();
    if (!n) return;
    try {
      const c = await createCollection(n);
      setCollections((prev) => [c, ...prev]);
      setNewCollectionName('');
      setShowNewCollection(false);
    } catch {
      setError('Failed to create collection');
    }
  };

  const handleRenameCollection = async (id: string) => {
    const n = renameValue.trim();
    if (!n) return;
    try {
      await renameCollection(id, n);
      setCollections((prev) => prev.map((c) => (c.id === id ? { ...c, name: n } : c)));
      setRenamingId(null);
    } catch {
      setError('Failed to rename collection');
    }
  };

  const handleDeleteCollection = async (id: string) => {
    if (!window.confirm('Delete this collection? Venues will remain saved.')) return;
    try {
      await deleteCollection(id);
      setCollections((prev) => prev.filter((c) => c.id !== id));
      setMemberships((prev) => {
        const next: Record<string, string[]> = {};
        for (const vid of Object.keys(prev)) {
          next[vid] = prev[vid].filter((cid) => cid !== id);
        }
        return next;
      });
      if (openCollectionId === id) setOpenCollectionId(null);
    } catch {
      setError('Failed to delete collection');
    }
  };

  const handleToggleVenueInCollection = async (venueId: string, collectionId: string) => {
    const isMember = (memberships[venueId] ?? []).includes(collectionId);
    try {
      if (isMember) {
        await removeVenueFromCollection(collectionId, venueId);
        setMemberships((prev) => ({
          ...prev,
          [venueId]: (prev[venueId] ?? []).filter((cid) => cid !== collectionId),
        }));
      } else {
        await addVenueToCollection(collectionId, venueId);
        setMemberships((prev) => ({
          ...prev,
          [venueId]: [...(prev[venueId] ?? []), collectionId],
        }));
      }
    } catch {
      setError('Failed to update collection membership');
    }
  };

  const handleExtract = async () => {
    const link = linkInput.trim();
    if (!link) {
      setError('Paste a link first.');
      return;
    }
    setExtracting(true);
    setError(null);
    setExtractedItems([]);
    setSelectedItems(new Set());
    try {
      const items = await extractVenuesFromLink(link);
      if (items.length === 0) {
        setError(
          "Couldn't extract venue details from this link. Try pasting the venue's official page instead, or enter the details manually below."
        );
      } else if (items.length === 1) {
        const v = items[0];
        setName(v.name);
        setAddress(v.address);
        setType(v.type);
      } else {
        setExtractedItems(items);
        setSelectedItems(new Set(items.map((_, i) => i)));
      }
    } catch {
      setError("Couldn't extract venue. Please enter details manually below.");
    } finally {
      setExtracting(false);
    }
  };

  const toggleItem = (idx: number) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleSaveMulti = async () => {
    const picked = extractedItems.filter((_, i) => selectedItems.has(i));
    if (picked.length === 0) {
      setError('Select at least one venue to save.');
      return;
    }
    setSavingMulti(true);
    setError(null);
    try {
      for (const item of picked) {
        const savedVenue = await insertSavedVenue({
          name: item.name,
          address: item.address,
          type: item.type,
          link: linkInput.trim() || null,
          lat: item.lat ?? null,
          lon: item.lon ?? null,
          tags: [],
          collection: collection.trim() || null,
        });
        if (item.lat == null || item.lon == null) {
          const coords = await geocodeAddress(item.address);
          if (coords) await updateSavedVenueCoords(savedVenue.id, coords.lat, coords.lon);
        }
      }
      setSaved(true);
      setExtractedItems([]);
      setSelectedItems(new Set());
      setLinkInput('');
      setTimeout(() => setSaved(false), 2500);
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save venues');
    } finally {
      setSavingMulti(false);
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
      const savedVenue = await insertSavedVenue({
        name: name.trim(),
        address: address.trim(),
        type,
        link: linkInput.trim() || null,
        lat: null,
        lon: null,
        tags,
        collection: collection.trim() || null,
      });
      const coords = await geocodeAddress(address.trim());
      if (coords) await updateSavedVenueCoords(savedVenue.id, coords.lat, coords.lon);
      setSaved(true);
      resetForm();
      setTimeout(() => setSaved(false), 2500);
      loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save venue');
    } finally {
      setSaving(false);
    }
  };

  const hasFilters = search.trim() !== '' || dietaryFilter !== '';
  const clearFilters = () => {
    setSearch('');
    setDietaryFilter('');
  };

  const openCollection = openCollectionId ? collectionMap[openCollectionId] : null;

  return (
    <div className="min-h-screen overflow-y-auto bg-black px-6 pt-8 pb-24">
      <div className="mx-auto w-full">
        {/* Collection detail view */}
        {openCollection ? (
          <>
            <button
              onClick={() => setOpenCollectionId(null)}
              className="mb-4 flex items-center gap-1 text-gold transition-all active:scale-90"
            >
              <ChevronLeft size={24} strokeWidth={2.5} /> All venues
            </button>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Folder size={22} className="shrink-0 text-gold" />
                <h1 className="truncate text-2xl font-bold text-gold">{openCollection.name}</h1>
                <span className="text-sm text-ink-secondary">{filtered.length}</span>
                {memberCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full border border-gold/30 px-2 py-0.5 text-xs text-gold" title="Shared collection">
                    <Users size={12} /> {memberCount + 1}
                  </span>
                )}
              </div>
              {openCollection.user_id === myId ? (
                <button
                  onClick={() => setShowShare(true)}
                  className="flex items-center gap-2 rounded-card border border-gold px-4 py-2.5 text-sm font-bold text-gold transition-all active:scale-95"
                >
                  <Share2 size={16} /> Share
                </button>
              ) : (
                <button
                  onClick={async () => {
                    if (!myId) return;
                    try {
                      await removeCollectionMember(openCollectionId!, myId);
                      setOpenCollectionId(null);
                      setCollections((prev) => prev.filter((c) => c.id !== openCollectionId));
                    } catch { /* ignore */ }
                  }}
                  className="flex items-center gap-2 rounded-card border border-ink-secondary/40 px-4 py-2.5 text-sm font-medium text-ink-secondary transition-all active:scale-95"
                >
                  <UserMinus size={16} /> Leave
                </button>
              )}
              <button
                onClick={() => navigate('/trip-setup')}
                className="flex items-center gap-2 rounded-card bg-gold px-4 py-2.5 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-95"
              >
                <MapPin size={16} /> Plan a Trip
              </button>
            </div>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/50" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search in this collection..."
                className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
              />
            </div>
            <ShareCollectionModal
              collection={openCollection}
              open={showShare}
              onOpenChange={setShowShare}
              onChanged={() => loadCollectionContents(openCollection.id)}
            />
            <div className="listing-grid">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-gold/50" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-card border border-gold/10 bg-black/40 py-12 text-center">
                  <p className="text-sm text-ink-secondary">No venues in this collection yet.</p>
                </div>
              ) : (
                filtered.map((v) => (
                  <SavedVenueCard
                    key={v.id}
                    venue={v}
                    readOnly={v.user_id !== myId}
                    isEditing={editingId === v.id}
                    onEditStart={() => setEditingId(v.id)}
                    onEditEnd={() => setEditingId(null)}
                    onSaved={(updated) =>
                      setVenues((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                    }
                    onDeleted={(id) => {
                      setVenues((prev) => prev.filter((p) => p.id !== id));
                      setEditingId(null);
                    }}
                    collections={collections}
                    venueCollectionIds={memberships[v.id] ?? []}
                    onToggleCollection={(cid) => handleToggleVenueInCollection(v.id, cid)}
                  />
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gold">Venues</h1>
                <p className="mt-1 text-sm text-ink-secondary">
                  Your saved spots, searchable and filterable.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  if (!showAddForm) resetForm();
                }}
                className="flex items-center gap-2 rounded-card bg-gold px-4 py-2.5 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-95"
              >
                {showAddForm ? <X size={18} /> : <Plus size={18} />}
                {showAddForm ? 'Close' : 'Add Venue'}
              </button>
            </div>

            {saved && (
              <div className="mt-4 flex items-center gap-2 rounded-card border border-success/30 bg-success/10 px-4 py-3 text-sm font-medium text-success">
                <Check size={18} /> Venue saved!
              </div>
            )}

            {/* Add Venue Form */}
            {showAddForm && (
              <div className="mt-4 rounded-card border border-gold/20 bg-[#0d0d0d] p-5 animate-fade-in">
                {error && (
                  <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                    {error}
                  </p>
                )}

                {/* Link extraction */}
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-ink-secondary">
                    Paste a link to extract details
                  </label>
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold" size={18} />
                    <input
                      type="url"
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      placeholder="https://instagram.com/..."
                      className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={handleExtract}
                    disabled={extracting}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-2.5 text-sm font-bold text-gold transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {extracting ? (
                      <><Loader2 size={18} className="animate-spin" /> Extracting...</>
                    ) : (
                      <><Sparkles size={18} /> Extract Venue</>
                    )}
                  </button>
                </div>

                {/* Multi-venue extraction results */}
                {extractedItems.length > 1 && (
                  <div className="mb-4 rounded-card border border-gold/20 bg-black/40 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-semibold text-gold">
                        {extractedItems.length} venues found
                      </p>
                      <span className="text-xs text-ink-secondary">Tap to select</span>
                    </div>
                    <div className="space-y-2">
                      {extractedItems.map((item, idx) => {
                        const isSelected = selectedItems.has(idx);
                        return (
                          <button
                            key={idx}
                            onClick={() => toggleItem(idx)}
                            className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all active:scale-[0.98] ${
                              isSelected ? 'border-gold bg-gold/10' : 'border-gold/10 bg-black/20 opacity-60'
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-white">{item.name}</p>
                              <p className="truncate text-xs text-ink-secondary">{item.address}</p>
                            </div>
                            <div className={`flex h-5 w-5 items-center justify-center rounded border transition-all ${
                              isSelected ? 'border-gold bg-gold text-black' : 'border-gold/30 bg-transparent'
                            }`}>
                              {isSelected && <Check size={14} strokeWidth={3} />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={handleSaveMulti}
                      disabled={savingMulti || selectedItems.size === 0}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-40"
                    >
                      {savingMulti ? (
                        <><Loader2 size={18} className="animate-spin" /> Saving...</>
                      ) : (
                        <>Save {selectedItems.size > 0 ? selectedItems.size : ''} Venue{selectedItems.size === 1 ? '' : 's'}</>
                      )}
                    </button>
                  </div>
                )}

                {/* Manual entry — only show when not showing multi-venue results */}
                {extractedItems.length <= 1 && (
                  <div className="border-t border-gold/10 pt-4">
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-medium text-ink-secondary">Venue name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Brazico Churrasco"
                        className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-medium text-ink-secondary">Venue address</label>
                      <input
                        type="text"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="Suburb or full address"
                        className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-medium text-ink-secondary">Type</label>
                      <select
                        value={type}
                        onChange={(e) => setType(e.target.value as VenueType)}
                        className="w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white focus:border-gold focus:outline-none [color-scheme:dark]"
                      >
                        <option value="food">Food</option>
                        <option value="activity">Activity</option>
                        <option value="dessert">Dessert</option>
                        <option value="bar">Bar</option>
                      </select>
                    </div>
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-ink-secondary">
                        Tags <span className="text-ink-secondary/60">(optional)</span>
                      </label>
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
                          className="flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                        />
                        <button
                          onClick={addTag}
                          type="button"
                          className="flex shrink-0 items-center justify-center rounded-card border border-gold/30 bg-gold/10 px-4 text-gold transition-all active:scale-90"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {tags.map((tag) => (
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
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3.5 text-base font-bold text-black shadow-gold-glow transition-all active:scale-[0.98] disabled:opacity-40"
                    >
                      {saving ? 'Saving...' : 'Save Venue'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Collections strip */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Folder size={16} className="text-gold/70" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gold/80">Collections</h2>
                  <span className="text-xs text-ink-secondary">Group venues for a trip</span>
                </div>
                <button
                  onClick={() => setShowNewCollection(!showNewCollection)}
                  className="flex items-center gap-1 text-xs font-medium text-gold transition-all active:scale-90"
                >
                  <FolderPlus size={14} /> New
                </button>
              </div>

              {showNewCollection && (
                <div className="mb-3 flex gap-2">
                  <input
                    type="text"
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleCreateCollection();
                      }
                    }}
                    placeholder="Collection name (e.g. Bali dinners)"
                    autoFocus
                    className="flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-2.5 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
                  />
                  <button
                    onClick={handleCreateCollection}
                    disabled={!newCollectionName.trim()}
                    className="flex items-center justify-center rounded-card bg-gold px-4 py-2.5 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-40"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setShowNewCollection(false); setNewCollectionName(''); }}
                    className="flex items-center justify-center rounded-card border border-gold/30 px-3 py-2.5 text-sm text-ink-secondary transition-all active:scale-90"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {collections.length === 0 && !showNewCollection ? (
                <p className="text-xs text-ink-secondary">No collections yet. Create one to group venues for a trip.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {collections.map((c) => {
                    const count = collectionCounts[c.id] ?? 0;
                    const isRenaming = renamingId === c.id;
                    return (
                      <div
                        key={c.id}
                        className="group relative inline-flex items-center gap-1.5 rounded-full border border-gold/30 bg-black/40 px-3 py-1.5 text-xs font-medium text-gold transition-all hover:border-gold/60"
                      >
                        {isRenaming ? (
                          <>
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleRenameCollection(c.id);
                                }
                              }}
                              autoFocus
                              className="w-24 rounded border border-gold/30 bg-black/50 px-1.5 py-0.5 text-xs text-white focus:border-gold focus:outline-none"
                            />
                            <button
                              onClick={() => handleRenameCollection(c.id)}
                              className="text-gold/60 hover:text-gold"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="text-ink-secondary hover:text-danger"
                            >
                              <X size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => setOpenCollectionId(c.id)}
                              className="flex items-center gap-1"
                            >
                              {c.user_id === myId ? <Folder size={11} /> : <Users size={11} />}
                              {c.name}
                              <span className="text-ink-secondary/60">{count}</span>
                            </button>
                            {/* Rename and delete are owner-only; members see the shared icon instead. */}
                            {c.user_id === myId && (
                              <>
                                <button
                                  onClick={() => { setRenamingId(c.id); setRenameValue(c.name); }}
                                  className="ml-0.5 text-gold/40 opacity-0 transition-opacity hover:text-gold group-hover:opacity-100"
                                  aria-label="Rename collection"
                                >
                                  <Pencil size={10} />
                                </button>
                                <button
                                  onClick={() => handleDeleteCollection(c.id)}
                                  className="text-gold/40 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                                  aria-label="Delete collection"
                                >
                                  <Trash2 size={10} />
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <p className="mt-4 text-xs text-ink-secondary">Use tags such as vegan, halal, vegetarian, or gluten-free to narrow your saved spots.</p>

            {/* Search bar */}
            <div className="mt-6 relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/50" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, address, or tag..."
                className="w-full rounded-card border border-gold/20 bg-black/40 py-3 pl-12 pr-4 text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <label htmlFor="dietary-filter" className="text-sm text-ink-secondary">Dietary tag</label>
              <input
                id="dietary-filter"
                type="text"
                value={dietaryFilter}
                onChange={(e) => setDietaryFilter(e.target.value.trim().toLowerCase())}
                placeholder="e.g. vegan, halal, gluten-free"
                className="min-w-0 flex-1 rounded-card border border-gold/20 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-ink-secondary focus:border-gold focus:outline-none"
              />
            </div>

            {/* Results count */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-ink-secondary">
                {loading ? 'Loading...' : `${filtered.length} venue${filtered.length === 1 ? '' : 's'}`}
              </p>
              {hasFilters && !loading && filtered.length === 0 && (
                <button
                  onClick={clearFilters}
                  className="text-sm font-medium text-gold underline-offset-2 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Venue list */}
            <div className="listing-grid mt-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-gold/50" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-card border border-gold/10 bg-black/40 py-12 text-center">
                  {hasFilters ? (
                    <>
                      <p className="text-sm text-ink-secondary">No venues match your filters.</p>
                      <button
                        onClick={clearFilters}
                        className="mt-2 text-sm font-medium text-gold underline-offset-2 hover:underline"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-ink-secondary">No saved venues yet.</p>
                      <button
                        onClick={() => setShowAddForm(true)}
                        className="mt-2 text-sm font-medium text-gold underline-offset-2 hover:underline"
                      >
                        Add your first venue
                      </button>
                    </>
                  )}
                </div>
              ) : (
                filtered.map((v) => (
                  <SavedVenueCard
                    key={v.id}
                    venue={v}
                    isEditing={editingId === v.id}
                    onEditStart={() => setEditingId(v.id)}
                    onEditEnd={() => setEditingId(null)}
                    onSaved={(updated) =>
                      setVenues((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
                    }
                    onDeleted={(id) => {
                      setVenues((prev) => prev.filter((p) => p.id !== id));
                      setEditingId(null);
                    }}
                    collections={collections}
                    venueCollectionIds={memberships[v.id] ?? []}
                    onToggleCollection={(cid) => handleToggleVenueInCollection(v.id, cid)}
                  />
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
