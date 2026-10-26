import { describe, expect, it } from 'vitest';
import { cardProgress, formatClock, formatMinutes } from './cardProgress';

const min = (m: number) => m * 60_000;

describe('cardProgress', () => {
  it('结果卡一格一分钟，满 60 格后不再前进，也没有超时', () => {
    expect(cardProgress(min(47.5), null, true)).toEqual({ filled: 47, miniFilled: 23, state: 'run', overMs: 0 });
    expect(cardProgress(min(200), null, true)).toMatchObject({ filled: 60, miniFilled: 30, state: 'run', overMs: 0 });
  });
  it('时间盒卡按目标等分：目标 90 分钟时一格 1.5 分钟', () => {
    expect(cardProgress(min(45), 90, true).filled).toBe(30);
    expect(cardProgress(min(44.9), 90, true).filled).toBe(29);
  });
  it('时间盒计满以后是 over，并给出超出多少', () => {
    expect(cardProgress(min(65), 60, true)).toEqual({ filled: 60, miniFilled: 30, state: 'over', overMs: min(5) });
    expect(cardProgress(min(60), 60, false).state).toBe('over');
  });
  it('待开始、离开中', () => {
    expect(cardProgress(0, 60, false).state).toBe('ready');
    expect(cardProgress(min(3), 60, false, true).state).toBe('away');
  });
});

describe('格式化', () => {
  it('读数的分钟不进位成小时', () => {
    expect(formatMinutes(min(75) + 12_000)).toBe('75:12');
    expect(formatMinutes(-5)).toBe('00:00');
  });
  it('状态块超过一小时显示 h:mm:ss', () => {
    expect(formatClock(min(3) + 12_000)).toBe('03:12');
    expect(formatClock(min(75) + 12_000)).toBe('1:15:12');
  });
});
