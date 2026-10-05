import { useEffect, useState } from 'react';
import { User, Check, Loader2, UserMinus, Share2 } from 'lucide-react';
import {
  fetchFriends,
  fetchCollectionMembers,
  shareCollectionWithFriends,
  removeCollectionMember,
  type Collection,
  type CollectionMember,
  type FriendWithProfile,
} from '../lib/supabase';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

/**
 * Owner-side sheet for adding friends to a group collection, and for seeing /
 * removing who already has it. (Friend groups were retired in favour of group
 * collections, so this offers friends only.) Only accepted friends can be
 * chosen — the server enforces the same rule, this just avoids offering
 * anyone it would refuse.
 */
export function ShareCollectionModal({
  collection,
  open,
  onOpenChange,
  onChanged,
}: {
  collection: Collection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after membership changes, so the caller can refresh counts. */
  onChanged?: () => void;
}) {
  const [friends, setFriends] = useState<FriendWithProfile[]>([]);
  const [members, setMembers] = useState<CollectionMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [f, m] = await Promise.all([
        fetchFriends(),
        fetchCollectionMembers(collection.id),
      ]);
      setFriends(f.filter((x) => x.status === 'accepted'));
      setMembers(m);
    } catch {
      setNotice("Couldn't load your friends right now.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setNotice(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, collection.id]);

  const memberIds = new Set(members.map((m) => m.user_id));
  const shareable = friends.filter((f) => !memberIds.has(f.user_id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const shareSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const n = await shareCollectionWithFriends(collection.id, Array.from(selected));
      setNotice(n === 1 ? 'Added 1 friend.' : `Added ${n} friends.`);
      setSelected(new Set());
      await load();
      onChanged?.();
    } catch {
      setNotice("Couldn't share right now. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (userId: string) => {
    setBusy(true);
    try {
      await removeCollectionMember(collection.id, userId);
      await load();
      onChanged?.();
    } catch {
      setNotice("Couldn't remove them right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 size={18} className="text-gold" /> Share “{collection.name}”
          </DialogTitle>
          <DialogDescription>
            Everyone you add can see every venue in it, add their own, and save any of them to their own venues.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 size={22} className="animate-spin text-gold" />
          </div>
        ) : (
          <Tabs defaultValue="friends">
            <TabsList className="w-full">
              <TabsTrigger value="friends"><User size={14} /> Friends</TabsTrigger>
              <TabsTrigger value="members">Who has it ({members.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="friends">
              {shareable.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-secondary">
                  {friends.length === 0
                    ? 'Add some friends first, then add them to your group collections.'
                    : 'All your friends already have this collection.'}
                </p>
              ) : (
                <>
                  <ul className="max-h-64 space-y-1 overflow-y-auto">
                    {shareable.map((f) => {
                      const on = selected.has(f.user_id);
                      return (
                        <li key={f.user_id}>
                          <button
                            type="button"
                            onClick={() => toggle(f.user_id)}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-card border px-3 py-2.5 text-left transition-colors',
                              on ? 'border-gold bg-gold/10' : 'border-gold/15 hover:bg-white/5'
                            )}
                          >
                            <span className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded-full border',
                              on ? 'border-gold bg-gold text-black' : 'border-gold/40'
                            )}>
                              {on && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-white">{f.display_name ?? 'Friend'}</span>
                              {f.username && <span className="block truncate text-xs text-ink-secondary">@{f.username}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <Button full onClick={shareSelected} disabled={busy || selected.size === 0} className="mt-3">
                    {busy ? <Loader2 className="animate-spin" /> : <Share2 />}
                    Add {selected.size || ''} {selected.size === 1 ? 'friend' : 'friends'}
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="members">
              {members.length === 0 ? (
                <p className="py-4 text-center text-sm text-ink-secondary">Only you, so far.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {members.map((m) => (
                    <li key={m.user_id} className="flex items-center gap-3 rounded-card border border-gold/15 px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-white">{m.display_name ?? 'Friend'}</span>
                        {m.username && <span className="block truncate text-xs text-ink-secondary">@{m.username}</span>}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => remove(m.user_id)}
                        aria-label={`Remove ${m.display_name ?? 'member'}`}
                        className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                      >
                        <UserMinus size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        )}

        {notice && (
          <p role="status" className="text-center text-sm text-gold">{notice}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
