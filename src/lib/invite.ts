import type { Plan } from './supabase';

export function buildInviteMessage(plan: Plan): string {
  const shareUrl = `${window.location.origin}${window.location.pathname}#/plan/${plan.id}/rsvp`;
  const formattedDate = new Date(`${plan.date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${plan.host_name} has invited you to ${plan.title} on ${formattedDate} through Open Finds\n${shareUrl}`;
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
  await copyToClipboard(text);
}
