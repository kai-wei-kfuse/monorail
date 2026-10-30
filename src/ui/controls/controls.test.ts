import { describe, expect, it, vi } from 'vitest';
import { formatHotkey } from './hotkey';
import type { KeyLike } from './hotkey';
import { clampStep } from './clampStep';
import { composeDateTime, formatDate, parseDate, parseTime } from './localTime';
import { createInlineGate, focusInlineEnd } from './InlineInput';

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
  it('Win 键算修饰键，写成 Win', () => {
    expect(formatHotkey(key({ metaKey: true, shiftKey: true, key: 'R' }))).toBe('Shift+Win+R');
    expect(formatHotkey(key({ metaKey: true, key: '1', code: 'Digit1' }))).toBe('Win+1');
    expect(formatHotkey(key({ key: 'Meta', code: 'MetaLeft', metaKey: true }))).toBeNull();
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

describe('InlineInput gate & focus', () => {
  it('Enter followed by synchronous unmount blur fires onDone(true) only once', () => {
    const calls: boolean[] = [];
    const gate = createInlineGate(keep => {
      calls.push(keep);
      // 模拟 onDone 卸载输入框时同步触发的 onBlur
      gate.finish(true);
    });
    const preventDefault = vi.fn();
    gate.keyDown({ key: 'Enter', preventDefault });
    gate.finish(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([true]);
  });

  it('Escape followed by synchronous unmount blur fires onDone(false) only once', () => {
    const calls: boolean[] = [];
    const gate = createInlineGate(keep => {
      calls.push(keep);
      gate.finish(true);
    });
    const preventDefault = vi.fn();
    gate.keyDown({ key: 'Escape', preventDefault });
    gate.finish(true);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([false]);
  });

  it('ignores Enter and Escape during IME composition and resets cleanly on reopen', () => {
    const first = vi.fn();
    const gate1 = createInlineGate(first);
    const preventDefault = vi.fn();
    gate1.keyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault });
    gate1.keyDown({ key: 'Escape', isComposing: true, preventDefault });
    expect(first).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    gate1.finish(true);
    expect(first).toHaveBeenCalledTimes(1);
    // 重新进入编辑重新挂载时创建新 gate，状态重置（且解构调用 keyDown/finish 不依赖 this）
    const second = vi.fn();
    const { keyDown, finish } = createInlineGate(second);
    keyDown({ key: 'Enter', preventDefault });
    finish(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(true);
  });

  it('places cursor at the end on mount without selecting all', () => {
    const focus = vi.fn(), setSelectionRange = vi.fn();
    focusInlineEnd({ value: '尝试使用Runner', focus, setSelectionRange });
    expect(focus).toHaveBeenCalledTimes(1);
    expect(setSelectionRange).toHaveBeenCalledWith(10, 10);
  });
});