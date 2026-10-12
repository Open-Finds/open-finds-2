/**
 * "Share to The Unsaved" from Instagram, TikTok, Google Maps or a browser.
 *
 * Android: once the app is installed (Add to Home screen), the manifest's
 * share_target puts it in the share menu, and a share opens
 * /?title=…&text=…&url=…. iPhone: websites can't join the share menu, so an
 * Apple Shortcut opens /?url=… instead. Either way the link is kept here at
 * startup and the Home screen extracts the venue from it, after sign-in if
 * need be.
 */
const KEY = 'unsaved_shared_link';

/** The first web link in a share. Instagram and TikTok put it in "text", among the caption. */
export function linkFromShare(params: URLSearchParams): string | null {
  for (const key of ['url', 'text', 'title']) {
    const match = params.get(key)?.match(/https?:\/\/[^\s<>"']+/i);
    if (match) return match[0].replace(/[).,!?…]+$/, '');
  }
  return null;
}

/** Run once before the app draws: keep a shared link and tidy the address bar. */
export function captureSharedLink(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (!['url', 'text', 'title'].some((k) => params.has(k))) return;
    const link = linkFromShare(params);
    if (link) sessionStorage.setItem(KEY, link);
    window.history.replaceState(null, '', `${window.location.pathname}#/`);
  } catch { /* storage blocked: the user can still paste the link */ }
}

/** The shared link waiting to be saved, once; null when there isn't one. */
export function takeSharedLink(): string | null {
  try {
    const link = sessionStorage.getItem(KEY);
    if (link) sessionStorage.removeItem(KEY);
    return link;
  } catch {
    return null;
  }
}

/* ── Installing the app (Android and desktop Chrome) ──
   Chrome offers the install prompt once, early; keep it so Settings can show
   an "Install The Unsaved" button. */
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();

export function listenForInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installListeners.forEach((fn) => fn());
  });
}

export function canInstall(): boolean {
  return installPrompt !== null;
}

export function onInstallChange(fn: () => void): () => void {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  if (!installPrompt) return false;
  await installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  installListeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

/** Running as the installed app rather than in a browser tab. */
export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
}
