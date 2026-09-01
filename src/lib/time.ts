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
