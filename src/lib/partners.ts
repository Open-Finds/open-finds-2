/** Shared by the admin dashboard, My Venues and Sponsored Venues. */

export const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

export const TYPE_LABELS: Record<string, string> = { food: 'Food', bar: 'Bar', dessert: 'Dessert', activity: 'Activity' };

/** Each category's icon, the same ones the planning screens use. */
export const TYPE_ICONS: Record<string, string> = { food: '🍔', bar: '🍸', dessert: '🍰', activity: '🎯' };

/** "🍔 Food" */
export const typeWithIcon = (type: string) => `${TYPE_ICONS[type] ?? '📍'} ${TYPE_LABELS[type] ?? type}`;
