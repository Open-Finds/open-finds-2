import { afterEach, expect, it, vi } from 'vitest';
import { scrollToSection } from './flow';
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])('scrolls only when invoked and respects reduced motion %s', (reduced) => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  const section = document.createElement('section');
  section.scrollIntoView = vi.fn(); section.focus = vi.fn();
  expect(section.scrollIntoView).not.toHaveBeenCalled();
  scrollToSection({ current: section });
  expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  expect(section.focus).toHaveBeenCalledWith({ preventScroll: true });
});
