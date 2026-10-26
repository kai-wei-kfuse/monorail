import { describe, expect, it } from 'vitest';
import { formatHotkey } from './hotkey';
import type { KeyLike } from './hotkey';
import { clampStep } from './clampStep';
import { fromLocalValue, toLocalValue } from './localTime';

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
  it('本地分钟值和 ISO 互转，空值为 null', () => {
    const local = '2026-10-27T09:30';
    expect(toLocalValue(fromLocalValue(local))).toBe(local);
    expect(fromLocalValue('')).toBeNull();
    expect(toLocalValue(null)).toBe('');
  });
});
