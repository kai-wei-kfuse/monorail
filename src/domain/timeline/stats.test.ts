import { expect, it } from 'vitest';
import type { TimeEntry } from './entry';
import { cardMilliseconds, activityDayTotals } from './stats';
import { activityDay } from './day';

const entry = (index: number, start: string, end: string | null, card: string | null): TimeEntry => ({ id: crypto.randomUUID(), started_at: start, ended_at: end, description: card ? '任务' : '生活', project: card ? '主线' : '生活', card_id: card, kind: '普通', source: index === 1 ? '计时' : '手动', tags: [], updated_at: start });
it('A1 sums parallel work independently across activity days', () => {
  const rows = [entry(1, '2026-10-26T10:00:00Z', '2026-10-26T11:00:00Z', 'a'), entry(2, '2026-10-26T10:20:00Z', '2026-10-26T10:40:00Z', null), entry(3, '2026-10-27T10:00:00Z', null, 'a')];
  expect(cardMilliseconds(rows, 'a', '2026-10-27T10:30:00Z')).toBe(90 * 60000);
});
it('A5 splits daily totals at configured boundary and preserves completion day conventions', () => {
  const at = (hour: number) => new Date(2026, 9, 27, hour).toISOString();
  const rows = [entry(1, at(3), at(5), 'a')];
  expect(activityDayTotals(rows, at(5), 4)).toEqual({ '2026-10-26': { 主线: 3600000 }, '2026-10-27': { 主线: 3600000 } });
  expect(activityDay(at(1), 4)).toBe('2026-10-26'); expect(activityDay(at(4), 4)).toBe('2026-10-27');
});
