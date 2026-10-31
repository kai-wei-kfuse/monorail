import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { TaskPool, shouldOpenMenuUp } from './TaskPool';
import type { PoolActions, PoolItem, PoolView } from './TaskPool';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useId: vi.fn(() => 'id-mock'),
  useEffect: vi.fn(),
  useLayoutEffect: vi.fn(),
}));

const item = (id: string, content: string, more: Partial<PoolItem> = {}): PoolItem => ({
  id, content, type: '结果卡', timeboxMinutes: null, elapsedMs: 66_000, running: false,
  blocking: false, dueAt: null, shrinkLevel: 0, project: null, tags: [], ...more,
});

const actions = (overrides: Partial<PoolActions> = {}): PoolActions => ({
  newTask: vi.fn(), editItem: vi.fn(), startItem: vi.fn(), addItem: vi.fn(),
  setDefaultProject: vi.fn(), freeze: vi.fn(), abandon: vi.fn(), restore: vi.fn(), createProject: vi.fn(),
  ...overrides,
});

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

it('renders start button under title for single-item tasks and beside each sub-item for multi-item tasks without nesting buttons', () => {
  const editItem = vi.fn(), startItem = vi.fn();
  const view: PoolView = {
    mainMax: 1, sideMax: 2, mainItems: 5, doneSides: [], projects: [{ name: '未分类', color: '#888' }],
    mains: [{
      id: 'm1', name: '找工作', track: '主线', defaultProject: '求职',
      items: [item('c1', '改 [简历] 第二版', { running: true }), item('c2', '投 5 家公司')],
    }],
    sides: [{
      id: 's1', name: '研究CPA无损更新方法（现在更新会导致插件丢失）', track: '支线', defaultProject: '未分类',
      items: [item('s-card', '研究CPA无损更新方法（现在更新会导致插件丢失）')],
    }],
    parked: [],
  };

  const html = renderToStaticMarkup(createElement(TaskPool, { view, actions: actions({ editItem, startItem }) }));
  // 单事项：标题下方 .qc-single-row 右侧有开始按钮（不到 1 小时显示 01:06 不带 00:）；底部操作菜单放在分类选择器（.qc-proj-r）右侧，且去掉左侧「计时记到」文字
  expect(html).toMatch(/class="qc-single-row">.*已用 01:06.*<button type="button" class="sbtn sm">开始<\/button>/);
  expect(html).toContain('<div class="qc-proj"><span class="k">LOG TO</span><div class="qc-proj-r">');
  expect(html).not.toContain('计时记到');
  expect(html).toMatch(/class="qc-proj-r"><div class="combo sm">.*<div class="qc-menu"><button type="button" aria-haspopup="menu" aria-expanded="false" aria-label="任务操作" title="任务操作" class="sbtn sm qc-menu-btn">/);
  // 多事项：每项 .qc-item-row 内编辑按钮与开始按钮同级并列，运行中的 c1 文案替换为「进行中」并禁用
  expect(html).toMatch(/<li class="qc-item-row"><button type="button" class="qc-item" title="点一下编辑">.*改 简历 第二版.*<\/button><button type="button" disabled="" class="sbtn sm">进行中<\/button><\/li>/);
  expect(html).toMatch(/<li class="qc-item-row"><button type="button" class="qc-item" title="点一下编辑">.*投 5 家公司.*<\/button><button type="button" class="sbtn sm">开始<\/button><\/li>/);
  // 严禁 button 嵌套 button
  expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<button/);

  // 逐个触发开始按钮与编辑入口，验证互不干扰
  const starts: Array<() => void> = [];
  const edits: Array<() => void> = [];
  walk(createElement(TaskPool, { view, actions: actions({ editItem, startItem }) }), el => {
    if (el.type === 'button' && (el.props.children === '开始' || el.props.children === '进行中') && !el.props.disabled) {
      starts.push(el.props.onClick as () => void);
    }
    if ((el.type === 'button' && el.props.className === 'qc-item') || (el.type === 'h4' && String(el.props.className).includes('click'))) {
      edits.push(el.props.onClick as () => void);
    }
  });
  expect(starts).toHaveLength(2);
  starts[0]();
  starts[1]();
  expect(startItem.mock.calls).toEqual([['c2'], ['s-card']]);
  expect(editItem).not.toHaveBeenCalled();

  edits[0]();
  expect(editItem).toHaveBeenCalledWith('c1');
  expect(startItem).toHaveBeenCalledTimes(2);
});

it('opens bottom-right dropdown menu with 拆分任务 / 添加任务, 冷藏, and 放弃 actions', async () => {
  const { useState } = await import('react');
  const setConfirmMain = vi.fn(), setAddingMain = vi.fn(), setMenuOpenMain = vi.fn();
  const setConfirmSide = vi.fn(), setAddingSide = vi.fn(), setMenuOpenSide = vi.fn();
  vi.mocked(useState)
    // QuestCard 1 (main, multi-item): confirm, adding, menuOpen=true, menuUp=false, plus ProjectPicker 3 states
    .mockReturnValueOnce([false, setConfirmMain])
    .mockReturnValueOnce([null, setAddingMain])
    .mockReturnValueOnce([true, setMenuOpenMain])
    .mockReturnValueOnce([false, vi.fn()])
    .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()])
    // QuestCard 2 (side, single-item): confirm, adding, menuOpen=true, menuUp=false, plus ProjectPicker 3 states
    .mockReturnValueOnce([false, setConfirmSide])
    .mockReturnValueOnce([null, setAddingSide])
    .mockReturnValueOnce([true, setMenuOpenSide])
    .mockReturnValueOnce([false, vi.fn()])
    .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()]);

  const freeze = vi.fn();
  const view: PoolView = {
    mainMax: 1, sideMax: 2, mainItems: 5, doneSides: [], projects: [{ name: '未分类', color: '#888' }],
    mains: [{
      id: 'm1', name: '找工作', track: '主线', defaultProject: '求职',
      items: [item('c1', '改 [简历] 第二版'), item('c2', '投 5 家公司')],
    }],
    sides: [{
      id: 's1', name: '单事项支线', track: '支线', defaultProject: '未分类',
      items: [item('s-card', '单事项支线', { running: true })],
    }],
    parked: [],
  };

  const menuButtons: Array<{ label: string; onClick: () => void }> = [];
  walk(createElement(TaskPool, { view, actions: actions({ freeze }) }), el => {
    if (el.type === 'button' && el.props.role === 'menuitem') {
      menuButtons.push({ label: String(el.props.children), onClick: el.props.onClick as () => void });
    }
  });
  expect(menuButtons.map(b => b.label)).toEqual(['添加任务', '冷藏', '放弃', '拆分任务', '冷藏', '放弃']);

  // 点击主线卡菜单的「添加任务」：关闭菜单并展开输入框
  menuButtons[0].onClick();
  expect(setMenuOpenMain).toHaveBeenCalledWith(false);
  expect(setAddingMain).toHaveBeenCalledWith('');

  // 点击支线卡菜单的「拆分任务」：关闭菜单并展开输入框
  menuButtons[3].onClick();
  expect(setMenuOpenSide).toHaveBeenCalledWith(false);
  expect(setAddingSide).toHaveBeenCalledWith('');

  // 点击主线卡菜单的「冷藏」：关闭菜单并调用 freeze('m1')
  menuButtons[1].onClick();
  expect(freeze).toHaveBeenCalledWith('m1');

  // 点击支线卡菜单的「放弃」：关闭菜单并打开确认提示
  menuButtons[5].onClick();
  expect(setConfirmSide).toHaveBeenCalledWith(true);
});

it('shouldOpenMenuUp respects clipping scroll container (.s-panel) bottom bound even when window has enough space below', () => {
  // 场景 1：距离 window 底部还有 180px (> 104+4)，但距离 .s-panel 可视底边只有 60px (< 108) -> 必须向上弹出
  expect(shouldOpenMenuUp({ top: 472, bottom: 500 }, 104, 680, { top: 44, bottom: 560 })).toBe(true);
  // 场景 2：距离 .s-panel 可视底边有 120px (>= 108) -> 正常向下弹出
  expect(shouldOpenMenuUp({ top: 412, bottom: 440 }, 104, 680, { top: 44, bottom: 560 })).toBe(false);
  // 场景 3：无裁切容器但接近窗口底边（剩余 80px < 108） -> 向上弹出
  expect(shouldOpenMenuUp({ top: 572, bottom: 600 }, 104, 680, null)).toBe(true);
});

it('recomputes menu placement on scroll/resize and closes on outside pointerdown or Escape', async () => {
  const { useState, useRef, useEffect, useLayoutEffect } = await import('react');
  const setMenuOpen = vi.fn(), setMenuUp = vi.fn();
  let triggerBottom = 440;
  const clipEl = {
    classList: { contains: (cls: string) => cls === 's-panel' },
    getBoundingClientRect: () => ({ top: 44, bottom: 560 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    parentElement: null,
  };
  const menuEl = {
    parentElement: clipEl,
    contains: (target: unknown) => target === 'inside',
    getBoundingClientRect: () => ({ top: triggerBottom - 28, bottom: triggerBottom }),
  };
  const popEl = {
    getBoundingClientRect: () => ({ height: 104 }),
  };

  vi.mocked(useState)
    .mockReturnValueOnce([false, vi.fn()])
    .mockReturnValueOnce([null, vi.fn()])
    .mockReturnValueOnce([true, setMenuOpen])
    .mockReturnValueOnce([false, setMenuUp])
    .mockReturnValueOnce([null, vi.fn()]).mockReturnValueOnce([-1, vi.fn()]).mockReturnValueOnce(['', vi.fn()]);
  vi.mocked(useRef)
    .mockReturnValueOnce({ current: menuEl })
    .mockReturnValueOnce({ current: popEl })
    .mockReturnValueOnce({ current: null });

  const layoutCallbacks: Array<() => void | (() => void)> = [];
  const effectCallbacks: Array<() => void | (() => void)> = [];
  vi.mocked(useLayoutEffect).mockImplementation(cb => { layoutCallbacks.push(cb); });
  vi.mocked(useEffect).mockImplementation(cb => { effectCallbacks.push(cb); });

  const docListeners: Record<string, (e: unknown) => void> = {};
  const winListeners: Record<string, () => void> = {};
  const origDoc = globalThis.document, origWin = globalThis.window;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      body: {},
      addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => { docListeners[type] = fn; }),
      removeEventListener: vi.fn(),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      innerHeight: 680,
      addEventListener: vi.fn((type: string, fn: () => void) => { winListeners[type] = fn; }),
      removeEventListener: vi.fn(),
    },
  });

  try {
    const view: PoolView = {
      mainMax: 1, sideMax: 1, mainItems: 5, doneSides: [], projects: [{ name: '未分类', color: '#888' }],
      mains: [],
      sides: [{ id: 's1', name: '单事项支线', track: '支线', defaultProject: '未分类', items: [item('s-card', '单事项支线')] }],
      parked: [],
    };
    walk(createElement(TaskPool, { view, actions: actions() }), () => {});

    // 执行 useLayoutEffect：初始 bottom=440，离 .s-panel 底边(560) 有 120px >= 108 -> menuUp=false
    const cleanupLayout = layoutCallbacks[0]();
    expect(setMenuUp).toHaveBeenLastCalledWith(false);
    expect(clipEl.addEventListener).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });

    // 模拟 .s-panel 滚动导致触发器靠近面板底边（bottom=500，离 window 680 仍有 180px，但离面板底边 560 仅 60px）
    triggerBottom = 500;
    const onScroll = clipEl.addEventListener.mock.calls[0][1] as () => void;
    onScroll();
    expect(setMenuUp).toHaveBeenLastCalledWith(true);

    if (typeof cleanupLayout === 'function') cleanupLayout();
    expect(clipEl.removeEventListener).toHaveBeenCalledWith('scroll', onScroll);

    // 执行 useEffect：验证点击外部与按 Escape 关闭菜单
    const cleanupEffect = effectCallbacks[0]();
    docListeners.pointerdown({ target: 'inside' });
    expect(setMenuOpen).not.toHaveBeenCalled();
    docListeners.pointerdown({ target: 'outside' });
    expect(setMenuOpen).toHaveBeenCalledWith(false);

    setMenuOpen.mockClear();
    docListeners.keydown({ key: 'Escape' });
    expect(setMenuOpen).toHaveBeenCalledWith(false);
    if (typeof cleanupEffect === 'function') cleanupEffect();
  } finally {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: origDoc });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: origWin });
  }
});
