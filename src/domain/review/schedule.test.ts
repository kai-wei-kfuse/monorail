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
it('A8 retains the last due period across weeks even if the user never opened it', () => {
  expect(dueReview('2026-11-09', '2026-10-27', 7, [], false)?.period).toBe('2026-W45');
  expect(dueReview('2026-11-14', '2026-10-27', 7, [], false)?.period).toBe('2026-W45');
  const old = { id: '2026-W45', period: '2026-W45', status: '进行中' as const, step: 'arena' };
  expect(dueReview('2026-11-09', '2026-10-27', 7, [old], false)?.resumeStep).toBe('arena');
  expect(dueReview('2026-11-15', '2026-10-27', 7, [old], false)?.period).toBe('2026-W46');
});
it('a completed carried-over period stays complete and active current-week review takes precedence', () => {
  const old = { id: '2026-W45', period: '2026-W45', status: '已完成' as const, step: 'done' };
  expect(dueReview('2026-11-09', '2026-10-27', 7, [old], false)).toBeNull();
  const current = { id: '2026-W46', period: '2026-W46', status: '进行中' as const, step: 'bet' };
  expect(dueReview('2026-11-09', '2026-10-27', 7, [old, current], false)).toMatchObject({ period: '2026-W46', resumeStep: 'bet' });
});
it('carries ISO periods over the year boundary without introducing first-use week reviews', () => {
  expect(dueReview('2027-01-04', '2026-12-14', 7, [], false)?.period).toBe('2026-W53');
  expect(dueReview('2026-11-02', '2026-10-27', 7, [], false)).toBeNull();
});
