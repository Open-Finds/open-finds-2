import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { suggestAddresses, type AddressSuggestion } from '../lib/apiKeys';
import { cn } from '../lib/utils';

/**
 * An address box with a drop-down of matching addresses as you type, like
 * most apps, so people pick the right address instead of typing it in full.
 * Typing freely still works; picking just fills the box.
 */
export function AddressInput({
  value,
  onChange,
  placeholder,
  className,
  near,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Classes for the input itself. */
  className?: string;
  /** Suggest nearby first. */
  near?: { lat: number; lon: number } | null;
  ariaLabel?: string;
  id?: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Only look up what the person typed, not what a pick just filled in.
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current || value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const list = await suggestAddresses(value, near, controller.signal);
      if (!controller.signal.aborted) {
        setSuggestions(list);
        setActive(-1);
        setOpen(list.length > 0);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, near]);

  const pick = (s: AddressSuggestion) => {
    typed.current = false;
    onChange(s.text);
    setSuggestions([]);
    setOpen(false);
  };

  const listId = `${id ?? 'address'}-suggestions`;

  return (
    <div className="relative">
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => { typed.current = true; onChange(e.target.value); }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        // Long enough for a tap on a suggestion to land first.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || suggestions.length === 0) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(suggestions[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        className={className}
      />
      {open && suggestions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-[60] mt-1 overflow-hidden rounded-card border border-gold/40 bg-[#111] py-1 shadow-gold-glow"
        >
          {suggestions.map((s, i) => (
            <li
              key={`${s.text}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: it lands before the input's blur.
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              className={cn(
                'flex cursor-pointer items-start gap-2 px-3 py-2.5 text-sm',
                i === active ? 'bg-gold/20 text-gold' : 'text-white hover:bg-gold/10'
              )}
            >
              <MapPin size={15} className="mt-0.5 shrink-0 text-gold/70" />
              <span className="min-w-0">
                <span className="block truncate font-medium">{s.main}</span>
                {s.secondary && <span className="block truncate text-xs text-ink-secondary">{s.secondary}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
