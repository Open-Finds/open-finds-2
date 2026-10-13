import { RefreshCw, WifiOff } from 'lucide-react';

/** Shown when a screen couldn't load (usually a dropped connection), instead of spinning forever. */
export function LoadError({ onRetry, className = '' }: { onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={`rounded-lg border border-border bg-card p-8 text-center ${className}`}>
      <WifiOff size={28} className="mx-auto mb-3 text-muted-foreground" />
      <p className="font-semibold text-foreground">Couldn't load this</p>
      <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
      <button
        onClick={onRetry}
        className="mx-auto mt-4 flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground transition-all hover:bg-muted active:scale-95"
      >
        <RefreshCw size={15} /> Try again
      </button>
    </div>
  );
}
