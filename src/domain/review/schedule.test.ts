import { expect, it } from 'vitest';
import { dueReview, isoWeek } from './schedule';
it('A8 first-use week is excluded; subsequent review becomes due at weekday', () => {
  expect(dueReview('2026-11-01', '2026-10-27', 7, [], false)).toBe(null);
  expect(dueReview('2026-11-07', '2026-10-27', 7, [], false)).toBe(null);
  expect(dueReview('2026-11-08', '2026-10-27', 7, [], true)).toEqual({ period: '2026-W45', resumeStep: 'recap', betDue: true });
});
it('A8 persists progress and a completed active review satisfies its ISO period', () => {
  const period = '2026-W45';
  const review = { id: period, period, status: '进行中' as const, step: 'arena' };
  expect(dueReview('2026-11-08', '2026-10-27', 7, [review], false)?.resumeStep).toBe('arena');
  expect(dueReview('2026-11-08', '2026-10-27', 7, [{ ...review, status: '已完成' }], false)).toBe(null);
  expect(isoWeek('2021-01-01')).toBe('2020-W53');
});
