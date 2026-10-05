import { RefreshCw, WifiOff } from 'lucide-react';

/** Shown when a screen couldn't load (usually a dropped connection), instead of spinning forever. */
export function LoadError({ onRetry, className = '' }: { onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={`rounded-card border border-gold/20 bg-[#1a1a1a] p-8 text-center ${className}`}>
      <WifiOff size={28} className="mx-auto mb-3 text-gold/50" />
      <p className="font-semibold text-white">Couldn't load this</p>
      <p className="mt-1 text-sm text-ink-secondary">Check your connection and try again.</p>
      <button
        onClick={onRetry}
        className="mx-auto mt-4 flex items-center gap-2 rounded-card border border-gold/40 px-4 py-2 text-sm font-bold text-gold transition-all hover:bg-gold/10 active:scale-95"
      >
        <RefreshCw size={15} /> Try again
      </button>
    </div>
  );
}
