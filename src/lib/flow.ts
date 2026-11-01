import type { RefObject } from 'react';
export function scrollToSection(target: RefObject<HTMLElement>) {
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  target.current?.focus({ preventScroll: true });
}
