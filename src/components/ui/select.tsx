import { useRef, useState } from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { VenueType } from '@/lib/supabase';

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const triggerBase =
  'flex h-12 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-left text-base text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:border-ring data-[placeholder]:text-muted-foreground dark:bg-background';

const contentBase =
  'z-[80] max-h-72 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-2';

const itemBase =
  'flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-sm px-3 py-2 text-base text-foreground outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-muted data-[state=checked]:text-primary-text';

/**
 * App-styled select. Native &lt;select&gt; / OS pickers paint light-blue system chrome;
 * this menu uses the app's own surfaces in light and dark.
 */
export function AppSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  ariaLabel,
  className,
  contentClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  contentClassName?: string;
}) {
  /*
    A second tap on the box closes the menu, as it does elsewhere. On touch
    screens Radix closed it on the touch and the tap's click opened it again
    straight away, so it only ever closed by picking something.
  */
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closedByTrigger = useRef(false);
  return (
    <SelectPrimitive.Root
      value={value || undefined}
      onValueChange={onChange}
      open={open}
      onOpenChange={(next) => {
        if (next && closedByTrigger.current) {
          closedByTrigger.current = false;
          return;
        }
        setOpen(next);
      }}
    >
      <SelectPrimitive.Trigger
        ref={triggerRef}
        aria-label={ariaLabel}
        className={cn(triggerBase, className)}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={16} className="shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          onPointerDownOutside={(e) => {
            // While open, taps outside land on the page, not the box, so it's
            // where the tap is that says it was on the box.
            const tap = (e as unknown as CustomEvent<{ originalEvent: PointerEvent }>).detail?.originalEvent;
            const box = triggerRef.current?.getBoundingClientRect();
            if (tap && box && tap.clientX >= box.left && tap.clientX <= box.right && tap.clientY >= box.top && tap.clientY <= box.bottom) {
              closedByTrigger.current = true;
              // Only the reopen that follows this tap is skipped.
              setTimeout(() => { closedByTrigger.current = false; }, 400);
            }
          }}
          className={cn(contentBase, 'w-[var(--radix-select-trigger-width)]', contentClassName)}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={itemBase}
              >
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator>
                  <Check size={14} className="text-primary-text" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

const VENUE_TYPES: { value: VenueType; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'activity', label: 'Activity' },
  { value: 'dessert', label: 'Dessert' },
  { value: 'bar', label: 'Bar' },
];

/** Venue type picker built on AppSelect. */
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
    <AppSelect
      value={value}
      onChange={(next) => onChange(next as VenueType)}
      options={VENUE_TYPES}
      ariaLabel="Type"
      className={className}
    />
  );
}

const HOURS_12 = Array.from({ length: 12 }, (_, i) => {
  const h = i + 1;
  return { value: String(h), label: String(h).padStart(2, '0') };
});

const MINUTES = Array.from({ length: 60 }, (_, i) => {
  const m = String(i).padStart(2, '0');
  return { value: m, label: m };
});

const PERIODS = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
] as const;

function parseTime24(value: string): { hour12: number; minute: string; period: 'AM' | 'PM' } {
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { hour12: 12, minute: '00', period: 'PM' };
  let hours = parseInt(match[1], 10);
  const minute = match[2];
  const period: 'AM' | 'PM' = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return { hour12: hours, minute, period };
}

function toTime24(hour12: number, minute: string, period: 'AM' | 'PM'): string {
  let hours = hour12 % 12;
  if (period === 'PM') hours += 12;
  return `${String(hours).padStart(2, '0')}:${minute}`;
}

const compactTrigger =
  'min-w-0 flex-1 rounded-sm border border-input bg-card px-2 py-1.5 text-sm text-foreground focus:border-ring data-[state=open]:border-ring dark:bg-background';

/**
 * Time picker (HH:MM stored 24h) with the same black/gold menu as AppSelect.
 * Replaces native &lt;input type="time"&gt; whose popup uses OS chrome.
 */
export function TimeSelect({
  value,
  onChange,
  className,
  ariaLabel = 'Time',
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  const { hour12, minute, period } = parseTime24(value || '18:30');

  const commit = (nextHour: number, nextMinute: string, nextPeriod: 'AM' | 'PM') => {
    onChange(toTime24(nextHour, nextMinute, nextPeriod));
  };

  return (
    <div
      className={cn('flex items-center gap-1', className)}
      role="group"
      aria-label={ariaLabel}
    >
      <AppSelect
        value={String(hour12)}
        onChange={(h) => commit(parseInt(h, 10), minute, period)}
        options={HOURS_12}
        ariaLabel="Hour"
        className={compactTrigger}
        contentClassName="min-w-[4.5rem]"
      />
      <span className="shrink-0 text-sm font-semibold text-muted-foreground" aria-hidden>
        :
      </span>
      <AppSelect
        value={minute}
        onChange={(m) => commit(hour12, m, period)}
        options={MINUTES}
        ariaLabel="Minute"
        className={compactTrigger}
        contentClassName="min-w-[4.5rem]"
      />
      <AppSelect
        value={period}
        onChange={(p) => commit(hour12, minute, p as 'AM' | 'PM')}
        options={[...PERIODS]}
        ariaLabel="AM or PM"
        className={cn(compactTrigger, 'max-w-[4.5rem]')}
        contentClassName="min-w-[4.5rem]"
      />
    </div>
  );
}
