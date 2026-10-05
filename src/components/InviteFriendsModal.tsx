import { useState, useEffect, useCallback } from 'react';
import {
  fetchFriends,
  inviteUserToPlan,
  fetchInvitedUserIdsForPlan,
  type FriendWithProfile,
} from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { X, User, Check, Send, Lock } from 'lucide-react';

/** The tick box on each row: visible before it's ticked, so it reads as a choice. */
function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${
        checked ? 'border-gold bg-gold text-black' : 'border-gold/40 bg-transparent'
      }`}
    >
      {checked && <Check size={14} strokeWidth={3} />}
    </span>
  );
}

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
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [selectedFriends, setSelectedFriends] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [f, invited] = await Promise.all([
        fetchFriends(),
        fetchInvitedUserIdsForPlan(planId),
      ]);
      setFriends(f.filter((fr) => fr.status === 'accepted'));
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
      if (count === 0) {
        setError('Everyone you selected has already been invited.');
      } else {
        setSuccess(`Invitations sent to ${count} ${count === 1 ? 'person' : 'people'}!`);
        setSelectedFriends(new Set());
        await load();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send invitations');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;

  const hasSelection = selectedFriends.size > 0;
  // Friend groups were retired; "Select all" covers inviting everyone at once.
  const invitable = friends.filter((f) => !invitedIds.has(f.user_id));
  const allSelected = invitable.length > 0 && invitable.every((f) => selectedFriends.has(f.user_id));

  return (
    <div
      // Above the bottom tab bar (z-50), which otherwise covers the Send button on phones.
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-gold/20 bg-[#0d0d0d] pb-[env(safe-area-inset-bottom,0px)] sm:h-[85vh] sm:max-h-[85vh] sm:w-[480px] sm:max-w-[90vw] sm:rounded-3xl sm:pb-0"
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

              {/* Friends section */}
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
                    <User size={16} className="text-gold" /> Friends
                  </h3>
                  {invitable.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedFriends(allSelected ? new Set() : new Set(invitable.map((f) => f.user_id)))}
                      className="text-xs font-semibold text-gold underline-offset-2 hover:underline"
                    >
                      {allSelected ? 'Clear' : 'Select all'}
                    </button>
                  )}
                </div>
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
                          aria-pressed={isSelected}
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
                          ) : (
                            <Checkbox checked={isSelected} />
                          )}
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
                  ? `Send Invitations (${selectedFriends.size})`
                  : 'Send Invitations'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
