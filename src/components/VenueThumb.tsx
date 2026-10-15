import { useEffect, useRef, useState } from 'react';
import { fetchVenuePhoto } from '../lib/apiKeys';
import { TYPE_ICONS } from '../lib/partners';
import { cn } from '../lib/utils';

/**
 * A venue's photo, when Google has one (Jacky: more character). Shows
 * nothing otherwise. Looks the photo up the first time a venue is shown,
 * when `canFetch` (the caller's own venue).
 */
export function VenueThumb({
  venueId,
  type,
  photoUrl,
  checked,
  canFetch = true,
  className,
}: {
  venueId: string;
  type: string;
  photoUrl?: string | null;
  /** The lookup has been done (photo_checked_at), photo or not. */
  checked?: boolean;
  canFetch?: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(photoUrl ?? null);
  const retried = useRef(false);

  useEffect(() => {
    setUrl(photoUrl ?? null);
    if (checked || photoUrl || !canFetch) return;
    let live = true;
    void fetchVenuePhoto(venueId).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [venueId, photoUrl, checked, canFetch]);

  // No photo, no tile: the category already shows on the card's badge
  // (Robert, 2026-10-15: the big icon repeated it).
  if (!url) return null;

  return (
    <div className={cn('flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-2xl', className)} aria-hidden>
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          // A stored photo address can stop working: look it up again once.
          onError={() => {
            if (retried.current || !canFetch) { setUrl(null); return; }
            retried.current = true;
            void fetchVenuePhoto(venueId, true).then(setUrl);
          }}
        />
      ) : (
        <span>{TYPE_ICONS[type] ?? '📍'}</span>
      )}
    </div>
  );
}
