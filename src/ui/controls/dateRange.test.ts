// 0.3.0-beta.3 E7：双月起止日期选择器的纯计算。
import { expect, it } from 'vitest';
import { cellClass, dayDisabled, initialView, monthCells, pickDay, shiftMonth, spanDays } from './dateRange';

it('months always have 42 cells starting on Monday; shifting crosses years', () => {
  const nov = monthCells('2026-11');
  expect(nov).toHaveLength(42);
  expect(nov.slice(0, 7)).toEqual([null, null, null, null, null, null, '2026-11-01']);   // 2026-11-01 是周日
  expect([shiftMonth('2026-01', -1), shiftMonth('2026-12', 1)]).toEqual(['2025-12', '2027-01']);
  expect([spanDays('2026-11-04', '2026-10-20'), spanDays('2026-02-28', '2026-03-01')]).toEqual([16, 2]);
});
it('picking start then end works in either order; days outside [min, today] are disabled', () => {
  const a = pickDay({ from: '2026-10-01', to: '2026-10-05', anchor: null }, '2026-11-04');
  expect(a).toEqual({ from: '2026-11-04', to: null, anchor: '2026-11-04' });
  expect(pickDay(a, '2026-10-20')).toEqual({ from: '2026-10-20', to: '2026-11-04', anchor: null });
  expect([dayDisabled('2026-09-30', '2026-10-01', '2026-11-08'), dayDisabled('2026-11-09', '2026-10-01', '2026-11-08'), dayDisabled('2026-11-08', null, '2026-11-08')])
    .toEqual([true, true, false]);
});
it('the left month sits before the end month, clamped to the allowed months', () => {
  expect(initialView('2026-11-04', '2025-01-01', '2026-11-08')).toBe('2026-10');
  expect(initialView('2026-11-04', '2026-11-01', '2026-11-08')).toBe('2026-11');
});
it('cells mark today, start, end, range and hover preview', () => {
  const d = { from: '2026-11-02', to: '2026-11-04', anchor: null };
  expect(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-08'].map(x => cellClass(x, d, '2026-11-08', null))).toEqual(['s', 'in', 'e', 'today']);
  const picking = { from: '2026-11-02', to: null, anchor: '2026-11-02' };
  expect(cellClass('2026-11-03', picking, '2026-11-08', '2026-11-05')).toBe('pv');
  expect(cellClass('2026-11-05', picking, '2026-11-08', '2026-11-05')).toBe('pe');
});
