import { describe, expect, it } from 'vitest';
import { activityDayStart, addDays, HOUR, unionLength } from './time';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();   // 2026 年 10 月，本地时间

describe('activityDayStart', () => {
  it('过了日边界就是当天的日边界', () => expect(activityDayStart(at(28, 10), 4)).toBe(at(28, 4)));
  it('凌晨还没到日边界，算前一天', () => expect(activityDayStart(at(28, 3, 59), 4)).toBe(at(27, 4)));
  it('正好在日边界上算新的一天', () => expect(activityDayStart(at(28, 4), 4)).toBe(at(28, 4)));
});

describe('addDays', () => {
  it('往后、往前数天，跨月也对', () => {
    expect(addDays(at(28, 4), 1)).toBe(at(29, 4));
    expect(addDays(at(28, 4), -27)).toBe(new Date(2026, 9, 1, 4).getTime());
    expect(addDays(at(31, 4), 1)).toBe(new Date(2026, 10, 1, 4).getTime());
  });
});

describe('unionLength', () => {
  it('重叠的部分只算一次', () => expect(unionLength([[at(28, 10), at(28, 11)], [at(28, 10, 30), at(28, 11, 30)], [at(28, 13), at(28, 14)]])).toBe(2.5 * HOUR));
  it('被包住的不重复算，空段忽略', () => expect(unionLength([[at(28, 10), at(28, 12)], [at(28, 10, 30), at(28, 11)], [at(28, 15), at(28, 15)]])).toBe(2 * HOUR));
  it('没有段时是 0', () => expect(unionLength([])).toBe(0));
});
