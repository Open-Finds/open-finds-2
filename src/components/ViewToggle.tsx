import { useState } from 'react';
import { Home, CalendarDays, Bookmark, Settings, Users, Sparkles } from 'lucide-react';
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

type View = 'home' | 'events' | 'venues' | 'friends' | 'settings';

const TABS: { view: View; label: string; icon: typeof Home }[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'events', label: 'Events', icon: CalendarDays },
  { view: 'venues', label: 'Venues', icon: Bookmark },
  { view: 'friends', label: 'Friends', icon: Users },
  { view: 'settings', label: 'Settings', icon: Settings },
];

export function ViewToggle({
  view,
  onChange,
  isEditingItinerary = false,
}: {
  view: View;
  onChange: (view: View) => void;
  isEditingItinerary?: boolean;
}) {
  const [pendingView, setPendingView] = useState<View | null>(null);

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
        className="fixed inset-x-0 bottom-0 z-50 border-t border-gold/20 bg-[#0d0d0d]/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto flex max-w-2xl items-stretch justify-around">
          {TABS.map(({ view: tabView, label, icon: Icon }) => {
            const active = view === tabView;
            return (
              <button
                key={tabView}
                onClick={() => handleClick(tabView)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] flex-1 flex-col items-center gap-1 py-2.5 transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  active ? 'text-gold' : 'text-ink-secondary hover:text-white'
                )}
              >
                <Icon
                  size={22}
                  strokeWidth={active ? 2.5 : 2}
                  className={active ? 'drop-shadow-[0_0_6px_hsl(var(--primary)/0.5)]' : ''}
                />
                <span className="text-[11px] font-medium">{label}</span>
                <span
                  className={cn(
                    'h-0.5 w-6 rounded-full transition-all',
                    active ? 'bg-gold' : 'bg-transparent'
                  )}
                />
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
        className="fixed inset-y-0 left-0 z-50 hidden w-64 flex-col border-r border-gold/20 bg-[#0d0d0d]/95 backdrop-blur-md lg:flex"
      >
        <div className="flex items-center gap-2.5 px-6 py-7">
          <Sparkles size={22} className="shrink-0 text-gold" />
          <span className="gold-gradient-text text-lg font-bold tracking-tight">Open Finds</span>
        </div>

        <div className="flex flex-1 flex-col gap-1 px-3">
          {TABS.map(({ view: tabView, label, icon: Icon }) => {
            const active = view === tabView;
            return (
              <button
                key={tabView}
                onClick={() => handleClick(tabView)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-[44px] items-center gap-3 rounded-card px-3.5 py-2.5 text-sm font-semibold transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active
                    ? 'bg-gold/10 text-gold'
                    : 'text-ink-secondary hover:bg-white/5 hover:text-white'
                )}
              >
                <Icon size={19} strokeWidth={active ? 2.5 : 2} className="shrink-0" />
                <span>{label}</span>
                {active && <span className="ml-auto h-5 w-0.5 rounded-full bg-gold" />}
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
