/** Six product categories mapped onto the existing four-value storage contract.
 * Explicit category tags win; legacy Activity is never guessed to be Outdoors. */
export const CATEGORIES = ['food', 'dessert', 'bar', 'activity', 'nightlife', 'outdoors'] as const;
export type Category = typeof CATEGORIES[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  food: 'Food', dessert: 'Dessert', bar: 'Bar', activity: 'Activity',
  nightlife: 'Nightlife & Music', outdoors: 'Outdoors & Adventure',
};
export const CATEGORY_SHORT: Record<Category, string> = { ...CATEGORY_LABELS, nightlife: 'Nightlife', outdoors: 'Outdoors' };
export const CATEGORY_EMOJI: Record<Category, string> = { food: '🍔', dessert: '🍰', bar: '🍸', activity: '🎯', nightlife: '🎵', outdoors: '🏞️' };
export type StorageType = 'food' | 'dessert' | 'bar' | 'activity';
const key = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
const aliases: Record<string, string> = {
  pho: 'specialty:pho', 'banh mi': 'specialty:banh_mi', kbbq: 'specialty:korean_bbq',
  'korean bbq': 'specialty:korean_bbq', 'korean barbecue': 'specialty:korean_bbq',
  ramen: 'specialty:ramen', sushi: 'specialty:sushi', pizza: 'specialty:pizza', dumplings: 'specialty:dumplings',
  'noodle soup': 'specialty:noodle_soup',
  ...Object.fromEntries(['vietnamese', 'japanese', 'korean', 'chinese', 'thai', 'italian'].map((v) => [v, `cuisine:${v}`])),
  'budget friendly': 'attribute:budget_friendly', casual: 'attribute:casual', 'fine dining': 'attribute:fine_dining',
  'outdoor seating': 'attribute:outdoor_seating', 'late night': 'attribute:late_night', 'family friendly': 'attribute:family_friendly',
  'nightlife music': 'category:nightlife', 'nightlife & music': 'category:nightlife', nightlife: 'category:nightlife',
  'live music': 'category:nightlife', 'dj night': 'category:nightlife',
  'outdoors adventure': 'category:outdoors', 'outdoors & adventure': 'category:outdoors', outdoors: 'category:outdoors',
};
export const SPECIALTY_PARENTS: Record<string, string> = { pho: 'noodle_soup', ramen: 'noodle_soup' };
/** Automatic structured tags require explicit venue-specific evidence.
 * A cuisine alone is never evidence of a specialty or price claim. */
export function supportedExtractionTags(tags: string[], evidence: string): string[] {
  const text = ` ${key(evidence).replace(/[^\p{L}\p{N}\s]/gu, ' ')} `;
  return normalizeTags(tags.filter((tag) => {
    const canonical = aliases[key(tag)];
    if (!canonical) return false;
    return Object.entries(aliases).some(([alias, value]) => value === canonical && text.includes(` ${alias} `));
  }));
}
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.filter((t) => typeof t === 'string').map((t) => {
    const raw = t.trim();
    return aliases[key(raw)] ?? raw;
  }).filter((t) => { const id = key(t); if (!t || seen.has(id)) return false; seen.add(id); return true; });
}
export function tagLabel(tag: string): string {
  const normalized = normalizeTags([tag])[0] ?? tag;
  if (normalized.startsWith('category:')) return CATEGORY_LABELS[normalized.slice(9) as Category] ?? tag;
  if (/^(cuisine|specialty|attribute):/.test(normalized)) return normalized.split(':')[1].replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return tag;
}
export function categoryOf(v: { type: string; tags?: string[] | null; name?: string }): Category {
  const tags = normalizeTags(v.tags ?? []);
  const explicit = tags.find((t) => t.startsWith('category:') && CATEGORIES.includes(t.slice(9) as Category));
  if (explicit) return explicit.slice(9) as Category;
  if ((v.type === 'bar' || v.type === 'activity') && /nightclub|live music/i.test(v.name ?? '')) return 'nightlife';
  if (CATEGORIES.includes(v.type as Category)) return v.type as Category;
  return 'activity';
}
/** Multiple categories require explicit tags; legacy Bar alone never implies Nightlife. */
export function categoriesOf(v: { type: string; tags?: string[] | null; name?: string }): Category[] {
  const explicit = normalizeTags(v.tags ?? []).filter((t) => t.startsWith('category:')).map((t) => t.slice(9) as Category).filter((c) => CATEGORIES.includes(c));
  return explicit.length ? [...new Set(explicit)] : [categoryOf(v)];
}
export function categoryStorage(category: Category, tags: string[]): { type: StorageType; tags: string[] } {
  // Changing the primary category removes only category markers, never custom tags.
  const remaining = normalizeTags(tags).filter((t) => !t.startsWith('category:'));
  return { type: category === 'outdoors' ? 'activity' : category === 'nightlife' ? 'bar' : category,
    tags: [...remaining, `category:${category}`] };
}
export function classifyVenue(v: { type: string; tags?: string[] | null; name?: string }) {
  const tags = normalizeTags(v.tags ?? []);
  const values = (prefix: string) => tags.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length));
  return { category: categoryOf(v), cuisines: values('cuisine:'), specialties: values('specialty:'),
    attributes: values('attribute:'), customTags: tags.filter((t) => !/^(category|cuisine|specialty|attribute):/.test(t)) };
}
export function matchesTaxonomy(v: { name: string; address: string; tags: string[] }, query: string): boolean {
  const needle = key(query); if (!needle) return true;
  const normalized = aliases[needle] ?? query;
  const tags = normalizeTags(v.tags);
  const broader = tags.flatMap((t) => t.startsWith('specialty:') && SPECIALTY_PARENTS[t.slice(10)] ? [`specialty:${SPECIALTY_PARENTS[t.slice(10)]}`] : []);
  return key(`${v.name} ${v.address} ${[...tags, ...broader].join(' ')}`).includes(key(normalized));
}
export type Vibe = { id: string; label: string; cuisine?: string; category?: Category; occasion?: string; budget?: string; mood?: string; specialty?: string };
export const VIBE_GROUPS: Vibe[][] = [
  [{ id: 'japanese', label: 'Japanese night', cuisine: 'japanese' }, { id: 'date', label: 'Date night', occasion: 'date' }, { id: 'cheap', label: 'Cheap eats', budget: 'budget_friendly' }],
  [{ id: 'vietnamese', label: 'Vietnamese eats', cuisine: 'vietnamese' }, { id: 'music', label: 'Live music', category: 'nightlife' }, { id: 'spontaneous', label: 'Something spontaneous', mood: 'spontaneous' }],
  [{ id: 'kbbq', label: 'Korean BBQ', specialty: 'korean_bbq' }, { id: 'rooftop', label: 'Rooftop drinks', category: 'bar', mood: 'rooftop' }, { id: 'dessert', label: 'Dessert crawl', category: 'dessert' }],
  [{ id: 'italian', label: 'Italian dinner', cuisine: 'italian' }, { id: 'group', label: 'Group hangout', occasion: 'group' }, { id: 'adventure', label: 'Weekend adventure', category: 'outdoors' }],
];
export const VIBES = VIBE_GROUPS.flat();
/** Structured known facts first; budget/occasion/mood guide ranking, not claims. */
export function matchesVibes(v: { category: Category; tags: string[] }, selected: string[]): boolean {
  const requested = VIBES.filter((s) => selected.includes(s.id));
  const cuisines = requested.flatMap((s) => s.cuisine ? [s.cuisine] : []);
  const specialties = requested.flatMap((s) => s.specialty ? [s.specialty] : []);
  const categories = requested.flatMap((s) => s.category ? [s.category] : []);
  const tags = normalizeTags(v.tags);
  return (!cuisines.length || cuisines.some((c) => tags.includes(`cuisine:${c}`)))
    && (!specialties.length || specialties.some((s) => tags.includes(`specialty:${s}`)))
    && (!categories.length || categories.includes(v.category));
}
