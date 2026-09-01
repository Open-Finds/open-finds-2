import { useState, useEffect, useCallback } from 'react';
import {
  fetchFriends,
  fetchFriendGroups,
  inviteUserToPlan,
  inviteGroupToPlan,
  fetchInvitedUserIdsForPlan,
  type FriendWithProfile,
  type FriendGroupWithMembers,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { X, Users, User, Check, Send, Lock } from 'lucide-react';

export function InviteFriendsModal({
  open,
  onClose,
  planId,
}: {
  open: boolean;
  onClose: () => void;
  planId: string;
}) {
  const { session } = useAuth();
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [groups, setGroups] = useState<FriendGroupWithMembers[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, g, invited] = await Promise.all([
        fetchFriends(),
        fetchFriendGroups(),
        fetchInvitedUserIdsForPlan(planId),
      ]);
      setFriends(f.filter((fr) => fr.status === 'accepted'));
      setGroups(g);
      setInvitedIds(invited);
    } catch {
      setError('Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    if (open && session) {
      setSelectedFriends(new Set());
      setSelectedGroup(null);
      setSuccess(null);
      setError(null);
      load();
    }
  }, [open, session, load]);

  const toggleFriend = (userId: string) => {
    setSelectedFriends((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const handleSend = async () => {
    setSending(true);
    setError(null);
    setSuccess(null);
    try {
      let count = 0;
      for (const uid of selectedFriends) {
        if (!invitedIds.has(uid)) {
          await inviteUserToPlan(planId, uid);
          count++;
        }
      }
      if (selectedGroup) {
        await inviteGroupToPlan(planId, selectedGroup);
        const g = groups.find((g) => g.id === selectedGroup);
        count += g?.members.length ?? 0;
      }
      if (count === 0) {
        setError('Everyone you selected has already been invited.');
      } else {
        setSuccess(`Invitations sent to ${count} ${count === 1 ? 'person' : 'people'}!`);
        setSelectedFriends(new Set());
        setSelectedGroup(null);
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invitations');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const hasSelection = selectedFriends.size > 0 || selectedGroup !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="flex h-[85vh] max-h-[85vh] w-[480px] max-w-[90vw] flex-col overflow-hidden rounded-3xl border border-gold/20 bg-[#0d0d0d]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gold/10 p-5">
          <div>
            <h2 className="text-xl font-bold text-gold">Invite Friends</h2>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Send in-app invitations with notifications
            </p>
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
              <p className="text-sm font-medium text-white">
                Sign in to invite friends
              </p>
              <p className="mt-2 text-xs text-ink-secondary">
                Create an account or log in to use in-app invitations.
              </p>
            </div>
          ) : loading ? (
            <p className="py-8 text-center text-sm text-ink-secondary">
              Loading...
            </p>
          ) : (
            <>
              {error && (
                <p className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
                  {error}
                </p>
              )}
              {success && (
                <p className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
                  {success}
                </p>
              )}

              {/* Groups section */}
              {groups.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                    <Users size={16} className="text-gold" /> Groups
                  </h3>
                  <div className="space-y-2">
                    {groups.map((g) => {
                      const allInvited =
                        g.members.length > 0 &&
                        g.members.every((m) => invitedIds.has(m.user_id));
                      const isSelected = selectedGroup === g.id;
                      return (
                        <button
                          key={g.id}
                          onClick={() =>
                            setSelectedGroup(isSelected ? null : g.id)
                          }
                          disabled={allInvited}
                          className={`flex w-full items-center gap-3 rounded-card border p-4 text-left transition-all disabled:opacity-40 ${
                            isSelected
                              ? 'border-gold bg-gold/10'
                              : 'border-gold/10 bg-[#1a1a1a] hover:border-gold/30'
                          }`}
                        >
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/15">
                            <Users size={18} className="text-gold" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-white">
                              {g.name}
                            </p>
                            <p className="text-xs text-ink-secondary">
                              {g.members.length}{' '}
                              {g.members.length === 1 ? 'member' : 'members'}
                              {allInvited && ' · all invited'}
                            </p>
                          </div>
                          {isSelected && (
                            <Check size={18} className="text-gold" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Friends section */}
              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                  <User size={16} className="text-gold" /> Friends
                </h3>
                {friends.length === 0 ? (
                  <p className="py-4 text-center text-sm text-ink-secondary">
                    No friends yet. Add friends from the Friends tab first.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {friends.map((f) => {
                      const isInvited = invitedIds.has(f.user_id);
                      const isSelected = selectedFriends.has(f.user_id);
                      return (
                        <button
                          key={f.user_id}
                          onClick={() => toggleFriend(f.user_id)}
                          disabled={isInvited}
                          className={`flex w-full items-center gap-3 rounded-card border p-3 text-left transition-all disabled:opacity-40 ${
                            isSelected
                              ? 'border-gold bg-gold/10'
                              : 'border-gold/10 bg-[#1a1a1a] hover:border-gold/30'
                          }`}
                        >
                          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-sm font-bold text-gold">
                            {f.display_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">
                              {f.display_name}
                            </p>
                            {f.username && (
                              <p className="text-xs text-ink-secondary">
                                @{f.username}
                              </p>
                            )}
                          </div>
                          {isInvited ? (
                            <span className="text-xs font-medium text-emerald-400">
                              Invited
                            </span>
                          ) : isSelected ? (
                            <Check size={18} className="text-gold" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {session && !loading && (
          <div className="border-t border-gold/10 p-5">
            <button
              onClick={handleSend}
              disabled={!hasSelection || sending}
              className="flex w-full items-center justify-center gap-2 rounded-card bg-gold py-3 text-sm font-bold text-black transition-all active:scale-[0.98] disabled:opacity-40"
            >
              <Send size={18} />
              {sending
                ? 'Sending...'
                : hasSelection
                  ? `Send Invitations (${selectedFriends.size + (selectedGroup ? groups.find((g) => g.id === selectedGroup)?.members.length ?? 0 : 0)})`
                  : 'Send Invitations'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
