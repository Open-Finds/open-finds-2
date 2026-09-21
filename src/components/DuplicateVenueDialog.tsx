import { AlertTriangle, MapPin, Link2 } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { describeMatch, type VenueMatch, type VenueCandidate } from '../lib/venueMatch';

/**
 * "You might already have this." Shows what the user is about to add next to
 * what it looks like, and leaves the call to them.
 *
 * For a multi-add (a reel listing five places), `pending` carries every item
 * that matched something, and a third option lets them keep only the new ones.
 */
export type PendingDuplicate = {
  candidate: VenueCandidate;
  matches: VenueMatch[];
};

export function DuplicateVenueDialog({
  pending,
  onAddAnyway,
  onSkipDuplicates,
  onCancel,
}: {
  pending: PendingDuplicate[] | null;
  onAddAnyway: () => void;
  /** Only offered when there is something non-duplicate left to add. */
  onSkipDuplicates?: () => void;
  onCancel: () => void;
}) {
  const open = !!pending && pending.length > 0;
  const many = (pending?.length ?? 0) > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-pending" />
            {many ? 'Some of these look like venues you already have' : 'Looks like you already have this one'}
          </DialogTitle>
          <DialogDescription>
            Have a look and decide — it might be the same place, or a different branch.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50dvh] space-y-4 overflow-y-auto pr-1">
          {pending?.map((p, i) => (
            <div key={i} className="rounded-card border border-gold/15 bg-black/30 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">Adding</p>
              <p className="mt-0.5 font-semibold text-white">{p.candidate.name}</p>
              <p className="flex items-start gap-1 text-xs text-ink-secondary">
                <MapPin size={12} className="mt-0.5 shrink-0" /> {p.candidate.address}
              </p>

              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                Already saved
              </p>
              <ul className="mt-1 space-y-2">
                {p.matches.slice(0, 3).map((m) => (
                  <li key={m.venue.id} className="rounded-lg border border-gold/25 bg-surface p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate font-semibold text-gold">{m.venue.name}</p>
                      <Badge variant="outline" className="shrink-0">{describeMatch(m)}</Badge>
                    </div>
                    <p className="mt-0.5 flex items-start gap-1 text-xs text-ink-secondary">
                      <MapPin size={12} className="mt-0.5 shrink-0" /> {m.venue.address}
                    </p>
                    {m.venue.link && (
                      <a
                        href={m.venue.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-xs text-gold/80 underline-offset-2 hover:underline"
                      >
                        <Link2 size={11} /> Open saved link
                      </a>
                    )}
                    {m.venue.collection && (
                      <p className="mt-1 text-xs text-ink-secondary">In “{m.venue.collection}”</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onCancel} className="sm:w-auto">Cancel</Button>
          {onSkipDuplicates && (
            <Button variant="outline" onClick={onSkipDuplicates} className="sm:w-auto">
              Add only the new ones
            </Button>
          )}
          <Button onClick={onAddAnyway} className="sm:w-auto">
            {many ? 'Add all anyway' : 'Add anyway'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
