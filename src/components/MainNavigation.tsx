import { BRAND } from '../lib/brand';
import { BrandLogo } from './BrandLogo';
import { Home, CalendarDays, Plus, Bookmark, Users, Settings } from 'lucide-react';
export type AppView = 'home' | 'events' | 'planner' | 'venues' | 'friends' | 'settings';
const tabs = [{ id: 'home', label: 'Home', Icon: Home }, { id: 'events', label: 'Events', Icon: CalendarDays },
  { id: 'planner', label: 'Plan', Icon: Plus }, { id: 'venues', label: 'Venues', Icon: Bookmark }, { id: 'friends', label: 'Friends', Icon: Users }] as const;
export function MainNavigation({ view, onChange }: { view: AppView; onChange: (view: AppView) => void }) {
  return <><nav className="ux-bottom" aria-label="Primary"><div className="mx-auto flex max-w-xl items-end justify-around">{tabs.map(({ id, label, Icon }) =>
    <button key={id} data-tour={`tab-${id}`} onClick={() => onChange(id)} aria-current={view === id ? 'page' : undefined}
      className={`ux-tab ${view === id ? 'text-primary-text' : 'text-muted-foreground'}`}>
      <span className={id === 'planner' ? 'ux-plan-button' : 'flex h-8 items-center justify-center'}><Icon size={id === 'planner' ? 26 : 21} /></span><span className="text-caption">{label}</span>
    </button>)}</div></nav>
    <aside className="ux-sidebar"><div className="mb-10 px-3"><BrandLogo /></div>
      <nav aria-label="Desktop primary" className="space-y-2">{[...tabs, { id: 'settings' as const, label: 'Settings', Icon: Settings }].map(({ id, label, Icon }) => <button key={id} onClick={() => onChange(id)} aria-current={view === id ? 'page' : undefined}
        className={`flex min-h-12 w-full items-center gap-3 rounded-md px-4 text-label ${view === id ? 'bg-primary-soft text-primary-text' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={20} />{label}</button>)}</nav>
      <p className="mt-auto px-3 text-small text-muted-foreground">{BRAND.tagline}</p></aside></>;
}
