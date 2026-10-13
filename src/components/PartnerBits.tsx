import { Check, Clock, Pause, Star, X } from 'lucide-react';
import type { PartnerStatus } from '../lib/supabase';
import { cn } from '../lib/utils';

/** Shared pieces of the admin dashboard and My Venues. */

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-4">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-title text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-bold text-foreground">{value}</dd>
      {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'gold' | 'good' | 'pending' | 'muted' | 'bad'; children: React.ReactNode }) {
  const tones = {
    gold: 'border-border bg-muted text-foreground',
    good: 'border-transparent bg-success-soft text-success',
    pending: 'border-transparent bg-warning-soft text-warning',
    muted: 'border-border bg-muted text-muted-foreground',
    bad: 'border-transparent bg-destructive-soft text-destructive-text',
  };
  return <span className={cn('inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-sm font-medium', tones[tone])}>{children}</span>;
}

/* Status is never colour alone: each has its icon and its word. */
export function StatusBadge({ status }: { status: PartnerStatus }) {
  if (status === 'live') return <Badge tone="good"><Check size={14} aria-hidden /> Live</Badge>;
  if (status === 'pending') return <Badge tone="pending"><Clock size={14} aria-hidden /> Pending</Badge>;
  if (status === 'rejected') return <Badge tone="bad"><X size={14} aria-hidden /> Rejected</Badge>;
  return <Badge tone="muted"><Pause size={14} aria-hidden /> Paused</Badge>;
}

/** "★ 4.5 (12)", or nothing before the first review. */
export function RatingLine({ average, count, className }: { average: number; count: number; className?: string }) {
  if (count === 0) return <span className={cn('text-muted-foreground', className)}>No reviews yet</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Star size={13} className="fill-primary text-primary-text" />
      <span className="font-semibold text-foreground">{average.toFixed(1)}</span>
      <span className="text-muted-foreground">({count} {count === 1 ? 'review' : 'reviews'})</span>
    </span>
  );
}
