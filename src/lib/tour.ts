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
    body: 'Open Save Venues and paste an Instagram, TikTok, Facebook or Google Maps link. The existing link tools help fill in the details before you save.',
  },
  {
    target: 'tab-planner',
    title: 'Plan a night out',
    body: 'Tap Plan for one shared itinerary. Switch between Random Night, Saved Venues, Our Picks and AI Finds without losing your selected stops.',
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
