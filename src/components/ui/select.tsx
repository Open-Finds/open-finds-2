import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VenueType } from '@/lib/supabase';

const VENUE_TYPES: { value: VenueType; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'activity', label: 'Activity' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'bar', label: 'Bar' },
];

/**
 * Venue type picker. A native <select> paints its open list with the OS
 * theme (grey rows, blue highlight), which cannot be styled. This menu uses
 * the same black and gold as the field it opens from.
 */
export function VenueTypeSelect({
  value,
  onChange,
  className,
}: {
  value: VenueType;
  onChange: (value: VenueType) => void;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={(next) => onChange(next as VenueType)}>
      <SelectPrimitive.Trigger
        aria-label="Type"
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-left text-white outline-none transition-colors focus:border-gold data-[state=open]:border-gold',
          className,
        )}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} className="shrink-0 text-gold/70" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-[80] max-h-72 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-gold/40 bg-[#111] p-1 shadow-gold-glow"
        >
          <SelectPrimitive.Viewport>
            {VENUE_TYPES.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm text-white outline-none data-[highlighted]:bg-gold/20 data-[highlighted]:text-gold data-[state=checked]:text-gold"
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} className="text-gold" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
