import { MapPin, Music2, Utensils, Wine, IceCream, Compass, Mountain, Plus, Check } from 'lucide-react';
import { CATEGORY_LABELS, type PlannerVenue } from '../lib/planner';
import { CATEGORY_SHORT } from '../lib/taxonomy';
const icons = { food: Utensils, dessert: IceCream, bar: Wine, activity: Compass, nightlife: Music2, outdoors: Mountain };

export function DiscoveryCard({ venue, selected, onSelect, onOpen, disabled = false, actionLabel, travelLabel, onSave, saved, saving }: {
  venue: PlannerVenue; selected?: boolean; onSelect?: () => void; onOpen?: () => void; disabled?: boolean; actionLabel?: string; travelLabel?: string; onSave?: () => void; saved?: boolean; saving?: boolean;
}) {
  const Icon = icons[venue.category];
  return <article className={`discovery-card adventure-card overflow-hidden rounded-lg border bg-card shadow-1 ${selected ? 'border-primary' : 'border-border'}`}>
    {venue.photo ? <img src={venue.photo} alt="" loading="lazy" className="discovery-photo" />
      : <div className="flex h-24 items-center justify-center bg-muted text-primary-text"><Icon size={30} strokeWidth={1.4} /></div>}
    <div className="p-4">
      <p className="mb-2 text-caption text-muted-foreground" title={CATEGORY_LABELS[venue.category]}>{CATEGORY_SHORT[venue.category]}{venue.source === 'partner' ? ' · Paid placement' : venue.source === 'saved' ? ' · Saved' : venue.source === 'external' ? ' · Google Maps' : ' · Event stop'}</p>
      {onOpen ? <button onClick={onOpen} className="min-h-11 text-left text-subheading text-foreground">{venue.name}</button>
        : <h3 className="text-subheading text-foreground">{venue.name}</h3>}
      <p className="mt-1 flex gap-1 text-small text-muted-foreground"><MapPin size={14} className="mt-0.5 shrink-0" />{venue.address}</p>
      {venue.source === 'external' && <p className="mt-2 text-small text-muted-foreground"><a className="underline" href={venue.link ?? undefined} target="_blank" rel="noopener noreferrer">View on Google Maps</a>{venue.attributions?.map((a, i) => <span key={i}> · {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.provider}</a> : a.provider}</span>)}</p>}
      {travelLabel && <p className="mt-2 text-small text-info">{travelLabel}</p>}
      {venue.startsAt && <p className="mt-2 text-small text-primary-text">{new Date(venue.startsAt).toLocaleString()}</p>}
      {onSelect && <button onClick={onSelect} disabled={disabled && !selected} aria-pressed={selected}
        className={`${selected ? 'btn-secondary' : 'btn-outline'} mt-4 w-full`}>
        {selected ? <Check size={16} /> : <Plus size={16} />}{selected ? 'Selected · remove' : actionLabel || 'Add to itinerary'}
      </button>}
      {onSave && <button className="btn-ghost mt-2 w-full" disabled={saved || saving} onClick={onSave}>{saved ? 'Saved to library' : saving ? 'Saving…' : 'Save to library'}</button>}
    </div>
  </article>;
}
