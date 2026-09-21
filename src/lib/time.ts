/**
 * Convert a 24h time string ("19:15" or "07:15") to 12h with AM/PM ("7:15 PM").
 * Falls back to the original string if parsing fails.
 */
export function formatTime(time: string): string {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return time;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${period}`;
}

/**
 * Parses a date-only string ("2026-12-31") as LOCAL midnight.
 *
 * `new Date('2026-12-31')` is defined by the spec to mean UTC midnight, so in
 * any timezone west of Greenwich it lands on the evening of the 30th and every
 * formatter then prints the wrong day. Plans store dates without a time
 * component precisely because they mean "that calendar day, wherever you are".
 */
export function parseLocalDate(dateStr: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return new Date(dateStr); // already has a time component; leave it
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
