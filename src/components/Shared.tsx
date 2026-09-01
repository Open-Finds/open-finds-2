import type { RsvpStatus, Stop } from '../lib/supabase';
import { MapPin, Clock, ExternalLink, Check, X, Clock3, ChevronLeft } from 'lucide-react';
import { navigate } from '../lib/router';
import { formatTime } from '../lib/time';

export function BackButton({ to }: { to: string }) {
  return (
    <button
      onClick={() => navigate(to)}
      aria-label="Back"
      className="touch-target -ml-2 mb-6 flex items-center justify-center rounded-xl text-gold transition-all duration-200 active:scale-90 active:shadow-gold-press"
    >
      <ChevronLeft size={28} strokeWidth={2.5} />
    </button>
  );
}

export function StatusBadge({ status }: { status: RsvpStatus }) {
  if (status === 'in') {
    return (
      <span className="inline-flex items-center gap-1 text-success text-sm font-medium">
        <Check size={16} /> In
      </span>
    );
  }
  if (status === 'declined') {
    return (
      <span className="inline-flex items-center gap-1 text-danger text-sm font-medium">
        <X size={16} /> Can't make it
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-pending text-sm font-medium">
      <Clock3 size={16} /> Pending
    </span>
  );
}

export function Timeline({
  stops,
}: {
  stops: Stop[];
}) {
  return (
    <div className="relative">
      {stops.map((stop, i) => (
        <div key={stop.id} className="relative flex gap-4 pb-6 last:pb-0">
          {/* connector line */}
          {i < stops.length - 1 && (
            <div className="absolute left-[19px] top-10 bottom-0 w-px bg-gold/40" />
          )}
          {/* numbered dot */}
          <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-black font-bold text-gold">
            {i + 1}
          </div>
          {/* stop card */}
          <div className="card flex-1 animate-fade-in">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold text-white">{stop.name}</h3>
              <span className="inline-flex items-center gap-1 text-gold text-sm font-medium">
                <Clock size={14} /> {formatTime(stop.time)}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1 text-sm text-ink-secondary">
              <MapPin size={14} className="text-gold/70" /> {stop.address}
            </p>
            {stop.vibe_link && (
              <a
                href={stop.vibe_link}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary mt-3 w-full text-sm"
              >
                <ExternalLink size={16} /> Check the vibes
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RsvpList({
  rsvps,
}: {
  rsvps: { id: string; name: string; status: RsvpStatus; decline_reason: string | null }[];
}) {
  if (rsvps.length === 0) {
    return (
      <p className="text-sm text-ink-secondary">No responses yet.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {rsvps.map((r) => (
        <li
          key={r.id}
          className="flex items-center justify-between gap-2 rounded-xl border border-gold/10 bg-black/40 px-4 py-3"
        >
          <div className="min-w-0">
            <p className="truncate font-medium text-white">{r.name}</p>
            {r.status === 'declined' && r.decline_reason && (
              <p className="truncate text-xs text-ink-secondary">
                "{r.decline_reason}"
              </p>
            )}
          </div>
          <StatusBadge status={r.status} />
        </li>
      ))}
    </ul>
  );
}
