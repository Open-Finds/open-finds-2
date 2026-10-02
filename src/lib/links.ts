/**
 * A venue link as typed or pasted, made safe to put in an href.
 *
 * Links are saved however the user entered them, so "instagram.com/x" has no
 * scheme and, used raw, becomes a relative link to a page that doesn't exist
 * (guests saw nothing). Only web links are allowed through: anything with
 * another scheme (javascript:, data:, ...) is dropped.
 */
export function linkHref(raw: string | null | undefined): string | null {
  const link = raw?.trim();
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith('//')) return `https:${link}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(link)) return null;
  return `https://${link}`;
}
