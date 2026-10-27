import { describe, expect, it } from 'vitest';
import { formatHotkey } from './hotkey';
import type { KeyLike } from './hotkey';
import { clampStep } from './clampStep';
import { composeDateTime, formatDate, parseDate, parseTime } from './localTime';

const key = (over: Partial<KeyLike>): KeyLike => ({ key: 'r', code: 'KeyR', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

describe('formatHotkey', () => {
  it('按固定顺序拼修饰键，字母取物理键位', () => {
    expect(formatHotkey(key({ ctrlKey: true, altKey: true, shiftKey: true, key: 'R' }))).toBe('Ctrl+Alt+Shift+R');
  });
  it('只按修饰键时不算完成', () => {
    expect(formatHotkey(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
  });
  it('数字和空格用键位名', () => {
    expect(formatHotkey(key({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('Shift+1');
    expect(formatHotkey(key({ key: ' ', code: 'Space', altKey: true }))).toBe('Alt+Space');
  });
});

describe('clampStep', () => {
  it('吸附到步长并限制范围', () => {
    expect(clampStep(63, 50, 100, 5)).toBe(65);
    expect(clampStep(120, 50, 100, 5)).toBe(100);
    expect(clampStep(-3, 0, 10, 1)).toBe(0);
  });
});

describe('localTime', () => {
  const now = new Date(2026, 9, 27, 15, 0); // 2026-10-27 15:00 本地
  const ymd = (d: Date | null | undefined) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  it('日期的几种写法', () => {
    expect(ymd(parseDate('10/28', now))).toBe('2026-10-28');
    expect(ymd(parseDate('1028', now))).toBe('2026-10-28');
    expect(ymd(parseDate('2027-1-5', now))).toBe('2027-1-5');
    expect(ymd(parseDate('20261101', now))).toBe('2026-11-1');
    expect(ymd(parseDate('30', now))).toBe('2026-10-30');
    expect(ymd(parseDate('明天', now))).toBe('2026-10-28');
  });
  it('没写年份、日期已经过去时算明年；今天不算过去', () => {
    expect(ymd(parseDate('1/5', now))).toBe('2027-1-5');
    expect(ymd(parseDate('10/27', now))).toBe('2026-10-27');
  });
  it('空串是 null，写不对是 undefined', () => {
    expect(parseDate('', now)).toBeNull();
    expect(parseDate('2/30', now)).toBeUndefined();
    expect(parseDate('abc', now)).toBeUndefined();
    expect(parseTime('')).toBeNull();
    expect(parseTime('24:00')).toBeUndefined();
    expect(parseTime('9:75')).toBeUndefined();
  });
  it('时间的几种写法', () => {
    expect(parseTime('18')).toEqual({ h: 18, m: 0 });
    expect(parseTime('18:30')).toEqual({ h: 18, m: 30 });
    expect(parseTime('930')).toEqual({ h: 9, m: 30 });
  });
  it('只写日期算 23:59；只写时间算今天，过了就算明天', () => {
    expect(composeDateTime('10/28', '', now)).toBe(new Date(2026, 9, 28, 23, 59).toISOString());
    expect(composeDateTime('', '18:00', now)).toBe(new Date(2026, 9, 27, 18, 0).toISOString());
    expect(composeDateTime('', '9:00', now)).toBe(new Date(2026, 9, 28, 9, 0).toISOString());
    expect(composeDateTime('', '', now)).toBeNull();
    expect(composeDateTime('10/28', '25', now)).toBeUndefined();
  });
  it('显示：今年省略年份', () => {
    expect(formatDate(new Date(2026, 9, 28).toISOString(), now)).toBe('10/28');
    expect(formatDate(new Date(2027, 0, 5).toISOString(), now)).toBe('2027/1/5');
    expect(formatDate(null, now)).toBe('');
  });
});