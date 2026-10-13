import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
  The design system's button (CLAUDE.md): one filled primary per view, the
  warm gradient is the primary's and nothing else's, and `ai` (violet) is
  only for AI actions.
*/
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-base transition-[background-color,color,border-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.98] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary-gradient text-primary-foreground hover:bg-primary-gradient-hover active:bg-primary-gradient-active',
        secondary: 'bg-muted text-foreground hover:bg-accent',
        outline: 'border border-input bg-transparent text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        ai: 'bg-ai text-ai-foreground hover:bg-ai/90',
        link: 'text-primary-text underline-offset-4 hover:underline',
      },
      size: {
        // 44px on the default keeps touch targets honest
        default: 'h-11 px-5',
        sm: 'h-9 px-3 text-sm',
        lg: 'h-[52px] px-6',
        icon: 'size-11',
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
