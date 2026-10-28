import { describe, expect, it } from 'vitest';
import { formatReadout, parseClock, parseDuration, parseReadout } from './duration';
import { MINUTE } from './time';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();   // 2026 年 10 月，本地时间
const min = (ms: number | null) => ms === null ? null : ms / MINUTE;

describe('parseReadout', () => {
  // 原型 smoke-time.cjs 的那张表：当前读数 20 分钟
  it.each([
    ['45', 'mmss', 45], ['45:30', 'mmss', 45.5], ['1:30', 'hms', 90], ['01:30:00', 'hms', 90], ['1:30:00', 'mmss', 90],
    ['1h 30m', 'mmss', 90], ['1.5h', 'hms', 90], ['45min', 'hms', 45], ['+10', 'mmss', 30], ['-5', 'mmss', 15], ['- 1:00', 'mmss', 19],
  ] as const)('%s（%s）', (text, kind, want) => expect(min(parseReadout(text, kind, 20 * MINUTE))).toBe(want));
  it('认不出的写法是 NaN', () => {
    for (const text of ['abc', '1:2:3:4', '+', '+abc', '1h30x']) expect(parseReadout(text, 'mmss', 0)).toBeNaN();
  });
  it('空白是 null（不改）', () => expect(parseReadout('  ', 'hms', 0)).toBeNull());
  it('减过头得到负数，交给计时系统拒绝', () => expect(min(parseReadout('-30', 'mmss', 20 * MINUTE))).toBe(-10));
});

describe('parseDuration', () => {
  it('分钟、时:分、h 和 m', () => {
    expect(min(parseDuration('90'))).toBe(90);
    expect(min(parseDuration('1:05'))).toBe(65);
    expect(min(parseDuration('2h'))).toBe(120);
    expect(min(parseDuration('1H 5M'))).toBe(65);
  });
  it('空白是 null，认不出是 NaN', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('h')).toBeNaN();
  });
});

describe('parseClock', () => {
  const now = at(28, 15, 0);
  it('9、930、9:30 都是今天上午', () => {
    expect(parseClock('9', now)).toBe(at(28, 9));
    expect(parseClock('930', now)).toBe(at(28, 9, 30));
    expect(parseClock('09:30', now)).toBe(at(28, 9, 30));
  });
  it('比现在晚的算前一天', () => expect(parseClock('23:10', now)).toBe(at(27, 23, 10)));
  it('越界的是 NaN', () => {
    expect(parseClock('24:00', now)).toBeNaN();
    expect(parseClock('9:60', now)).toBeNaN();
  });
});

describe('formatReadout', () => {
  it('分:秒 不进位成小时', () => expect(formatReadout((75 * 60 + 3) * 1000, 'mmss')).toBe('75:03'));
  it('时:分:秒', () => expect(formatReadout((75 * 60 + 3) * 1000, 'hms')).toBe('01:15:03'));
  it('负数按 0', () => expect(formatReadout(-5000, 'mmss')).toBe('00:00'));
  it('显示出来的再输回去，读数不变', () => {
    const ms = (61 * 60 + 9) * 1000;
    for (const kind of ['mmss', 'hms'] as const) expect(parseReadout(formatReadout(ms, kind), kind, 0)).toBe(ms);
  });
});
