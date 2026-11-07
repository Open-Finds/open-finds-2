export function isTime(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8, 10));
}
export function nextDate(value: string): string {
  const d = new Date(`${value}T12:00:00`); d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function endFields(d: { date: string; startTime: string; endTime: string; endNextDay: boolean }) {
  if (!d.endTime) return {};
  if (!isDate(d.date) || !isTime(d.startTime) || !isTime(d.endTime)) throw new Error('Enter a valid date, start time and end time.');
  if (!d.endNextDay && d.endTime <= d.startTime) throw new Error('End time must be after the start. Select next day for an overnight event.');
  return { end_time: d.endTime, end_date: d.endNextDay ? nextDate(d.date) : d.date };
}
