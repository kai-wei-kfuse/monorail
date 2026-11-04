// 0.3.0-beta.3 E6（审核 G6）：splitAtDays 在夏令时日的日界。这个文件把时区切到 America/New_York，结束后还原。
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type * as Day from './day';

const previous = process.env.TZ;
let day: typeof Day;
beforeAll(async () => { process.env.TZ = 'America/New_York'; day = await import('./day'); });
afterAll(() => { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; });

const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe('splitAtDays across DST in America/New_York', () => {
  it('the time zone switch took effect', () => {
    // 2026-03-08 02:00 跳到 03:00：当天只有 23 小时
    expect(new Date(2026, 2, 9, 0).getTime() - new Date(2026, 2, 8, 0).getTime()).toBe(23 * 3_600_000);
  });
  it('spring forward with boundary 2: the day after the jump still starts at 02:00, not 03:00', () => {
    const pieces = day.splitAtDays(local(2026, 3, 7, 12), local(2026, 3, 10, 12), 2);
    expect(pieces.map(p => p.day)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10']);
    // 3 月 8 日的 02:00 不存在，日界落在 03:00（同一时刻），这一天只有 23 小时；3 月 9 日、10 日的日界回到 02:00
    expect(pieces[1].start).toBe(new Date(2026, 2, 8, 3).toISOString());
    expect(Date.parse(pieces[1].end) - Date.parse(pieces[1].start)).toBe(23 * 3_600_000);
    expect(pieces[2].start).toBe(local(2026, 3, 9, 2));
    expect(pieces[3].start).toBe(local(2026, 3, 10, 2));
  });
  it('fall back (2026-11-01 02:00 → 01:00) with boundary 4: the activity day 10-31 is 25 hours', () => {
    const pieces = day.splitAtDays(local(2026, 10, 30, 12), local(2026, 11, 2, 12), 4);
    expect(pieces.map(p => p.day)).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(Date.parse(pieces[1].end) - Date.parse(pieces[1].start)).toBe(25 * 3_600_000);
    expect(pieces[2].start).toBe(local(2026, 11, 1, 4));
  });
  it('recap allocation: a full 23-hour and a full 25-hour activity day are credited exactly', async () => {
    const recap = await import('./recap');
    const entry = (s: string, e: string, id: string) => ({ id, started_at: s, ended_at: e, description: 'x', project: '学习', tags: [], card_id: null,
      kind: '普通' as const, source: '计时' as const, updated_at: e });
    const asOf = local(2026, 11, 20, 12);
    const spring = recap.resolvePeriod('custom', { asOf, boundaryHour: 2, from: '2026-03-08', to: '2026-03-08' });
    const s1 = recap.allocate([entry(spring.from, spring.to, 'a')], spring, asOf, 2, false);
    expect(s1.map(s => [s.day, s.ms])).toEqual([['2026-03-08', 23 * 3_600_000]]);
    const fall = recap.resolvePeriod('custom', { asOf, boundaryHour: 4, from: '2026-10-31', to: '2026-11-01' });
    const s2 = recap.allocate([entry(fall.from, fall.to, 'b')], fall, asOf, 4, false);
    expect(s2.map(s => [s.day, s.ms])).toEqual([['2026-10-31', 25 * 3_600_000], ['2026-11-01', 24 * 3_600_000]]);
  });
  it('pieces cover the span exactly with no gaps', () => {
    const pieces = day.splitAtDays(local(2026, 3, 1, 5), local(2026, 3, 20, 5), 2);
    for (let i = 1; i < pieces.length; i++) expect(pieces[i].start).toBe(pieces[i - 1].end);
    expect(pieces[0].start).toBe(local(2026, 3, 1, 5));
    expect(pieces.at(-1)!.end).toBe(local(2026, 3, 20, 5));
    expect(new Set(pieces.map(p => p.day)).size).toBe(pieces.length);
  });
});
