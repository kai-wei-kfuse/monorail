import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { InsertCard } from './InsertCard';
import type { HomeSlice } from '../../store/homeSlice';

// 插入卡（ADR 0021 第 3 条，UI 规范 §11.14）：静态渲染核对文字和按钮；动画、鼠标悬停交给无头截图
const look = { topoMode: 'off' as const, topoDepth: 0, paused: false };
const base: NonNullable<HomeSlice['insert']> = {
  paused: false, canContinue: false, entryId: 'e-ins', name: '上厕所', project: '生活', startedAt: '2026-11-06T02:00:00Z',
  over: { kind: 'card', cardId: 'c1', title: '改 [简历] 第二版', track: '主线', todayMs: 25 * 60_000, todayGoal: 60 },
};
const render = (insert: NonNullable<HomeSlice['insert']>, place: 'bottom' | 'top' = 'bottom') => renderToStaticMarkup(createElement(InsertCard, {
  insert, now: Date.parse('2026-11-06T02:02:05Z'), look, titleScale: 65, place,
  onBack: vi.fn(async () => {}), onEndOriginal: vi.fn(async () => {}), onPause: vi.fn(), onContinue: vi.fn(),
  children: createElement('section', { className: 'card' }, 'UNDER'),
}));

describe('插入卡', () => {
  it('插入中：读数走插入这一段；只有〔暂停〕没有〔停止〕；回去区域左右两块；上沿露出原来那张的今天已计 / 今天的量', () => {
    const html = render(base);
    expect(html).toContain('上厕所');
    expect(html).toContain('插在「<b>改 简历 第二版</b>」中间');
    expect(html).toContain('这一段不算进「改 简历 第二版」');
    expect(html).toContain('>02:05<');
    expect(html).toContain('<b>暂停</b>');
    expect(html).not.toContain('停止');
    expect(html).toContain('aria-label="回到任务"');
    expect(html).toContain('结束原任务');
    expect(html).toContain('主线任务 · 改 简历 第二版');
    expect(html).toContain('25:00 / 60:00');
    expect(html).toContain('data-up="bottom"');
    expect(html).toContain('UNDER');
  });
  it('插入的事暂停：〔继续〕，找不到前一段时灰掉；状态写「已暂停 · 还在等你回去」', () => {
    expect(render({ ...base, paused: true, startedAt: null })).toMatch(/disabled=""[^>]*title="找不到前一段/);
    const html = render({ ...base, paused: true, canContinue: true, startedAt: null });
    expect(html).toContain('<b>继续</b>');
    expect(html).toContain('已暂停 · 还在等你回去');
    expect(html).not.toMatch(/disabled=""[^>]*title="找不到前一段/);
  });
  it('插在自由记录中间：写「回到原来的事」「结束原来的事」；回去区域可以放顶边', () => {
    const html = render({ ...base, over: { kind: 'free', title: '写周报', elapsedMs: 12 * 60_000 } }, 'top');
    expect(html).toContain('回到原来的事');
    expect(html).toContain('结束原来的事');
    expect(html).toContain('自由记录 · 写周报');
    expect(html).toContain('data-up="top"');
  });
});
