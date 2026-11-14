import type { Plan } from './supabase';
import { Capacitor } from '@capacitor/core';
import { nativeShare } from './nativeShare';
import { recommendationOrigin, stagingSupabase } from './publicRecommendation.js';

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
  const url = opts.includeUrl ? getShareUrl(plan.id) : '';
  return url ? [body, url].join('\n') : body;
}

/** The app's real address, which links people are sent should always use. */
export const APP_URL = 'https://www.theunsaved.app';

/**
 * Start of a link to send someone: the real domain when the app was opened
 * on an old or Vercel address (open-finds-2.vercel.app), else wherever it's
 * running (so local testing still links to itself).
 */
export function appBase(): string {
  if (import.meta.env.VITE_SUPABASE_URL === stagingSupabase) {
    const origin = recommendationOrigin(true, import.meta.env.VITE_RECOMMENDATION_ORIGIN, import.meta.env.VITE_STAGING_RECOMMENDATION_ORIGIN);
    return origin ? origin + '/' : '';
  }
  const { hostname, origin, pathname } = window.location;
  return hostname.endsWith('.vercel.app') ? `${APP_URL}/` : `${origin}${pathname}`;
}

export function getShareUrl(planId: string): string {
  const base = appBase();
  return base ? base + '#/plan/' + planId + '/rsvp' : '';
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function shareOrCopy(title: string, text: string, url: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (!url) throw new Error('Public sharing is unavailable.');
  const full = text.includes(url) ? text : [text.trim(), url].filter(Boolean).join('\n');
  if (Capacitor.getPlatform() === 'android') {
    try {
      await nativeShare.send({ text: full });
      return 'shared';
    } catch {
      // The WebView clipboard is still useful if the native chooser cannot open.
    }
  } else if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError') return 'cancelled';
    }
  }
  if (!await copyToClipboard(full)) throw new Error('Could not open sharing or copy the link.');
  return 'copied';
}
