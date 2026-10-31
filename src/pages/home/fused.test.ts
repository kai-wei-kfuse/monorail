import { createElement } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { fusedState } from './fused';
import { FusedCard } from './FusedCard';
import { TaskCard } from './TaskCard';
import { cardProgress } from '../../widgets/cardProgress';
import type { TimerActions, TimerEntry, TimerView } from './TimerBar';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useLayoutEffect: vi.fn(),
}));

const e = (more: Partial<TimerEntry> = {}): TimerEntry =>
  ({ id: 'e', description: '写周报', project: '工作', tags: [], startedAt: '2026-10-28T08:00:00Z', cardId: null, kind: '普通', ...more });
const idle = { entry: e({ id: 'i', project: '待机', description: '待机' }), idle: true, pending: null, paused: null };
const pending = { id: 'p', startedAt: '2026-10-28T08:00:00Z' };
const ready = { id: 'k', status: '待做' as const }, doing = { id: 'k', status: '进行中' as const };

describe('fusedState', () => {
  it('待机：输入框，读数不能点', () => expect(fusedState(idle, null, false)).toMatchObject({ show: 'input', target: null }));
  it('待确认：读数改起点', () => expect(fusedState({ ...idle, pending }, null, false).target).toEqual({ mode: 'pending', id: 'p' }));
  it('抽到卡：显示卡，待确认算在卡上；点了「写别的」换回输入框', () => {
    expect(fusedState({ ...idle, pending }, ready, false)).toMatchObject({ show: 'card', pendingOnCard: true, target: { mode: 'pending', id: 'p' } });
    expect(fusedState({ ...idle, pending }, ready, true)).toMatchObject({ show: 'input', pendingOnCard: false });
  });
  it('做卡中：读数改卡的已用', () =>
    expect(fusedState({ ...idle, entry: e({ cardId: 'k' }), idle: false }, doing, false)).toMatchObject({ show: 'card', onCard: true, target: { mode: 'ref', id: 'k' } }));
  it('做卡时暂停、插了快捷活动：还显示卡，读数不能点', () => {
    expect(fusedState({ ...idle, entry: e({ project: '待机', kind: '暂停' }), paused: '改简历' }, doing, false)).toMatchObject({ show: 'card', paused: true, target: null });
    expect(fusedState({ ...idle, entry: e({ description: '厕所', kind: '插入' }), idle: false }, doing, false)).toMatchObject({ show: 'card', away: true, target: null });
  });
  it('正在计自己写的事、抽到的卡没开始：输入框显示这件事，读数改这一条', () =>
    expect(fusedState({ ...idle, entry: e(), idle: false }, ready, false)).toMatchObject({ show: 'input', target: { mode: 'entry', id: 'e' } }));

  it('FusedCard 正在计自由记录时保留 .f-input 架构并启用 .compact 紧贴文字宽度与 --ts 大字号，待确认空白输入时不加 .compact', async () => {
    const noopActions: TimerActions = {
      beginPending: vi.fn(), cancelPending: vi.fn(), startFree: vi.fn(), editOpen: vi.fn(),
      pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), draw: vi.fn(), startFavorite: vi.fn(),
      startCard: vi.fn(), continueEntry: vi.fn(), favorite: vi.fn(),
      readout: vi.fn(), createProject: vi.fn(), createTag: vi.fn(),
    };
    const baseView: TimerView = {
      entry: e({ id: 'free-1', description: '测试', project: '未分类' }),
      idle: false, pending: null, paused: null, waitingCard: false, canDraw: true,
      projects: [{ name: '未分类', color: '#888' }], knownTags: [],
      suggest: { favorites: [], cards: [], recent: [] },
    };
    const look = { topoMode: 'off' as const, topoDepth: 0, paused: false };

    const runningHtml = renderToStaticMarkup(createElement(FusedCard, {
      view: baseView, card: null, cardView: null, now: Date.parse('2026-10-28T08:00:02Z'),
      look, titleScale: 65, actions: noopActions, onManual: vi.fn(),
    }));
    // 进行中的自由记录：保留 .f-input + useEntry 架构，同时加上 compact 类紧贴文字宽度并传入 --ts:62px
    expect(runningHtml).toContain('class="f-input compact" style="--ts:62px"');
    expect(runningHtml).toContain('class="f-title"');
    expect(runningHtml).toContain('value="测试"');

    // 待确认空白输入状态：保留完整宽度 .f-input（无 compact）并带 --ts:62px
    const pendingHtml = renderToStaticMarkup(createElement(FusedCard, {
      view: { ...baseView, pending }, card: null, cardView: null, now: Date.parse('2026-10-28T08:00:02Z'),
      look, titleScale: 65, actions: noopActions, onManual: vi.fn(),
    }));
    expect(pendingHtml).toContain('class="f-input" style="--ts:62px"');
    expect(pendingHtml).not.toContain('f-input compact');

    // 验证 TaskCard 进入 InlineInput 编辑（draft !== null, hero 非空但 title h1 已卸载为 null）时 useLayoutEffect 保留已缩小的 ts（38px）
    const { useState, useRef, useLayoutEffect } = await import('react');
    const setTs = vi.fn();
    vi.mocked(useState)
      .mockReturnValueOnce(['长标题正在编辑', vi.fn()])
      .mockReturnValueOnce([38, setTs]);
    vi.mocked(useRef)
      .mockReturnValueOnce({ current: { clientWidth: 800, clientHeight: 200 } })
      .mockReturnValueOnce({ current: null })
      .mockReturnValueOnce({ current: { id: 'c1', content: '长标题正在编辑' } });
    const layoutCbs: Array<() => void> = [];
    vi.mocked(useLayoutEffect).mockImplementation(cb => { layoutCbs.push(cb); });

    TaskCard({
      view: { id: 'c1', slotNo: '01', task: '主线', type: '结果卡', goalMinutes: null, content: '长标题正在编辑', elapsedMs: 0, progress: cardProgress(0, null, true) },
      look, titleScale: 65, actions: null, onEditContent: vi.fn(),
    });
    expect(layoutCbs).toHaveLength(1);
    layoutCbs[0]();
    expect(setTs).not.toHaveBeenCalled();
  });
});
