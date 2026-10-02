import { linkHref } from '../lib/links';
import { cn } from '../lib/utils';

/**
 * The link to a venue's reel, video or page. Every screen uses this one
 * label, whatever the link points to.
 */
export function CheckItOut({
  link,
  variant = 'button',
  className,
}: {
  link: string | null | undefined;
  /** 'pill' for compact cards; 'button' for stop cards. */
  variant?: 'button' | 'pill';
  className?: string;
}) {
  const href = linkHref(link);
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        variant === 'pill'
          ? 'inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold transition-colors hover:bg-gold/20'
          : 'inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-card border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold transition-all hover:bg-gold/20 active:scale-95',
        className,
      )}
    >
      <span aria-hidden="true">🎬</span> Check it out
    </a>
  );
}
