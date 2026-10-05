import { useState, useEffect, useCallback, useRef } from 'react';
import {
  UserPlus, Check, X, Users, UserMinus,
  Plus, ChevronRight, Loader2, FolderOpen, AtSign,
} from 'lucide-react';
import {
  fetchFriends, sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend,
  searchUsers,
  fetchCollections, fetchCollectionMembers, createCollection, removeCollectionMember,
  type FriendWithProfile, type Collection, type PublicProfile,
} from '../lib/supabase';
import { navigate } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import { ShareCollectionModal } from '../components/ShareCollectionModal';
import { LoadError } from '../components/LoadError';
import { hasCached, useCachedState } from '../lib/cache';

// Friend groups were replaced by group collections (client, 2026-10-05): a
// group is now a shared collection that everyone in it can add venues to.
type Tab = 'friends' | 'collections';
const TAB_LABELS: Record<Tab, string> = { friends: 'Friends', collections: 'Group Collections' };

/** One of my collections, with how many friends it's shared with. */
type MyCollection = Collection & { memberCount: number };

export function FriendsPage() {
  const [tab, setTab] = useState<Tab>('friends');
  const { session } = useAuth();
  const currentUserId = session?.user.id;

  // Friends state
  // Remembered between visits; the fresh list loads behind it.
  const [friends, setFriends] = useCachedState<FriendWithProfile[]>('friends', []);
  const [friendsLoading, setFriendsLoading] = useState(() => !hasCached('friends'));
  const [friendsFailed, setFriendsFailed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicProfile[]>([]);
  // Each keystroke starts a search; only the latest one may update the list.
  const searchSeq = useRef(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Group collections state
  const [mine, setMine] = useCachedState<MyCollection[]>('friends:my-collections', []);
  const [sharedWithMe, setSharedWithMe] = useCachedState<Collection[]>('friends:shared-collections', []);
  const [collectionsLoading, setCollectionsLoading] = useState(() => !hasCached('friends:shared-collections'));
  const [collectionsFailed, setCollectionsFailed] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  const [sharing, setSharing] = useState<Collection | null>(null);

  const loadFriends = useCallback(async () => {
    if (!hasCached('friends')) setFriendsLoading(true);
    setFriendsFailed(false);
    try {
      setFriends(await fetchFriends());
    } catch {
      setFriendsFailed(true);
    } finally {
      setFriendsLoading(false);
    }
  }, [setFriends]);

  const loadCollections = useCallback(async () => {
    if (!hasCached('friends:shared-collections')) setCollectionsLoading(true);
    setCollectionsFailed(false);
    try {
      // fetchCollections returns everything I can access: my own, and the
      // ones friends have added me to.
      const all = await fetchCollections();
      const own = all.filter((c) => c.user_id === session?.user.id);
      const counts = await Promise.all(own.map((c) => fetchCollectionMembers(c.id).then((m) => m.length).catch(() => 0)));
      setMine(own.map((c, i) => ({ ...c, memberCount: counts[i] })));
      setSharedWithMe(all.filter((c) => c.user_id !== session?.user.id));
    } catch {
      setCollectionsFailed(true);
    } finally {
      setCollectionsLoading(false);
    }
  }, [session?.user.id, setMine, setSharedWithMe]);

  useEffect(() => { loadFriends(); }, [loadFriends]);
  useEffect(() => { if (tab === 'collections') loadCollections(); }, [tab, loadCollections]);

  // Search as you type: anyone whose username or name contains the text.
  useEffect(() => {
    const seq = ++searchSeq.current;
    if (!searchQuery.trim().replace(/^@/, '')) {
      setSearchResults([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      setSearchError(null);
      try {
        const results = await searchUsers(searchQuery);
        if (seq === searchSeq.current) setSearchResults(results);
      } catch {
        if (seq === searchSeq.current) setSearchError('Search failed. Try again.');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSendRequest = async (targetId: string) => {
    setActionLoading(targetId);
    try {
      await sendFriendRequest(targetId);
      await loadFriends();
      setSearchResults([]);
      setSearchQuery('');
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'Failed to send request.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAccept = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await acceptFriendRequest(friendshipId);
      await loadFriends();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  const handleDecline = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await declineFriendRequest(friendshipId);
      await loadFriends();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  const handleRemoveFriend = async (friendshipId: string) => {
    if (!window.confirm('Remove this friend?')) return;
    setActionLoading(friendshipId);
    try {
      await removeFriend(friendshipId);
      await loadFriends();
    } catch { /* ignore */ } finally {
      setActionLoading(null);
    }
  };

  // A new group collection opens straight into "add friends".
  const handleCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;
    setCreatingCollection(true);
    setCollectionError(null);
    try {
      const created = await createCollection(name);
      setNewCollectionName('');
      setMine((prev) => [{ ...created, memberCount: 0 }, ...prev]);
      setSharing(created);
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : "Couldn't create that collection.");
    } finally {
      setCreatingCollection(false);
    }
  };

  const handleLeaveCollection = async (collectionId: string) => {
    if (!session?.user.id) return;
    try {
      await removeCollectionMember(collectionId, session.user.id);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const pendingIncoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const pendingOutgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing');

  const friendshipWith = (userId: string) =>
    friends.find((f) => f.user_id === userId && (f.status === 'accepted' || f.status === 'pending'));

  return (
    <div className="min-h-screen overflow-y-auto bg-black px-6 pt-8 pb-24">
      <div className="mx-auto w-full">
        <h1 className="mb-6 text-2xl font-bold text-white">Friends</h1>

        {/* Tab switcher */}
        <div className="mb-6 flex rounded-card border border-gold/20 bg-white/5 p-1">
          {(['friends', 'collections'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-[10px] py-2 text-sm font-semibold transition-all ${
                tab === t ? 'bg-gold text-black shadow-gold-glow' : 'text-ink-secondary hover:text-white'
              }`}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* ── FRIENDS TAB ── */}
        {tab === 'friends' && (
          <div className="space-y-6">
            {/* Search */}
            <div>
              <div className="relative">
                <AtSign size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gold/70" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or username..."
                  className="w-full rounded-card border border-gold/20 bg-black/40 py-3.5 pl-11 pr-4 text-white placeholder:text-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
                />
                {searching && (
                  <Loader2 size={17} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-gold/50" />
                )}
              </div>

              {searchError && (
                <p className="mt-2 text-sm text-danger">{searchError}</p>
              )}

              {searchResults.length > 0 && (
                <ul className="mt-3 divide-y divide-gold/10 overflow-hidden rounded-card border border-gold/30 bg-[#1a1a1a]">
                  {searchResults.map((person) => {
                    const friendship = friendshipWith(person.id);
                    return (
                      <li key={person.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-white">{person.display_name}</p>
                          {person.username && (
                            <p className="truncate text-sm text-ink-secondary">@{person.username}</p>
                          )}
                        </div>
                        {person.id === currentUserId ? (
                          <span className="shrink-0 text-sm text-ink-secondary">That's you!</span>
                        ) : friendship?.status === 'accepted' ? (
                          <span className="shrink-0 text-sm text-success">Friends</span>
                        ) : friendship ? (
                          <span className="shrink-0 text-sm text-ink-secondary">Pending</span>
                        ) : (
                          <button
                            onClick={() => handleSendRequest(person.id)}
                            disabled={actionLoading === person.id}
                            className="flex shrink-0 items-center gap-1.5 rounded-card bg-gold px-4 py-2 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                          >
                            <UserPlus size={15} /> Add
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {searchResults.length === 0 && !searching && !searchError && searchQuery.trim().replace(/^@/, '') && (
                <p className="mt-3 text-sm text-ink-secondary">No users match "{searchQuery.trim()}".</p>
              )}
            </div>

            {/* Pending incoming */}
            {pendingIncoming.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold/70">
                  Friend Requests ({pendingIncoming.length})
                </h2>
                <div className="listing-grid">
                  {pendingIncoming.map((f) => (
                    <div key={f.friendship_id} className="flex items-center justify-between rounded-card border border-gold/30 bg-[#1a1a1a] p-4">
                      <div>
                        <p className="font-semibold text-white">{f.display_name}</p>
                        <p className="text-sm text-ink-secondary">@{f.username}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAccept(f.friendship_id)}
                          disabled={actionLoading === f.friendship_id}
                          className="flex h-9 w-9 items-center justify-center rounded-full bg-gold text-black transition-all active:scale-90 disabled:opacity-50"
                          aria-label="Accept"
                        >
                          <Check size={17} />
                        </button>
                        <button
                          onClick={() => handleDecline(f.friendship_id)}
                          disabled={actionLoading === f.friendship_id}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-danger/40 text-danger transition-all active:scale-90 hover:bg-danger/10 disabled:opacity-50"
                          aria-label="Decline"
                        >
                          <X size={17} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Accepted friends */}
            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold/70">
                Your Friends ({acceptedFriends.length})
              </h2>
              {friendsLoading ? (
                <p className="text-sm text-ink-secondary">Loading...</p>
              ) : friendsFailed && friends.length === 0 ? (
                <LoadError onRetry={loadFriends} />
              ) : acceptedFriends.length === 0 ? (
                <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
                  <Users size={32} className="mx-auto mb-3 text-gold/30" />
                  <p className="text-sm text-ink-secondary">No friends yet. Search by username to add someone!</p>
                </div>
              ) : (
                <div className="listing-grid">
                  {acceptedFriends.map((f) => (
                    <div key={f.friendship_id} className="flex items-center justify-between rounded-card border border-gold/20 bg-[#1a1a1a] p-4">
                      <div>
                        <p className="font-semibold text-white">{f.display_name}</p>
                        <p className="text-sm text-ink-secondary">@{f.username}</p>
                      </div>
                      <button
                        onClick={() => handleRemoveFriend(f.friendship_id)}
                        disabled={actionLoading === f.friendship_id}
                        className="flex h-9 w-9 items-center justify-center rounded-full text-danger/60 transition-all active:scale-90 hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                        aria-label="Remove friend"
                      >
                        <UserMinus size={17} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pending outgoing */}
            {pendingOutgoing.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold/70">
                  Pending Requests ({pendingOutgoing.length})
                </h2>
                <div className="listing-grid">
                  {pendingOutgoing.map((f) => (
                    <div key={f.friendship_id} className="flex items-center justify-between rounded-card border border-gold/10 bg-[#1a1a1a] p-4 opacity-70">
                      <div>
                        <p className="font-semibold text-white">{f.display_name}</p>
                        <p className="text-sm text-ink-secondary">@{f.username}</p>
                      </div>
                      <span className="text-sm text-pending">Waiting...</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── GROUP COLLECTIONS TAB ── */}
        {tab === 'collections' && (
          <div className="space-y-6">
            <p className="text-sm text-ink-secondary">
              Collect places together. Everyone in a group collection can add venues to it and save any of them to their own venues.
            </p>

            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateCollection(); }}
                  placeholder="New group collection (e.g. Sydney eats)"
                  className="min-w-0 flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold"
                />
                <button
                  onClick={handleCreateCollection}
                  disabled={creatingCollection || !newCollectionName.trim()}
                  className="flex shrink-0 items-center gap-1.5 rounded-card bg-gold px-4 py-3 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                >
                  {creatingCollection ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create
                </button>
              </div>
              {collectionError && <p className="mt-2 text-sm text-danger">{collectionError}</p>}
            </div>

            {collectionsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 size={24} className="animate-spin text-gold" />
              </div>
            ) : collectionsFailed && mine.length === 0 && sharedWithMe.length === 0 ? (
              <LoadError onRetry={loadCollections} />
            ) : (
              <>
                {(() => {
                  const groupCollections = [
                    ...mine.filter((c) => c.memberCount > 0).map((c) => ({ c, owned: true, count: c.memberCount + 1 })),
                    ...sharedWithMe.map((c) => ({ c, owned: false, count: 0 })),
                  ];
                  return groupCollections.length === 0 ? (
                    <div className="rounded-card border border-gold/20 bg-surface p-6 text-center">
                      <FolderOpen size={28} className="mx-auto mb-2 text-gold/60" />
                      <p className="text-sm text-ink-secondary">No group collections yet. Create one above and add your friends.</p>
                    </div>
                  ) : (
                    <div className="listing-grid">
                      {groupCollections.map(({ c, owned, count }) => (
                        <div key={c.id} className="card flex items-center justify-between gap-3">
                          <button
                            onClick={() => navigate(`/venues?collection=${c.id}`)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                          >
                            <FolderOpen size={20} className="shrink-0 text-gold" />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-white">{c.name}</span>
                              <span className="block text-xs text-ink-secondary">
                                {owned ? `Yours · ${count} people` : 'Shared with you'}
                              </span>
                            </span>
                            <ChevronRight size={16} className="ml-auto shrink-0 text-ink-secondary" />
                          </button>
                          {owned ? (
                            <button
                              onClick={() => setSharing(c)}
                              aria-label={`Add friends to ${c.name}`}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gold transition-colors hover:bg-gold/10"
                            >
                              <UserPlus size={16} />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleLeaveCollection(c.id)}
                              aria-label={`Leave ${c.name}`}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                              <UserMinus size={16} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* My collections nobody else is in yet: one tap makes them a group collection. */}
                {mine.some((c) => c.memberCount === 0) && (
                  <div>
                    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold/70">
                      Your other collections
                    </h2>
                    <div className="listing-grid">
                      {mine.filter((c) => c.memberCount === 0).map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3 rounded-card border border-gold/10 bg-[#1a1a1a] p-4">
                          <span className="truncate text-sm text-white">{c.name}</span>
                          <button
                            onClick={() => setSharing(c)}
                            className="flex shrink-0 items-center gap-1.5 rounded-card border border-gold/40 px-3 py-1.5 text-xs font-bold text-gold transition-all hover:bg-gold/10 active:scale-95"
                          >
                            <UserPlus size={13} /> Add friends
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {sharing && (
              <ShareCollectionModal
                collection={sharing}
                open
                onOpenChange={(open) => { if (!open) { setSharing(null); void loadCollections(); } }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
