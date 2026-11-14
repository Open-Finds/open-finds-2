import { tagLabel } from '../lib/taxonomy';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Plus, X, Loader2, Check, Link2, Sparkles, Folder, FolderPlus, Trash2, Pencil, ChevronLeft, MapPin, Share2, Users, UserMinus, Crown } from 'lucide-react';
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
  hasPremium,
  type CollectionVenue,
  type SavedVenue,
  type VenueType,
  type Collection,
} from '../lib/supabase';
import { sourceUrl } from '../lib/aiSave';
import { geocodeAddress } from '../lib/apiKeys';
import { navigate } from '../lib/router';
import { SavedVenueCard } from '../components/SavedVenueCard';
import { CategoryPicker } from '../components/CategoryPicker';
import { matchesTaxonomy, CATEGORY_SHORT } from '../lib/taxonomy';
import { ShareCollectionModal } from '../components/ShareCollectionModal';
import { DuplicateVenueDialog, type PendingDuplicate } from '../components/DuplicateVenueDialog';
import { findSimilarVenues } from '../lib/venueMatch';
import { useAuth } from '../context/AuthContext';
import { TRIPS_ENABLED } from '../lib/features';
import { hasCached, useCachedState } from '../lib/cache';
import { LoadError } from '../components/LoadError';
import { AddressInput } from '../components/AddressInput';
import { VenueDetails } from '../components/VenueDetails';
import { CATEGORIES, CATEGORY_LABELS } from '../lib/planner';
import { categoriesOf } from '../lib/taxonomy';

export function VenuesPage({ initialAdd = false, sharedLink, onSaveLink, saveVersion, onPlan, onPlanCollection }: {
  initialAdd?: boolean; sharedLink?: string | null; onSaveLink: (link: string) => void; saveVersion: number; onPlan?: (venue: SavedVenue) => void; onPlanCollection?: (id: string) => void;
}) {
  // Remembered between visits; the fresh copy loads behind it.
  const [venues, setVenues] = useCachedState<SavedVenue[]>('venues', []);
  const [collections, setCollections] = useCachedState<Collection[]>('venues:collections', []);
  const [memberships, setMemberships] = useCachedState<Record<string, string[]>>('venues:memberships', {});
  const [loading, setLoading] = useState(() => !hasCached('venues'));
  const [loadFailed, setLoadFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [dietaryFilter, setDietaryFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(initialAdd || !!sharedLink);
  const [detail, setDetail] = useState<SavedVenue | null>(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const sharedHandled = useRef(false);

  // Collection management state
  const [showNewCollection, setShowNewCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [openCollectionId, setOpenCollectionId] = useState<string | null>(null);
  const { session, subscriptionTier, premiumUnlocked } = useAuth();
  const myId = session?.user.id ?? null;

  /* ── Shared collections ──
     Other members' venues are not in `venues` (that list is mine, via RLS), so
     an open collection fetches its full contents through the RPC and the view
     merges them: my rows stay live and editable, theirs render read-only. */
  const [sharedVenues, setSharedVenues] = useState<CollectionVenue[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [showShare, setShowShare] = useState(false);

  /* ── Duplicate guard ──
     Before any save, look for venues the user already has that are probably
     the same place, and let them confirm. `dupPending` holds the dialog's
     contents; `dupProceed` is what to run if they choose to go ahead. */
  const [dupPending, setDupPending] = useState<PendingDuplicate[] | null>(null);
  const [dupProceed, setDupProceed] = useState<{ all: () => void; newOnly?: () => void } | null>(null);

  const closeDup = () => { setDupPending(null); setDupProceed(null); };

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
  const [linkInput, setLinkInput] = useState(sharedLink ?? '');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState<VenueType>('food');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [collection, setCollection] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadAll = useCallback(async () => {
    if (!hasCached('venues')) setLoading(true);
    setLoadFailed(false);
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
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [setVenues, setCollections, setMemberships]);

  useEffect(() => {
    loadAll();
  }, [loadAll, saveVersion]);

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
        return inName || inAddress || inTags || inCollection || matchesTaxonomy({ ...v, tags: v.tags ?? [] }, q);
      });
    }
    return result.filter((v) => categoryFilter === 'all' || categoriesOf(v).includes(categoryFilter as import("../lib/taxonomy").Category));
  }, [venues, search, dietaryFilter, openCollectionId, memberships, sharedVenues, myId, categoryFilter]);

  const resetForm = () => {
    setName('');
    setAddress('');
    setType('food');
    setTags([]);
    setTagInput('');
    setCollection('');
    setLinkInput('');
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

  const handleExtract = useCallback((incoming?: string) => {
    try {
      const link = sourceUrl((incoming ?? linkInput).trim());
      setError(null);
      onSaveLink(link);
    } catch {
      setError('Paste a valid HTTPS link first.');
    }
  }, [linkInput, onSaveLink]);
  useEffect(() => {
    if (!sharedLink || sharedHandled.current) return;
    sharedHandled.current = true;
    setShowAddForm(true);
    handleExtract(sharedLink);
  }, [sharedLink, handleExtract]);

  const handleSave = async () => {
    if (!name.trim() || !address.trim()) {
      setError('Name and address are required.');
      return;
    }
    const candidate = { name: name.trim(), address: address.trim(), link: linkInput.trim() || null };
    const matches = findSimilarVenues(candidate, venues);
    if (matches.length > 0) {
      setDupPending([{ candidate, matches }]);
      setDupProceed({ all: () => { closeDup(); void performSave(); } });
      return;
    }
    await performSave();
  };

  const performSave = async () => {
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

  /* ── Group collections: "Save to my venues" ──
     A member can copy someone else's venue into their own list. The original
     stays in the group collection; the copy carries the place and its link,
     not the other person's note, rating or visited mark. */
  const alreadyMine = (v: SavedVenue) => findSimilarVenues(v, venues).some((m) => m.confidence >= 0.9);
  const saveToMine = async (v: SavedVenue) => {
    try {
      const copy = await insertSavedVenue({
        name: v.name, address: v.address, type: v.type, link: v.link, lat: v.lat, lon: v.lon, tags: v.tags,
      });
      setVenues((prev) => [copy, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that venue');
    }
  };

  return (
    <div className="ux-page">
      {detail && <VenueDetails venue={detail} owned={detail.user_id === myId} onClose={() => setDetail(null)}
        onPlan={() => { onPlan?.(detail); setDetail(null); }} onEdit={() => { setEditingId(detail.id); setDetail(null); }}
        onSaved={(updated) => { setDetail(updated); setVenues((prev) => prev.map((v) => v.id === updated.id ? updated : v)); }} />}
      <div className="mb-5 grid grid-cols-3 gap-2 pt-12" aria-label="Venue categories"><button className={`col-span-3 min-h-11 rounded-full border px-3 text-small ${categoryFilter === 'all' ? 'border-primary bg-primary-soft text-primary-text' : 'border-border'}`} onClick={() => setCategoryFilter('all')}>All venues</button>{CATEGORIES.map((c) => <button key={c} aria-pressed={categoryFilter === c} className={`min-h-11 rounded-full border px-3 text-small ${categoryFilter === c ? 'border-primary bg-primary-soft text-primary-text' : 'border-border'}`} onClick={() => setCategoryFilter(c)} aria-label={CATEGORY_LABELS[c]}>{CATEGORY_SHORT[c]}</button>)}</div>
      <DuplicateVenueDialog
        pending={dupPending}
        onAddAnyway={() => dupProceed?.all()}
        onSkipDuplicates={dupProceed?.newOnly}
        onCancel={closeDup}
      />
      <div className="mx-auto w-full">
        {/* Collection detail view */}
        {openCollection ? (
          <>
            <button
              onClick={() => setOpenCollectionId(null)}
              aria-label="Back to all venues"
              className="-ml-2 mb-2 flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted active:scale-95"
            >
              <ChevronLeft size={28} strokeWidth={2.5} />
            </button>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-2">
                <Folder size={22} className="shrink-0 text-primary-text" />
                <h1 className="truncate text-title text-foreground">{openCollection.name}</h1>
                <span className="text-sm text-muted-foreground">{filtered.length}</span>
                {memberCount > 0 && (
                  <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-foreground" title="Shared collection">
                    <Users size={12} /> {memberCount + 1}
                  </span>
                )}
              </div>
              {openCollection.user_id === myId ? (
                <button
                  onClick={() => setShowShare(true)}
                  className="flex items-center gap-2 rounded-md border border-primary px-4 py-2.5 text-sm font-bold text-primary-text transition-all active:scale-95"
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
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all active:scale-95"
                >
                  <UserMinus size={16} /> Leave
                </button>
              )}
              {TRIPS_ENABLED && <button
                onClick={() => navigate(hasPremium(subscriptionTier, premiumUnlocked) ? `/trip-setup?collection=${openCollectionId}` : '/subscription')}
                className="btn-secondary btn-sm"
              >
                <MapPin size={16} /> Plan a Trip <Crown size={13} aria-label="Premium" />
              </button>}
            </div>
            <button className="btn-primary mb-5 w-full" onClick={() => onPlanCollection?.(openCollection.id)} disabled={!onPlanCollection}><Plus size={16} />Plan from this collection</button>
            <div className="relative mb-4">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search in this collection..."
                className="w-full rounded-md border border-input bg-card dark:bg-background py-3 pl-12 pr-4 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
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
                  <Loader2 size={24} className="animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="rounded-md border border-border bg-background py-12 text-center">
                  <p className="text-sm text-muted-foreground">No venues in this collection yet.</p>
                </div>
              ) : (
                filtered.map((v) => (
                  <SavedVenueCard
                    onOpen={() => setDetail(v)}
                    key={v.id}
                    venue={v}
                    readOnly={v.user_id !== myId}
                    onSaveToMine={() => saveToMine(v)}
                    savedToMine={v.user_id !== myId && alreadyMine(v)}
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
            <div className="flex items-center justify-between gap-3">
              <div>
                <h1 className="text-title text-foreground">Saved Venues</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Your saved spots, searchable and filterable.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  if (!showAddForm) resetForm();
                }}
                className={`${showAddForm ? 'btn-outline' : 'btn-primary'} btn-sm shrink-0`}
              >
                {showAddForm ? <X size={18} /> : <Plus size={18} />}
                {showAddForm ? 'Close' : 'Save Venues'}
              </button>
            </div>

            {saved && (
              <div className="mt-4 flex items-center gap-2 rounded-md border border-success/30 bg-success-soft px-4 py-3 text-sm font-medium text-success">
                <Check size={18} /> Venue saved!
              </div>
            )}

            {/* Add Venue Form */}
            {showAddForm && (
              <div className="mt-4 rounded-lg border border-border bg-card p-5 animate-fade-in">
                {error && (
                  <p className="mb-4 rounded-xl border border-destructive-text/30 bg-destructive-soft px-4 py-3 text-sm text-destructive-text">
                    {error}
                  </p>
                )}

                {/* Link extraction */}
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-muted-foreground">
                    Paste a social or venue link
                  </label>
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
                    <input
                      type="url"
                      value={linkInput}
                      onChange={(e) => setLinkInput(e.target.value)}
                      placeholder="https://instagram.com/..."
                      className="w-full rounded-md border border-input bg-card dark:bg-background py-3 pl-12 pr-4 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => handleExtract()}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background py-2.5 text-sm font-medium text-foreground transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    <Sparkles size={18} />Save Venues
                  </button>
                </div>

                <div className="border-t border-border pt-4">
                    <p className="mb-3 text-sm text-muted-foreground">Or enter the venue manually</p>
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Venue name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Brazico Churrasco"
                        className="w-full rounded-md border border-input bg-card dark:bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Venue address</label>
                      <AddressInput
                        value={address}
                        onChange={setAddress}
                        placeholder="Start typing an address or venue"
                        ariaLabel="Venue address"
                        className="w-full rounded-md border border-input bg-card dark:bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                      />
                    </div>
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-medium text-muted-foreground">Type</label>
                      <CategoryPicker type={type} tags={tags} onChange={(value) => { setType(value.type); setTags(value.tags); }} />
                    </div>
                    <div className="mb-4">
                      <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
                        Tags <span className="text-muted-foreground">(optional)</span>
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
                          className="flex-1 rounded-md border border-input bg-card dark:bg-background px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                        />
                        <button
                          onClick={addTag}
                          type="button"
                          aria-label="Add tag"
                          className="btn-add px-4"
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                      {tags.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 rounded-full bg-ai-soft px-2.5 py-1 text-xs font-medium text-ai-soft-foreground"
                            >
                              {tagLabel(tag)}
                              <button
                                onClick={() => removeTag(tag)}
                                type="button"
                                className="text-muted-foreground transition-colors hover:text-destructive-text"
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
                      className="btn-primary btn-lg w-full"
                    >
                      {saving ? 'Saving...' : 'Save manually'}
                    </button>
                </div>
              </div>
            )}

            {/* Collections strip */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Folder size={16} className="text-muted-foreground" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Collections</h2>
                </div>
                <button
                  onClick={() => setShowNewCollection(!showNewCollection)}
                  className="btn-add h-9 px-3 text-sm font-medium"
                >
                  <FolderPlus size={16} /> New
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
                    className="flex-1 rounded-md border border-input bg-card dark:bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
                  />
                  <button
                    onClick={handleCreateCollection}
                    disabled={!newCollectionName.trim()}
                    className="btn-secondary btn-sm"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setShowNewCollection(false); setNewCollectionName(''); }}
                    className="flex items-center justify-center rounded-md border border-border px-3 py-2.5 text-sm text-muted-foreground transition-all active:scale-90"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {collections.length === 0 && !showNewCollection ? (
                <p className="text-xs text-muted-foreground">No collections yet. Tap New to start one.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {collections.map((c) => {
                    const count = collectionCounts[c.id] ?? 0;
                    const isRenaming = renamingId === c.id;
                    return (
                      <div
                        key={c.id}
                        className="group relative inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-all hover:border-input"
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
                              className="w-24 rounded border border-input bg-card dark:bg-background px-1.5 py-0.5 text-xs text-foreground focus:border-ring focus:outline-none"
                            />
                            <button
                              onClick={() => handleRenameCollection(c.id)}
                              className="text-muted-foreground hover:text-primary-text"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              onClick={() => setRenamingId(null)}
                              className="text-muted-foreground hover:text-destructive-text"
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
                              {c.user_id === myId ? <Folder size={11} className="text-primary-text" /> : <Users size={11} className="text-primary-text" />}
                              {c.name}
                              <span className="text-muted-foreground">{count}</span>
                            </button>
                            {/* Rename and delete are owner-only; members see the shared icon instead. */}
                            {c.user_id === myId && (
                              <>
                                <button
                                  onClick={() => { setRenamingId(c.id); setRenameValue(c.name); }}
                                  className="ml-0.5 text-accent-highlight transition-opacity hover:text-accent-highlight/80 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                                  aria-label="Rename collection"
                                >
                                  <Pencil size={10} />
                                </button>
                                <button
                                  onClick={() => handleDeleteCollection(c.id)}
                                  className="text-muted-foreground transition-opacity hover:text-destructive-text sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
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

            <p className="mt-4 text-xs text-muted-foreground">Use tags such as vegan, halal, vegetarian, or gluten-free to narrow your saved spots.</p>

            {/* Search bar */}
            <div className="mt-6 relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, address, or tag..."
                className="w-full rounded-md border border-input bg-card dark:bg-background py-3 pl-12 pr-4 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              />
            </div>
            <div className="mt-3 flex items-center gap-3">
              <label htmlFor="dietary-filter" className="text-sm text-muted-foreground">Dietary tag</label>
              <input
                id="dietary-filter"
                type="text"
                value={dietaryFilter}
                onChange={(e) => setDietaryFilter(e.target.value.trim().toLowerCase())}
                placeholder="e.g. vegan, halal, gluten-free"
                className="min-w-0 flex-1 rounded-md border border-input bg-card dark:bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none"
              />
            </div>

            {/* Results count */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {loading ? 'Loading...' : `${filtered.length} venue${filtered.length === 1 ? '' : 's'}`}
              </p>
              {hasFilters && !loading && filtered.length === 0 && (
                <button
                  onClick={clearFilters}
                  className="text-sm font-medium text-info underline-offset-2 hover:underline"
                >
                  Clear filters
                </button>
              )}
            </div>

            {/* Venue list */}
            <div className="listing-grid mt-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-muted-foreground" />
                </div>
              ) : loadFailed && venues.length === 0 ? (
                <LoadError onRetry={loadAll} />
              ) : filtered.length === 0 ? (
                <div className="rounded-md border border-border bg-background py-12 text-center">
                  {hasFilters ? (
                    <>
                      <p className="text-sm text-muted-foreground">No venues match your filters.</p>
                      <button
                        onClick={clearFilters}
                        className="mt-2 text-sm font-medium text-info underline-offset-2 hover:underline"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">No saved venues yet.</p>
                      <button
                        onClick={() => setShowAddForm(true)}
                        className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-ai-soft px-4 text-small text-ai-soft-foreground transition-colors hover:bg-ai-soft/80"
                      >
                        <Plus size={16} /> Add your first venue
                      </button>
                    </>
                  )}
                </div>
              ) : (
                filtered.map((v) => (
                  <SavedVenueCard
                    onOpen={() => setDetail(v)}
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
