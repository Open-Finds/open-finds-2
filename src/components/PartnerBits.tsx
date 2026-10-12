import { Star } from 'lucide-react';
import type { PartnerStatus } from '../lib/supabase';
import { cn } from '../lib/utils';

/** Shared pieces of the admin dashboard and My Venues. */

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-card border border-gold/20 bg-[#111] p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gold/70">{label}</p>
      <p className="mt-1 truncate text-2xl font-bold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-secondary">{hint}</p>}
    </div>
  );
}

export function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 font-bold text-white">{value}</dd>
      {hint && <dd className="text-[11px] text-ink-secondary">{hint}</dd>}
    </div>
  );
}

export function Badge({ tone, children }: { tone: 'gold' | 'good' | 'pending' | 'muted' | 'bad'; children: React.ReactNode }) {
  const tones = {
    gold: 'border-gold/30 bg-gold/10 text-gold',
    good: 'border-success/30 bg-success/10 text-success',
    pending: 'border-pending/40 bg-pending/10 text-pending',
    muted: 'border-ink-secondary/30 bg-white/5 text-ink-secondary',
    bad: 'border-danger/40 bg-danger/10 text-danger',
  };
  return <span className={cn('whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function StatusBadge({ status }: { status: PartnerStatus }) {
  if (status === 'live') return <Badge tone="good">Live</Badge>;
  if (status === 'pending') return <Badge tone="pending">Pending</Badge>;
  if (status === 'rejected') return <Badge tone="bad">Rejected</Badge>;
  return <Badge tone="muted">Paused</Badge>;
}

/** "★ 4.5 (12)", or nothing before the first review. */
export function RatingLine({ average, count, className }: { average: number; count: number; className?: string }) {
  if (count === 0) return <span className={cn('text-ink-secondary', className)}>No reviews yet</span>;
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Star size={13} className="fill-gold text-gold" />
      <span className="font-semibold text-white">{average.toFixed(1)}</span>
      <span className="text-ink-secondary">({count} {count === 1 ? 'review' : 'reviews'})</span>
    </span>
  );
}
