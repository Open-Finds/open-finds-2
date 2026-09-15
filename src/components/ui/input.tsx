import * as React from 'react';
import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        // 16px base font on mobile stops iOS Safari zooming the viewport on focus
        'flex min-h-[44px] w-full rounded-card border border-gold/20 bg-black/40 px-4 py-3 text-base text-white',
        'placeholder:text-ink-secondary',
        'focus:border-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'sm:text-sm',
        className
      )}
      {...props}
    />
  )
);
Input.displayName = 'Input';

export { Input };
