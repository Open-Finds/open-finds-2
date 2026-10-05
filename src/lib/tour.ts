/**
 * What the walkthrough says, and where each step points (data-tour="…").
 * Kept out of the component so the copy is easy to find and change.
 */

export const DIETARY_OPTIONS = [
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten-free', label: 'Gluten-Free' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
  { key: 'dairy-free', label: 'Dairy-Free' },
  { key: 'nut-allergy', label: 'Nut Allergy' },
  { key: 'egg-free', label: 'Egg-Free' },
  { key: 'soy-allergy', label: 'Soy Allergy' },
  { key: 'shellfish-allergy', label: 'Shellfish Allergy' },
  { key: 'pescatarian', label: 'Pescatarian' },
] as const;

export type TourStep = { target: string; title: string; body: string; dietary?: boolean };

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'save-venue',
    title: 'Save places from any link',
    body: 'Paste an Instagram, TikTok, Facebook or Google Maps link here and tap Extract Venue. We fill in the name, address and type for you, so your saved list builds itself.',
  },
  {
    target: 'plan-night',
    title: 'Plan a night out',
    body: 'Tap Start Planning, pick your vibes and how far you’ll travel. We build a night with times and stops from your saved places, or find somewhere new.',
  },
  {
    target: 'tab-friends',
    title: 'Bring your friends',
    body: 'Add friends here and make group collections you all add places to. When a plan is ready, invite them in the app or share the link. Anyone can RSVP, even without the app.',
  },
  {
    target: 'tab-settings',
    title: 'Your dietary needs',
    body: 'Pick any that apply and we’ll only suggest places that suit you. You can change them, or replay this tour, in Settings.',
    dietary: true,
  },
];
