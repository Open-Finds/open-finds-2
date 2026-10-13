import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { SegmentedControl } from './ui/segmented-control';

export const THEME_STORAGE_KEY = 'the-unsaved-theme';

/**
 * Light, dark or the device's setting, remembered on this device. Sets
 * `.dark` on <html>, which is what switches the design tokens (index.css).
 * index.html applies the saved choice before the first paint.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem storageKey={THEME_STORAGE_KEY} disableTransitionOnChange>
      {children}
    </NextThemesProvider>
  );
}

const OPTIONS = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** The appearance setting; takes effect immediately. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return <SegmentedControl ariaLabel="Appearance" value={theme ?? 'system'} onChange={setTheme} options={OPTIONS} />;
}
