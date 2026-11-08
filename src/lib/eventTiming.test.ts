import { expect, it } from 'vitest';
import { endFields, isDate } from './eventTiming';
it('keeps an omitted end blank and requires an explicit next-day choice', () => {
  const d = { date: '2026-12-31', startTime: '22:00', endTime: '', endNextDay: false };
  expect(endFields(d)).toEqual({});
  expect(() => endFields({ ...d, endTime: '02:00' })).toThrow('next day');
  expect(endFields({ ...d, endTime: '02:00', endNextDay: true })).toEqual({ end_time: '02:00', end_date: '2027-01-01' });
});
it('rejects impossible calendar dates and invalid times', () => {
  expect(isDate('2026-02-30')).toBe(false);
  expect(() => endFields({ date: '2026-10-28', startTime: '25:00', endTime: '26:00', endNextDay: false })).toThrow();
});
