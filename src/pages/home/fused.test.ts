import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AwayDrawer } from './AwayDrawer';
import { FreeCard } from './FreeCard';
import { fusedState } from './fused';
import { FusedCard } from './FusedCard';
import { TaskCard } from './TaskCard';
import { TimerBar } from './TimerBar';
import { cardProgress } from '../../widgets/cardProgress';
import type { TimerActions, TimerEntry, TimerView } from './TimerBar';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useId: vi.fn(() => 'id-mock'),
  useLayoutEffect: vi.fn(),
  useEffect: vi.fn(),
}));

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') {
    walk((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visit);
    return;
  }
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

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
      pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), continueTimer: vi.fn(), draw: vi.fn(), startFavorite: vi.fn(),
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

  it('ADR 0006：临时活动时底层内容只读、底部整组禁用并提示回来后可用，AwayDrawer 绑定当前临时活动', () => {
    const actions: TimerActions = {
      beginPending: vi.fn(), cancelPending: vi.fn(), startFree: vi.fn(), editOpen: vi.fn(),
      pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), continueTimer: vi.fn(), draw: vi.fn(), startFavorite: vi.fn(),
      startCard: vi.fn(), continueEntry: vi.fn(), favorite: vi.fn(),
      readout: vi.fn(), createProject: vi.fn(), createTag: vi.fn(),
    };
    const resumeFree = e({
      id: 'resume-1', description: '学 408', project: '学习', tags: ['408'],
      startedAt: '2026-10-28T08:00:00Z', endedAt: '2026-10-28T08:25:00Z',
    });
    const awayWc = e({
      id: 'away-1', description: '上厕所', project: '生活', tags: [],
      startedAt: '2026-10-28T08:25:00Z', kind: '插入',
    });
    const awayView: TimerView = {
      entry: resumeFree, away: awayWc,
      idle: false, pending: null, paused: null, waitingCard: false, canDraw: true,
      projects: [{ name: '未分类', color: '#888' }, { name: '学习', color: '#00b4ff' }, { name: '生活', color: '#d9a400' }],
      knownTags: ['408'],
      suggest: { favorites: [], cards: [], recent: [] },
    };
    const now = Date.parse('2026-10-28T08:27:15Z');
    const look = { topoMode: 'off' as const, topoDepth: 0, paused: false };

    // 1. 融合布局：保留原按钮布局，整组禁用。
    const fusedHtml = renderToStaticMarkup(createElement(FusedCard, {
      view: awayView, card: null, cardView: null, now,
      look, titleScale: 65, actions, onManual: vi.fn(),
    }));
    expect(fusedHtml).toContain('value="学 408"');
    expect(fusedHtml).toContain('readOnly=""');
    expect(fusedHtml).toContain('>25:00<');
    expect(fusedHtml).toContain('<b>进行中（暂停）</b><i>PAUSED</i>');
    expect(fusedHtml).toContain('class="tbar-new stop" data-entry-keep="" aria-label="停止"');
    expect(fusedHtml).toContain('d="M3 3h10v10H3z"');
    expect(fusedHtml).toContain('aria-label="开始想下一件事"');
    expect(fusedHtml).not.toContain('回来 ·');
    expect(fusedHtml).toContain('disabled="" aria-label="底部活动操作" title="从临时活动回来后可用"');

    // 2. 分开布局（TimerBar + FreeCard）：时长冻结在 25:00，FreeCard 仍展示原项目「学习」和标签「#408」但禁用编辑
    const tbarHtml = renderToStaticMarkup(createElement(TimerBar, {
      view: awayView, actions, mode: 'timer', onMode: vi.fn(),
    }));
    expect(tbarHtml).toContain('value="学 408"');
    expect(tbarHtml).toContain('readOnly=""');
    expect(tbarHtml).toContain('25<small>:00</small>');
    expect(tbarHtml).toContain('aria-label="停止"');
    expect(tbarHtml).toContain('aria-label="开始想下一件事"');
    expect(tbarHtml).toContain('disabled="" aria-label="底部活动操作" title="从临时活动回来后可用"');

    const freeHtml = renderToStaticMarkup(createElement(FreeCard, {
      view: awayView, draft: null, over: null, now, look, titleScale: 65, actions,
    }));
    expect(freeHtml).toContain('学 408');
    expect(freeHtml).toContain('value="学习"');
    expect(freeHtml).toContain('#408');
    expect(freeHtml).toContain('>25:00<');
    expect(freeHtml).toContain('<b>进行中（暂停）</b><i>PAUSED</i>');
    expect(freeHtml).not.toContain('class="title editable"');
    expect(freeHtml).not.toContain('回来 ·');
    expect(freeHtml).toContain('disabled="" aria-label="底部活动操作" title="从临时活动回来后可用"');

    // 回来后解除整组禁用；抽卡仍遵守 canDraw，自身不可用不能被组恢复覆盖。
    for (const pending of [null, { id: 'pending', startedAt: awayWc.startedAt }]) {
      for (const away of [awayWc, null]) {
        const view = { ...awayView, pending, away, canDraw: false };
        for (const component of [
          createElement(FusedCard, { view, card: null, cardView: null, now, look, titleScale: 65, actions, onManual: vi.fn() }),
          createElement(TimerBar, { view, actions, mode: 'timer', onMode: vi.fn() }),
          createElement(FreeCard, { view, draft: null, over: null, now, look, titleScale: 65, actions }),
        ]) {
          const html = renderToStaticMarkup(component);
          expect(html.includes('title="从临时活动回来后可用"')).toBe(!!away);
          expect(html).toContain('disabled="" class="abtn');
        }
      }
    }

    // 3. 任务卡进行中 + 临时活动：状态为「进行中（暂停）」，底层读数 target 为 null；若同时有 pending 则 target 指向 pending
    expect(fusedState({ ...awayView, entry: e({ cardId: 'k', endedAt: '2026-10-28T08:25:00Z' }) }, doing, false)).toMatchObject({
      show: 'card', onCard: false, away: true, target: null,
    });
    expect(fusedState({ ...awayView, pending }, doing, false)).toMatchObject({
      show: 'card', away: true, target: { mode: 'pending', id: 'p' },
    });

    // 4. AwayDrawer：渲染临时活动「上厕所」、02:15 读数、flat 项目/标签选择器与〔回来〕按钮，且回调绑定 away-1
    const drawerTree = createElement(AwayDrawer, {
      away: awayWc, now, look, projects: awayView.projects, knownTags: awayView.knownTags, actions,
    });
    const drawerHtml = renderToStaticMarkup(drawerTree);
    expect(drawerHtml).toContain('<b>临时活动</b>');
    expect(drawerHtml).toContain('上厕所');
    expect(drawerHtml).toContain('value="生活"');
    expect(drawerHtml).toContain('>02:15<');
    expect(drawerHtml).toContain('aria-label="回来 · 上厕所"');

    let clickResume: (() => void) | null = null;
    walk(drawerTree, el => {
      if (el.type === 'button' && el.props['aria-label'] === '回来 · 上厕所') {
        clickResume = el.props.onClick as () => void;
      }
    });
    expect(clickResume).not.toBeNull();
    clickResume!();
    expect(actions.resume).toHaveBeenCalledOnce();
  });
});
