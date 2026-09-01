import { useState, useEffect, useCallback } from 'react';
import { Bell, CheckCheck, ChevronLeft } from 'lucide-react';
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead,
  type NotificationItem,
} from '../lib/supabase';
import { navigate } from '../lib/router';

export function NotificationsPage({ onBack }: { onBack: () => void }) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setNotifications(await fetchNotifications());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClick = async (n: NotificationItem) => {
    if (!n.read) {
      await markNotificationRead(n.id);
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
    }
    const data = n.data ?? {};
    if (data.plan_id && typeof data.plan_id === 'string') {
      if (n.type === 'plan_invite') {
        navigate(`/plan/${data.plan_id}`);
      } else {
        navigate(`/plan/${data.plan_id}/dashboard`);
      }
      return;
    }
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
    <div className="relative min-h-screen overflow-y-auto bg-black px-6 pt-20 pb-24">
      <button
        onClick={onBack}
        aria-label="Back"
        className="absolute left-5 top-5 flex items-center justify-center rounded-full text-gold transition-all active:scale-90"
      >
        <ChevronLeft size={28} strokeWidth={2.5} />
      </button>

      <div className="mx-auto w-full">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          {notifications.some((n) => !n.read) && (
            <button
              onClick={handleMarkAll}
              className="flex items-center gap-1.5 text-sm font-medium text-gold transition-colors hover:text-white"
            >
              <CheckCheck size={16} /> Mark all read
            </button>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-ink-secondary">Loading...</p>
        ) : notifications.length === 0 ? (
          <div className="rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center">
            <Bell size={32} className="mx-auto mb-3 text-gold/30" />
            <p className="text-sm text-ink-secondary">No notifications yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => handleClick(n)}
                className={`flex w-full items-start gap-3 rounded-card border p-4 text-left transition-all ${
                  n.read
                    ? 'border-gold/10 bg-[#1a1a1a] opacity-60'
                    : 'border-gold/30 bg-[#1a1a1a] hover:border-gold/50'
                }`}
              >
                <div className={`mt-1 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-gold'}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${n.read ? 'font-medium text-white' : 'font-bold text-white'}`}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="mt-0.5 text-sm text-ink-secondary">{n.body}</p>
                  )}
                  <p className="mt-1 text-xs text-ink-secondary/60">{formatTime(n.created_at)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
