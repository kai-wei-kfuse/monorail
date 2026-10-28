import { describe, expect, it } from 'vitest';
import { cardArea } from './cardArea';
import type { TimerEntry } from './TimerBar';

const e = (more: Partial<TimerEntry> = {}): TimerEntry =>
  ({ id: 'e', description: '写周报', project: '工作', tags: [], startedAt: '2026-10-28T08:00:00Z', cardId: null, kind: '普通', ...more });
const idle = { entry: e({ project: '待机', description: '待机' }), idle: true, pending: null, paused: null };
const pending = { id: 'p', startedAt: '2026-10-28T08:00:00Z' };

describe('cardArea', () => {
  it('什么都没有：交给首页按 mode 显示', () => expect(cardArea(null, idle, null)).toBe('none'));
  it('有卡就显示卡', () => expect(cardArea(null, idle, '待做')).toBe('card'));
  it('计时条里在写字：盖过卡；只写了空格不算', () => {
    expect(cardArea('学 408', { ...idle, pending }, '待做')).toBe('free');
    expect(cardArea('  ', { ...idle, pending }, '待做')).toBe('card');
  });
  it('正在计一件自己写的事：卡区显示它，哪怕还有一张抽到没开始的卡', () =>
    expect(cardArea(null, { entry: e(), idle: false, pending: null, paused: null }, '待做')).toBe('free'));
  it('卡在计时：显示卡；做卡时插入了快捷活动，卡还是进行中，也显示卡', () => {
    expect(cardArea(null, { entry: e({ cardId: 'k' }), idle: false, pending: null, paused: null }, '进行中')).toBe('card');
    expect(cardArea(null, { entry: e({ description: '厕所', kind: '插入' }), idle: false, pending: null, paused: null }, '进行中')).toBe('card');
  });
  it('没卡时：待确认、暂停中都显示计时条上的这件事', () => {
    expect(cardArea(null, { ...idle, pending }, null)).toBe('free');
    expect(cardArea(null, { ...idle, entry: e({ project: '待机', kind: '暂停' }), paused: '写周报' }, null)).toBe('free');
  });
  it('抽了卡、正在待确认、没写字：显示卡（点卡上的开始）', () => expect(cardArea(null, { ...idle, pending }, '待做')).toBe('card'));
});
