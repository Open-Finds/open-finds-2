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

export function getShareUrl(planId: string): string {
  return `${window.location.origin}${window.location.pathname}#/plan/${planId}/rsvp`;
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
