import { useState, useRef, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';

export function HelpTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="What does this do?"
        className="flex h-4 w-4 items-center justify-center rounded-full text-gold/50 transition-colors hover:text-gold active:scale-90"
      >
        <HelpCircle size={14} />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-1/2 z-50 mb-2 w-48 -translate-x-1/2 rounded-card border border-gold/30 bg-[#1a1a1a] px-3 py-2.5 text-xs leading-relaxed text-ink-secondary shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          {text}
          <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-gold/30" />
        </div>
      )}
    </div>
  );
}
