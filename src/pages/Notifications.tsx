import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck, ChevronLeft } from 'lucide-react';
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead,
  type NotificationItem,
} from '../lib/supabase';
import { navigate } from '../lib/router';
import { useAuth } from '../context/AuthContext';
import { hasCached, useCachedState } from '../lib/cache';
import { LoadError } from '../components/LoadError';

export function NotificationsPage({ onBack, onOpenFriends }: { onBack: () => void; onOpenFriends: () => void }) {
  const { refreshProfile } = useAuth();
  const [notifications, setNotifications] = useCachedState<NotificationItem[]>('notifications', []);
  // Seen before: show that while the fresh list loads.
  const [loading, setLoading] = useState(() => !hasCached('notifications'));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!hasCached('notifications')) setLoading(true);
    setFailed(false);
    try {
      setNotifications(await fetchNotifications());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [setNotifications]);

  useEffect(() => { load(); }, [load]);

  const handleClick = async (n: NotificationItem) => {
    if (!n.read) {
      await markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
    }
    const data = n.data ?? {};
    // Older RSVP notifications only carry a link (/plan/<id>), not the id.
    const planId =
      typeof data.plan_id === 'string'
        ? data.plan_id
        : typeof data.url === 'string'
          ? data.url.match(/\/plan\/([0-9a-f-]{36})/i)?.[1]
          : undefined;

    switch (n.type) {
      case 'friend_request':
      case 'friend_accepted':
        onOpenFriends();
        return;
      case 'collection_shared':
        if (typeof data.collection_id === 'string') navigate(`/venues?collection=${data.collection_id}`);
        break;
      case 'plan_invite':
        if (planId) navigate(`/plan/${planId}`);
        break;
      case 'team_role':
        // Made a worker or manager: their new tab, with the role loaded.
        await refreshProfile();
        navigate('/my-venues');
        break;
      default:
        // RSVPs and anything else about a plan: the host's dashboard.
        if (planId) navigate(`/plan/${planId}/dashboard`);
    }
    // Navigating to the page already open fires no route change; close the
    // list either way so the tap always lands somewhere.
    onBack();
  };

  const handleMarkAll = async () => {
    await markAllNotificationsRead();
    setNotifications((prev) => prev.map((x) => ({ ...x, read: true })));
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="relative min-h-screen overflow-y-auto bg-background px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-3 top-3 flex size-11 items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted active:scale-95"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-title text-foreground">Notifications</h1>
          {notifications.some((n) => !n.read) && (
            <button
              onClick={handleMarkAll}
              className="flex items-center gap-1.5 text-sm font-medium text-primary-text transition-colors hover:text-foreground"
            >
              <CheckCheck size={16} /> Mark all read
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : failed && notifications.length === 0 ? (
          <LoadError onRetry={load} />
        ) : notifications.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Bell size={32} className="mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex w-full items-start gap-3 rounded-md border p-4 text-left transition-all ${
                  n.read
                    ? 'border-border bg-card opacity-60'
                    : 'border-border bg-card hover:border-input'
                }`}
              >
                <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-primary'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.read ? 'font-medium text-foreground' : 'font-bold text-foreground'}`}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{formatTime(n.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
