import { Bell, Menu } from 'lucide-react';

/**
 * The top-right pair on Home and venue pages: notifications, then the
 * Settings menu as a hamburger (2026-11-28: the profile picture was not
 * an obvious way into Settings).
 */
export function HeaderActions({ unreadCount = 0, onNotifications, onSettings, tour = false }: {
  unreadCount?: number;
  onNotifications?: () => void;
  onSettings?: () => void;
  /** Marks the Settings button for the walkthrough (Home only). */
  tour?: boolean;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {onNotifications && (
        <button type="button" onClick={onNotifications} className="reference-bell"
          aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
          <Bell size={22} />
          {unreadCount > 0 && <span className="reference-unread">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
      )}
      {onSettings && (
        <button type="button" data-tour={tour ? 'tab-settings' : undefined} onClick={onSettings} className="reference-bell" aria-label="Settings">
          <Menu size={22} />
        </button>
      )}
    </div>
  );
}
