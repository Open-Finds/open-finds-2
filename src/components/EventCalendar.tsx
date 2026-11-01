import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { localDate } from '../lib/planner';
export function EventCalendar({ dates, selected, onSelect }: { dates: string[]; selected: string | null; onSelect: (date: string | null) => void }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const offset = (month.getDay() + 6) % 7;
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const move = (delta: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + delta, 1)); onSelect(null); };
  return <section className="mb-5 rounded-lg border border-border bg-card p-4" aria-label="Event calendar"><div className="mb-5 flex items-center justify-between"><button className="ux-icon" onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button><h2 className="text-subheading">{month.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</h2><button className="ux-icon" onClick={() => move(1)} aria-label="Next month"><ChevronRight size={16} /></button></div>
    <div className="ux-calendar">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => <span key={i} className="py-2 text-center text-caption text-muted-foreground">{label}</span>)}
      {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} />)}
      {Array.from({ length: count }, (_, i) => { const day = new Date(month.getFullYear(), month.getMonth(), i + 1); const date = localDate(day); const hasEvent = dates.includes(date);
        return <button key={date} onClick={() => onSelect(selected === date ? null : date)} aria-label={`${day.toLocaleDateString('en-AU')}${hasEvent ? ', events planned' : ''}`} aria-pressed={selected === date} className={`${date === localDate() ? 'border border-primary' : ''} ${hasEvent && selected !== date ? 'bg-primary-soft text-primary-text' : ''}`}>{i + 1}{hasEvent && <span className="event-dot" />}</button>; })}</div>
    {selected && <button className="mt-4 min-h-11 text-small text-primary-text" onClick={() => onSelect(null)}>Show all events</button>}
  </section>;
}
