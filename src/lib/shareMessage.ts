import { cleanVenueName } from './publicRecommendation.js';

/** What the venue chips type into the message. The real name and address are filled in when the message is sent. */
export const VENUE_TOKEN = '[venue name]';
export const ADDRESS_TOKEN = '[address]';

/** Quick starting points for the message. The first is shown first; the shuffle button cycles through them. */
export const PRESET_MESSAGES = ["Let's check this out! 🤩", '🤤🤤🤤', 'Can we try this?', 'Down?'] as const;

/** The preset after `current`, so tapping shuffle always shows something new. */
export function nextPreset(current: string): string {
  const index = PRESET_MESSAGES.indexOf(current as typeof PRESET_MESSAGES[number]);
  return PRESET_MESSAGES[(index + 1) % PRESET_MESSAGES.length];
}

/** `insert` placed where the cursor is (or replacing the selection), with a space kept between it and the words around it. */
export function insertAtCursor(value: string, insert: string, start: number, end: number): { value: string; cursor: number } {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  const before = value.slice(0, from);
  const after = value.slice(to);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^\s/.test(after) ? ' ' : '';
  const text = before + lead + insert + trail;
  return { value: text + after, cursor: text.length };
}

/**
 * The message that is actually sent: the venue chips replaced with the verified name and address.
 * A chip with nothing to fill it (no venue found) is dropped, so a friend never sees a raw placeholder.
 */
export function resolveMessage(template: string, venue?: { name?: string | null; address?: string | null }): string {
  const name = cleanVenueName(venue?.name);
  const address = (venue?.address ?? '').trim();
  return template
    .replace(/\[venue name\]/gi, name)
    .replace(/\[address\]/gi, address)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** Whether the message already holds this chip. */
export function hasToken(value: string, token: string): boolean {
  return value.toLowerCase().includes(token.toLowerCase());
}

/** The message without the chip (every copy of it), with the spaces around it tidied. */
export function removeToken(value: string, token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value
    .replace(new RegExp(escaped, 'gi'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/^[ \t]+/, '')
    .trimEnd();
}
