import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
  The design system's type roles (text-title, text-label, …) set a size, not a
  colour. Without this, merging "text-title text-foreground" would treat both
  as colours and drop one of them.
*/
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'title', 'heading', 'subheading', 'body', 'small', 'label', 'caption'] }],
      shadow: [{ shadow: ['1', '2', '3'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "26 October 2026" in the viewer's locale; null when there is no date. */
export function formatLongDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
