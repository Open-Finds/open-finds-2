import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The app reads these at module load; without them supabase.ts throws on import.
if (!import.meta.env.VITE_SUPABASE_URL) {
  (import.meta.env as Record<string, string>).VITE_SUPABASE_URL = 'https://test.supabase.co';
}
if (!import.meta.env.VITE_SUPABASE_ANON_KEY) {
  (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY = 'test-anon-key';
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.location.hash = '';
});

// jsdom implements neither of these, and the app calls both.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

if (!window.scrollTo) {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
}
