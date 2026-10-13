import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/* Non-interactive status or metadata. Status colours keep their meaning; `ai` is for AI results only. */
const badgeVariants = cva(
  'inline-flex min-h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-foreground',
        secondary: 'border-border bg-muted text-foreground',
        outline: 'border-border bg-transparent text-foreground',
        selected: 'border-transparent bg-primary-soft text-primary-soft-foreground',
        ai: 'border-transparent bg-ai-soft text-ai-soft-foreground',
        success: 'border-transparent bg-success-soft text-success',
        destructive: 'border-transparent bg-destructive-soft text-destructive-text',
        pending: 'border-transparent bg-warning-soft text-warning',
        info: 'border-transparent bg-info-soft text-info',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
