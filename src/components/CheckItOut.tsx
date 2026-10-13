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
          ? 'inline-flex min-h-7 items-center gap-1 rounded-full border border-border bg-muted px-2.5 text-xs font-medium text-foreground transition-colors hover:border-input'
          : 'btn-outline btn-sm',
        className,
      )}
    >
      <span aria-hidden="true">🎬</span> Check it out
    </a>
  );
}
