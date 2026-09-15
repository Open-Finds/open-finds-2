import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-card text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: 'bg-gold text-black hover:bg-gold-light active:shadow-gold-press',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-gold bg-transparent text-white hover:bg-gold/10 active:shadow-gold-press',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-white hover:bg-gold/10 hover:text-gold',
        link: 'text-gold underline-offset-4 hover:underline',
      },
      size: {
        // 44px floor on the interactive sizes keeps touch targets honest
        default: 'min-h-[44px] px-5 py-3 sm:px-6',
        sm: 'min-h-[36px] rounded-md px-3 text-xs',
        lg: 'min-h-[52px] px-7 py-4 text-base',
        icon: 'size-11 shrink-0',
      },
      full: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'default', size: 'default', full: false },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, full, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, full, className }))} ref={ref} {...props} />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
