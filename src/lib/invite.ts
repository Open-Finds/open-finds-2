import type { Plan } from './supabase';

/**
 * Human-readable invite text, without the link.
 *
 * The share sheet (navigator.share) carries the URL as its own field, so
 * embedding it here as well showed the raw address twice — and on WhatsApp /
 * iMessage the long hash URL dominated the message. The clipboard fallback
 * appends it, because a copied message with no link is useless.
 */
export function buildInviteMessage(plan: Plan, opts: { includeUrl?: boolean } = {}): string {
  const formattedDate = new Date(`${plan.date}T00:00:00`).toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const body = `${plan.host_name} invited you to ${plan.title} — ${formattedDate}. Tap to see the plan and RSVP.`;
  return opts.includeUrl ? `${body}\n${getShareUrl(plan.id)}` : body;
}

/** The app's real address, which links people are sent should always use. */
export const APP_URL = 'https://www.theunsaved.app';

/**
 * Start of a link to send someone: the real domain when the app was opened
 * on an old or Vercel address (open-finds-2.vercel.app), else wherever it's
 * running (so local testing still links to itself).
 */
export function appBase(): string {
  const { hostname, origin, pathname } = window.location;
  return hostname.endsWith('.vercel.app') ? `${APP_URL}/` : `${origin}${pathname}`;
}

export function getShareUrl(planId: string): string {
  return `${appBase()}#/plan/${planId}/rsvp`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareOrCopy(title: string, text: string, url: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch {
      // cancelled — fall through to clipboard
    }
  }
  // Clipboard has no separate URL field, so append it here.
  await copyToClipboard(text.includes(url) ? text : `${text}\n${url}`);
}
