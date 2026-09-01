import { useState } from 'react';
import { Home, CalendarDays, Bookmark, Settings, Users } from 'lucide-react';

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

  const cancelLeave = () => {
    setPendingView(null);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-1/2 z-50 w-[800px] max-w-[100vw] -translate-x-1/2 border-t border-gold/20 bg-[#0d0d0d]/95 backdrop-blur-md">
        <div className="flex items-stretch justify-around">
          {TABS.map(({ view: tabView, label, icon: Icon }) => {
            const active = view === tabView;
            return (
              <button
                key={tabView}
                onClick={() => handleClick(tabView)}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 transition-colors ${
                  active ? 'text-gold' : 'text-ink-secondary hover:text-white'
                }`}
              >
                <Icon
                  size={22}
                  strokeWidth={active ? 2.5 : 2}
                  className={active ? 'drop-shadow-[0_0_6px_rgba(212,175,55,0.5)]' : ''}
                />
                <span className="text-[11px] font-medium">{label}</span>
                <span
                  className={`h-0.5 w-6 rounded-full transition-all ${
                    active ? 'bg-gold' : 'bg-transparent'
                  }`}
                />
              </button>
            );
          })}
        </div>
      </nav>

      {pendingView && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-6">
          <div className="w-full max-w-sm rounded-card border border-gold/20 bg-[#0d0d0d] p-6 text-center">
            <p className="text-lg font-bold text-white">Continue without saving?</p>
            <p className="mt-2 text-sm text-ink-secondary">
              Your itinerary changes will be lost if you leave now.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                onClick={cancelLeave}
                className="flex flex-1 items-center justify-center rounded-card border border-gold/40 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98]"
              >
                No, stay
              </button>
              <button
                onClick={confirmLeave}
                className="flex flex-1 items-center justify-center rounded-card bg-gold py-3 text-sm font-bold text-black transition-all active:scale-[0.98]"
              >
                Yes, leave
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
