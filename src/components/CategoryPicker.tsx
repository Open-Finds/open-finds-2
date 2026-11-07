import { AppSelect } from './ui/select';
import { CATEGORIES, CATEGORY_LABELS, categoryOf, categoryStorage, type StorageType } from '../lib/taxonomy';
export function CategoryPicker({ type, tags, onChange }: { type: StorageType; tags: string[]; onChange: (value: { type: StorageType; tags: string[] }) => void }) {
  return <AppSelect value={categoryOf({ type, tags })} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
    ariaLabel="Venue category" onChange={(value) => onChange(categoryStorage(value as typeof CATEGORIES[number], tags))} />;
}
