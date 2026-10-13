import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The design system's segmented control: one choice between closely
 * related modes. The chosen one is a raised neutral tab, not amber.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: LucideIcon }[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-grid min-h-11 grid-flow-col gap-1 rounded-md bg-muted p-1', className)}>
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={cn(
              'text-small inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border px-4 transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'border-border bg-card text-foreground shadow-1' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {Icon && <Icon size={16} aria-hidden />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
