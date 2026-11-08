import { Home, CalendarDays, Plus, Bookmark, Compass, Users, Settings } from 'lucide-react';
export type AppView = 'home' | 'events' | 'planner' | 'venues' | 'friends' | 'settings' | 'discover';
const tabs = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'venues', label: 'Saved', Icon: Bookmark },
  { id: 'planner', label: 'Create a plan', Icon: Plus },
  { id: 'events', label: 'Plans', Icon: CalendarDays },
  { id: 'discover', label: 'Discover', Icon: Compass },
] as const;
export function MainNavigation({ view, onChange }: { view: AppView; onChange: (view: AppView) => void }) {
  return <><nav className="ux-bottom reference-nav" aria-label="Primary"><div className="mx-auto flex max-w-xl items-end justify-around">{tabs.map(({ id, label, Icon }) =>
    <button key={id} data-tour={`tab-${id}`} onClick={() => onChange(id)} aria-label={label} aria-current={view === id ? 'page' : undefined}
      className={`ux-tab ${view === id ? 'text-primary-text' : 'text-muted-foreground'}`}>
      <span className={id === 'planner' ? 'ux-plan-button' : 'flex h-8 items-center justify-center'}><Icon size={id === 'planner' ? 26 : 21} /></span>{id !== 'planner' && <span className="text-caption">{label}</span>}
    </button>)}</div></nav>
    <aside className="ux-sidebar">
      <div className="mb-10 px-3">
        <img src="/brand/orbit-standalone.webp" alt="The Unsaved" width="64" height="64" className="block size-16 object-contain" />
      </div>
      <nav aria-label="Desktop primary" className="space-y-2">{[...tabs, { id: 'friends' as const, label: 'Friends', Icon: Users }, { id: 'settings' as const, label: 'Settings', Icon: Settings }].map(({ id, label, Icon }) => <button key={id} onClick={() => onChange(id)} aria-current={view === id ? 'page' : undefined}
        className={`flex min-h-12 w-full items-center gap-3 rounded-md px-4 text-label ${view === id ? 'bg-primary-soft text-primary-text' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={20} />{label}</button>)}</nav>
    </aside></>;
}
