/** Shared by the admin dashboard, My Venues and Sponsored Venues. */

export const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);

export const TYPE_LABELS: Record<string, string> = { food: 'Food', bar: 'Bar', dessert: 'Dessert', activity: 'Activity' };
