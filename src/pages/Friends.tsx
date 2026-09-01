import { useState, useEffect, useCallback } from 'react';
import {
  UserPlus, Check, X, Users, Trash2, UserMinus,
  FolderPlus, MapPin, Plus, ChevronRight, Loader2, FolderOpen, AtSign,
} from 'lucide-react';
import {
  fetchFriends, sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend,
  searchUserByUsername,
  createFriendGroup, fetchFriendGroups, addGroupMember, removeGroupMember, deleteFriendGroup,
  createSharedCollection, fetchSharedCollections, addCollectionMember, removeCollectionMember,
  removeCollectionVenue, deleteSharedCollection,
  type FriendWithProfile, type FriendGroupWithMembers, type SharedCollectionWithMembers,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

type Tab = 'friends' | 'groups' | 'collections';

export function FriendsPage() {
  const [tab, setTab] = useState<Tab>('friends');
  const { session } = useAuth();
  const currentUserId = session?.user.id;

  // Friends state
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResult, setSearchResult] = useState<{ id: string; display_name: string; username: string | null } | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Groups state
  const [groups, setGroups] = useState<FriendGroupWithMembers[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [newGroupName, setNewGroupName] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [groupAddFriendId, setGroupAddFriendId] = useState('');

  // Collections state
  const [collections, setCollections] = useState<SharedCollectionWithMembers[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [expandedCollection, setExpandedCollection] = useState<string | null>(null);
  const [collectionAddFriendId, setCollectionAddFriendId] = useState('');

  const loadFriends = useCallback(async () => {
    setFriendsLoading(true);
    try {
      setFriends(await fetchFriends());
    } catch { /* ignore */ } finally {
      setFriendsLoading(false);
    }
  }, []);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      setGroups(await fetchFriendGroups());
    } catch { /* ignore */ } finally {
      setGroupsLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true);
    try {
      setCollections(await fetchSharedCollections());
    } catch { /* ignore */ } finally {
      setCollectionsLoading(false);
    }
  }, []);

  useEffect(() => { loadFriends(); }, [loadFriends]);
  useEffect(() => { if (tab === 'groups') loadGroups(); }, [tab, loadGroups]);
  useEffect(() => { if (tab === 'collections') loadCollections(); }, [tab, loadCollections]);

  // Search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResult(null);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const result = await searchUserByUsername(searchQuery);
        setSearchResult(result);
      } catch {
        setSearchError('Search failed. Try again.');
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSendRequest = async (targetId: string) => {
    setActionLoading(targetId);
    try {
      await sendFriendRequest(targetId);
      await loadFriends();
      setSearchResult(null);
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

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    setCreatingGroup(true);
    try {
      await createFriendGroup(newGroupName.trim());
      setNewGroupName('');
      await loadGroups();
    } catch { /* ignore */ } finally {
      setCreatingGroup(false);
    }
  };

  const handleAddGroupMember = async (groupId: string) => {
    if (!groupAddFriendId) return;
    try {
      await addGroupMember(groupId, groupAddFriendId);
      setGroupAddFriendId('');
      await loadGroups();
    } catch { /* ignore */ }
  };

  const handleRemoveGroupMember = async (groupId: string, userId: string) => {
    try {
      await removeGroupMember(groupId, userId);
      await loadGroups();
    } catch { /* ignore */ }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!window.confirm('Delete this group?')) return;
    try {
      await deleteFriendGroup(groupId);
      await loadGroups();
    } catch { /* ignore */ }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;
    setCreatingCollection(true);
    try {
      await createSharedCollection(newCollectionName.trim());
      setNewCollectionName('');
      await loadCollections();
    } catch { /* ignore */ } finally {
      setCreatingCollection(false);
    }
  };

  const handleAddCollectionMember = async (collectionId: string) => {
    if (!collectionAddFriendId) return;
    try {
      await addCollectionMember(collectionId, collectionAddFriendId);
      setCollectionAddFriendId('');
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleRemoveCollectionMember = async (collectionId: string, userId: string) => {
    try {
      await removeCollectionMember(collectionId, userId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleRemoveVenue = async (venueId: string) => {
    try {
      await removeCollectionVenue(venueId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const handleDeleteCollection = async (collectionId: string) => {
    if (!window.confirm('Delete this shared collection?')) return;
    try {
      await deleteSharedCollection(collectionId);
      await loadCollections();
    } catch { /* ignore */ }
  };

  const acceptedFriends = friends.filter((f) => f.status === 'accepted');
  const pendingIncoming = friends.filter((f) => f.status === 'pending' && f.direction === 'incoming');
  const pendingOutgoing = friends.filter((f) => f.status === 'pending' && f.direction === 'outgoing');

  const isAlreadyFriend = (userId: string) =>
    friends.some((f) => f.user_id === userId && (f.status === 'accepted' || f.status === 'pending'));

  return (
    <div className="min-h-screen overflow-y-auto bg-black px-6 pt-8 pb-24">
      <div className="mx-auto w-full">
        <h1 className="mb-6 text-2xl font-bold text-white">Friends</h1>

        {/* Tab switcher */}
        <div className="mb-6 flex rounded-card border border-gold/20 bg-white/5 p-1">
          {(['friends', 'groups', 'collections'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-[10px] py-2 text-sm font-semibold capitalize transition-all ${
                tab === t ? 'bg-gold text-black shadow-gold-glow' : 'text-ink-secondary hover:text-white'
              }`}
            >
              {t}
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
                  placeholder="Search by username..."
                  className="w-full rounded-card border border-gold/20 bg-black/40 py-3.5 pl-11 pr-4 text-white placeholder:text-ink-secondary/60 outline-none transition-all focus:border-gold focus:shadow-gold-glow"
                />
                {searching && (
                  <Loader2 size={17} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-gold/50" />
                )}
              </div>

              {searchError && (
                <p className="mt-2 text-sm text-danger">{searchError}</p>
              )}

              {searchResult && (
                <div className="mt-3 rounded-card border border-gold/30 bg-[#1a1a1a] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-white">{searchResult.display_name}</p>
                      <p className="text-sm text-ink-secondary">@{searchResult.username}</p>
                    </div>
                    {searchResult.id === currentUserId ? (
                      <span className="text-sm text-ink-secondary">That's you!</span>
                    ) : isAlreadyFriend(searchResult.id) ? (
                      <span className="text-sm text-success">Already friends</span>
                    ) : (
                      <button
                        onClick={() => handleSendRequest(searchResult.id)}
                        disabled={actionLoading === searchResult.id}
                        className="flex items-center gap-1.5 rounded-card bg-gold px-4 py-2 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                      >
                        <UserPlus size={15} /> Add
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!searchResult && !searching && searchQuery.trim() && (
                <p className="mt-3 text-sm text-ink-secondary">No user found.</p>
              )}
            </div>

            {/* Pending incoming */}
            {pendingIncoming.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold/70">
                  Friend Requests ({pendingIncoming.length})
                </h2>
                <div className="space-y-3">
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
              ) : acceptedFriends.length === 0 ? (
                <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
                  <Users size={32} className="mx-auto mb-3 text-gold/30" />
                  <p className="text-sm text-ink-secondary">No friends yet. Search by username to add someone!</p>
                </div>
              ) : (
                <div className="space-y-3">
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
                <div className="space-y-3">
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

        {/* ── GROUPS TAB ── */}
        {tab === 'groups' && (
          <div className="space-y-6">
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Group name (e.g. The Boys)"
                  className="flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold"
                />
                <button
                  onClick={handleCreateGroup}
                  disabled={creatingGroup || !newGroupName.trim()}
                  className="flex items-center gap-1.5 rounded-card bg-gold px-4 py-3 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                >
                  {creatingGroup ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  Create
                </button>
              </div>
            </div>

            {groupsLoading ? (
              <p className="text-sm text-ink-secondary">Loading...</p>
            ) : groups.length === 0 ? (
              <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
                <Users size={32} className="mx-auto mb-3 text-gold/30" />
                <p className="text-sm text-ink-secondary">No groups yet. Create one to invite the same friends repeatedly!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g.id} className="rounded-card border border-gold/20 bg-[#1a1a1a] p-4">
                    <button
                      onClick={() => setExpandedGroup(expandedGroup === g.id ? null : g.id)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div>
                        <p className="font-bold text-white">{g.name}</p>
                        <p className="text-sm text-ink-secondary">{g.members.length} member{g.members.length === 1 ? '' : 's'}</p>
                      </div>
                      <ChevronRight size={20} className={`text-gold/50 transition-transform ${expandedGroup === g.id ? 'rotate-90' : ''}`} />
                    </button>

                    {expandedGroup === g.id && (
                      <div className="mt-4 space-y-3 border-t border-gold/10 pt-4">
                        {g.members.map((m) => (
                          <div key={m.user_id} className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-white">{m.display_name}</p>
                              <p className="text-xs text-ink-secondary">@{m.username}</p>
                            </div>
                            <button
                              onClick={() => handleRemoveGroupMember(g.id, m.user_id)}
                              className="text-danger/60 transition-colors hover:text-danger"
                              aria-label="Remove member"
                            >
                              <UserMinus size={16} />
                            </button>
                          </div>
                        ))}

                        {/* Add friend to group */}
                        <div className="flex gap-2 pt-2">
                          <select
                            value={groupAddFriendId}
                            onChange={(e) => setGroupAddFriendId(e.target.value)}
                            className="flex-1 rounded-card border border-gold/20 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-gold"
                          >
                            <option value="">Add a friend...</option>
                            {acceptedFriends.map((f) => (
                              <option key={f.user_id} value={f.user_id} disabled={g.members.some((m) => m.user_id === f.user_id)}>
                                {f.display_name} (@{f.username})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleAddGroupMember(g.id)}
                            disabled={!groupAddFriendId}
                            className="flex items-center gap-1 rounded-card bg-gold px-3 py-2 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                          >
                            <Plus size={15} />
                          </button>
                        </div>

                        <button
                          onClick={() => handleDeleteGroup(g.id)}
                          className="flex w-full items-center justify-center gap-1.5 rounded-card border border-danger/30 py-2 text-sm font-medium text-danger transition-all hover:bg-danger/10"
                        >
                          <Trash2 size={14} /> Delete Group
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COLLECTIONS TAB ── */}
        {tab === 'collections' && (
          <div className="space-y-6">
            <div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="Collection name (e.g. Robert & Michael's Spots)"
                  className="flex-1 rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-white placeholder:text-ink-secondary/60 outline-none focus:border-gold"
                />
                <button
                  onClick={handleCreateCollection}
                  disabled={creatingCollection || !newCollectionName.trim()}
                  className="flex items-center gap-1.5 rounded-card bg-gold px-4 py-3 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                >
                  {creatingCollection ? <Loader2 size={16} className="animate-spin" /> : <FolderPlus size={16} />}
                  Create
                </button>
              </div>
              <p className="mt-2 text-xs text-ink-secondary">Shared venue collections that all members can add to and remove from.</p>
            </div>

            {collectionsLoading ? (
              <p className="text-sm text-ink-secondary">Loading...</p>
            ) : collections.length === 0 ? (
              <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
                <FolderOpen size={32} className="mx-auto mb-3 text-gold/30" />
                <p className="text-sm text-ink-secondary">No shared collections yet. Create one to collaborate on venues with friends!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {collections.map((c) => (
                  <div key={c.id} className="rounded-card border border-gold/20 bg-[#1a1a1a] p-4">
                    <button
                      onClick={() => setExpandedCollection(expandedCollection === c.id ? null : c.id)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div>
                        <p className="font-bold text-white">{c.name}</p>
                        <p className="text-sm text-ink-secondary">{c.members.length} member{c.members.length === 1 ? '' : 's'} · {c.venues.length} venue{c.venues.length === 1 ? '' : 's'}</p>
                      </div>
                      <ChevronRight size={20} className={`text-gold/50 transition-transform ${expandedCollection === c.id ? 'rotate-90' : ''}`} />
                    </button>

                    {expandedCollection === c.id && (
                      <div className="mt-4 space-y-4 border-t border-gold/10 pt-4">
                        {/* Venues */}
                        {c.venues.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gold/70">Venues</p>
                            {c.venues.map((v) => (
                              <div key={v.id} className="flex items-start justify-between rounded-lg border border-gold/10 bg-black/40 p-3">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-medium text-white">{v.name}</p>
                                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-secondary">
                                    <MapPin size={11} className="text-gold/60" /> {v.address}
                                  </p>
                                </div>
                                <button
                                  onClick={() => handleRemoveVenue(v.id)}
                                  className="ml-2 shrink-0 text-danger/60 transition-colors hover:text-danger"
                                  aria-label="Remove venue"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Members */}
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gold/70">Members</p>
                          {c.members.map((m) => (
                            <div key={m.user_id} className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-white">{m.display_name}</p>
                                <p className="text-xs text-ink-secondary">@{m.username}</p>
                              </div>
                              {c.owner_id === currentUserId && m.user_id !== currentUserId && (
                                <button
                                  onClick={() => handleRemoveCollectionMember(c.id, m.user_id)}
                                  className="text-danger/60 transition-colors hover:text-danger"
                                  aria-label="Remove member"
                                >
                                  <UserMinus size={16} />
                                </button>
                              )}
                            </div>
                          ))}

                          {/* Add friend to collection */}
                          {c.owner_id === currentUserId && (
                            <div className="flex gap-2 pt-2">
                              <select
                                value={collectionAddFriendId}
                                onChange={(e) => setCollectionAddFriendId(e.target.value)}
                                className="flex-1 rounded-card border border-gold/20 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-gold"
                              >
                                <option value="">Add a friend...</option>
                                {acceptedFriends.map((f) => (
                                  <option key={f.user_id} value={f.user_id} disabled={c.members.some((m) => m.user_id === f.user_id)}>
                                    {f.display_name} (@{f.username})
                                  </option>
                                ))}
                              </select>
                              <button
                                onClick={() => handleAddCollectionMember(c.id)}
                                disabled={!collectionAddFriendId}
                                className="flex items-center gap-1 rounded-card bg-gold px-3 py-2 text-sm font-bold text-black transition-all active:scale-95 disabled:opacity-50"
                              >
                                <Plus size={15} />
                              </button>
                            </div>
                          )}
                        </div>

                        {c.owner_id === currentUserId && (
                          <button
                            onClick={() => handleDeleteCollection(c.id)}
                            className="flex w-full items-center justify-center gap-1.5 rounded-card border border-danger/30 py-2 text-sm font-medium text-danger transition-all hover:bg-danger/10"
                          >
                            <Trash2 size={14} /> Delete Collection
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
