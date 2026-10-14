import { useState } from 'react';
import { Home, CalendarDays, Bookmark, Settings, Users, Store } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type View = 'home' | 'events' | 'venues' | 'friends' | 'myvenues' | 'settings';

const ALL_TABS: { view: View; label: string; icon: typeof Home }[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'events', label: 'Events', icon: CalendarDays },
  { view: 'venues', label: 'Venues', icon: Bookmark },
  { view: 'friends', label: 'Friends', icon: Users },
  // Workers, managers and the super admin: the venue partners they signed up.
  { view: 'myvenues', label: 'My Venues', icon: Store },
  { view: 'settings', label: 'Settings', icon: Settings },
];

export function ViewToggle({
  view,
  onChange,
  isEditingItinerary = false,
  showMyVenues = false,
}: {
  view: View;
  onChange: (view: View) => void;
  isEditingItinerary?: boolean;
  showMyVenues?: boolean;
}) {
  const [pendingView, setPendingView] = useState<View | null>(null);
  const TABS = showMyVenues ? ALL_TABS : ALL_TABS.filter((t) => t.view !== 'myvenues');

  const handleClick = (target: View) => {
    if (isEditingItinerary) {
      setPendingView(target);
    } else {
      onChange(target);
    }
  };

  const confirmLeave = () => {
    if (pendingView) {
      onChange(pendingView);
      setPendingView(null);
    }
  };

  return (
    <>
      {/* ── Phones and tablets: bottom tab bar ─────────────────────
          Full-bleed rather than pinned to a fixed-width strip, and
          padded for the home indicator on notched devices. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)] lg:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-stretch justify-around">
          {TABS.map(({ view: tabView, label, icon: Icon }) => {
            const active = view === tabView;
            return (
              <button
                key={tabView}
                data-tour={`tab-${tabView}`}
                onClick={() => handleClick(tabView)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] flex-1 flex-col items-center gap-1 pb-2 pt-2 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {/* The selected tab wears the logo's ring (Jacky, 2026-10-15). */}
                <span className={cn('flex h-8 w-14 items-center justify-center rounded-full transition-colors', active && 'bg-brand-ring text-white')}>
                  <Icon size={21} strokeWidth={active ? 2.4 : 2} />
                </span>
                <span className={cn('whitespace-nowrap text-xs', active ? 'font-semibold' : 'font-medium')}>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Desktop: persistent sidebar ────────────────────────────
          Navigation moves off the bottom edge, where it wastes a
          whole row on a wide screen, and becomes a labelled rail. */}
      <nav
        aria-label="Primary"
        className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-border bg-card lg:flex"
      >
        <div className="flex items-center gap-2.5 px-6 py-7">
          <img src="/the-unsaved-mark.png" alt="" width={32} height={32} className="shrink-0" />
          <span className="text-heading tracking-tight">The Unsaved</span>
        </div>

        <div className="flex flex-1 flex-col gap-1 px-3">
          {TABS.map(({ view: tabView, label, icon: Icon }) => {
            const active = view === tabView;
            return (
              <button
                key={tabView}
                data-tour={`tab-${tabView}`}
                onClick={() => handleClick(tabView)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] items-center gap-3 rounded-md px-3.5 py-2.5 text-sm font-semibold transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', active && 'bg-brand-ring text-white')}>
                  <Icon size={18} strokeWidth={active ? 2.4 : 2} />
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      <Dialog open={pendingView !== null} onOpenChange={(open) => !open && setPendingView(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Continue without saving?</DialogTitle>
            <DialogDescription>
              Your itinerary changes will be lost if you leave now.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" full onClick={() => setPendingView(null)} className="sm:w-auto">
              No, stay
            </Button>
            <Button full onClick={confirmLeave} className="sm:w-auto">
              Yes, leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
