import { useEffect, useState } from 'react';
import { Check, Download, Share2 } from 'lucide-react';
import { canInstall, isInstalled, onInstallChange, promptInstall } from '../lib/shareTarget';
import { appBase } from '../lib/invite';

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isAndroid = () => /Android/.test(navigator.userAgent);

/**
 * Settings card: how to share a reel straight into The Unsaved from
 * Instagram or TikTok instead of copying and pasting the link. Android does
 * it once the app is installed; iPhone needs a one-time Shortcut, since only
 * App Store apps can join its share menu.
 */
export function ShareIntoApp() {
  const [installable, setInstallable] = useState(canInstall());
  const [installed, setInstalled] = useState(isInstalled());
  useEffect(() => onInstallChange(() => { setInstallable(canInstall()); setInstalled(isInstalled()); }), []);

  const shortcutUrl = `${appBase()}?url=`;
  const step = 'flex gap-3 text-sm text-ink-secondary';
  const num = 'flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[11px] font-bold text-gold';

  return (
    <section className="mb-6 rounded-card border border-gold/20 bg-[#111] p-5">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gold/70">
        <Share2 size={13} /> Share reels into The Unsaved
      </h2>
      <p className="mb-4 text-sm text-ink-secondary">
        Tap <span className="text-white">Share</span> on a reel or TikTok and send it straight here. No copying and pasting.
      </p>

      {isIOS() ? (
        <ol className="space-y-2.5">
          <li className={step}><span className={num}>1</span><span>Open the <span className="text-white">Shortcuts</span> app and tap <span className="text-white">+</span>.</span></li>
          <li className={step}><span className={num}>2</span><span>Tap the <span className="text-white">ⓘ</span> (or the shortcut's name) and turn on <span className="text-white">Show in Share Sheet</span>.</span></li>
          <li className={step}><span className={num}>3</span><span>Add the action <span className="text-white">URL Encode</span> (it uses the Shortcut Input).</span></li>
          <li className={step}><span className={num}>4</span><span>Add <span className="text-white">Open URLs</span> and type <code className="break-all rounded bg-black/60 px-1 text-gold">{shortcutUrl}</code> followed by the <span className="text-white">URL Encoded Text</span> variable.</span></li>
          <li className={step}><span className={num}>5</span><span>Name it <span className="text-white">The Unsaved</span>. Now on any reel: <span className="text-white">Share → The Unsaved</span>.</span></li>
        </ol>
      ) : installed ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <Check size={16} /> You're set: on any reel tap Share and choose The Unsaved.
        </p>
      ) : installable ? (
        <>
          <button
            onClick={() => void promptInstall()}
            className="flex w-full items-center justify-center gap-2 rounded-card border border-gold/40 bg-black/40 py-3 text-sm font-bold text-gold transition-all active:scale-[0.98] hover:bg-gold/10"
          >
            <Download size={16} /> Install The Unsaved
          </button>
          <p className="mt-2 text-xs text-ink-secondary">Then on any reel tap Share and choose The Unsaved.</p>
        </>
      ) : (
        <ol className="space-y-2.5">
          <li className={step}><span className={num}>1</span><span>{isAndroid() ? 'In Chrome, open the menu (⋮) and tap Install app or Add to Home screen.' : 'Open The Unsaved on your phone and add it to your Home Screen.'}</span></li>
          <li className={step}><span className={num}>2</span><span>On any reel or TikTok, tap <span className="text-white">Share</span> and choose <span className="text-white">The Unsaved</span>.</span></li>
        </ol>
      )}
    </section>
  );
}
