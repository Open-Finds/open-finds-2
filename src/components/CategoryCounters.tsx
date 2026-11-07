import { Utensils, IceCream, Wine, Compass, Music2, Mountain, Minus, Plus } from 'lucide-react';
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_SHORT, type Category } from '../lib/taxonomy';
const icons = { food: Utensils, dessert: IceCream, bar: Wine, activity: Compass, nightlife: Music2, outdoors: Mountain };
export function CategoryCounters({ counts, onChange }: { counts: Record<Category, number>; onChange: (category: Category, delta: number) => void }) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return <fieldset className="mb-5 min-w-0"><legend className="mb-3 text-label">Desired mix <span className="text-small font-normal text-muted-foreground">· optional · {total}/6 preferences</span></legend>
    <div className="grid grid-cols-3 gap-2" aria-label="Category preferences">{CATEGORIES.map((c) => { const Icon = icons[c]; return <div key={c} className={`flex min-w-0 flex-col items-center rounded-lg border px-0.5 py-3 ${counts[c] ? 'border-primary bg-primary-soft' : 'border-border bg-card'}`}>
      <Icon size={23} className="mb-2 text-info" aria-hidden="true" /><span className="text-small font-semibold" title={CATEGORY_LABELS[c]}>{CATEGORY_SHORT[c]}</span>
      <output className="mt-1 text-center text-small tabular-nums" aria-label={`${CATEGORY_LABELS[c]} desired stops`}>{counts[c]}</output>
      <div className="flex w-full items-center justify-center"><button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-md text-primary-text focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Fewer ${CATEGORY_LABELS[c]} stops`} disabled={!counts[c]} onClick={() => onChange(c, -1)}><Minus size={16} /></button>
        <button type="button" className="flex size-11 shrink-0 items-center justify-center rounded-md text-primary-text focus-visible:ring-2 focus-visible:ring-ring" aria-label={`More ${CATEGORY_LABELS[c]} stops`} disabled={total >= 6} onClick={() => onChange(c, 1)}><Plus size={16} /></button></div>
    </div>; })}</div><p className="sr-only">Choose any mix. Preferences never remove selected places.</p>
  </fieldset>;
}
