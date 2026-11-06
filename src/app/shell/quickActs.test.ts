import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickActs } from './QuickActs';
import type { QuickAct } from './QuickActs';

let slots: unknown[] = [];
let refs: Array<{ current: unknown }> = [];
let effDeps: Array<readonly unknown[] | undefined> = [];
let effCleanups: Array<(() => void) | void> = [];
let sIdx = 0, rIdx = 0, eIdx = 0;
let queuedEffects: Array<{ idx: number; cb: () => (() => void) | void }> = [];

function resetHooks() {
  for (const cleanup of effCleanups) {
    if (typeof cleanup === 'function') cleanup();
  }
  slots = []; refs = []; effDeps = []; effCleanups = [];
  sIdx = 0; rIdx = 0; eIdx = 0; queuedEffects = [];
}

function runWithHooks<T>(fn: () => T): T {
  sIdx = 0; rIdx = 0; eIdx = 0; queuedEffects = [];
  let out = fn();
  while (queuedEffects.length > 0) {
    const effects = [...queuedEffects];
    queuedEffects = [];
    for (const { idx, cb } of effects) {
      if (typeof effCleanups[idx] === 'function') effCleanups[idx]!();
      effCleanups[idx] = cb();
    }
    sIdx = 0; rIdx = 0; eIdx = 0;
    out = fn();
  }
  return out;
}

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: vi.fn((init: unknown) => {
      const idx = sIdx++;
      if (!(idx in slots)) slots[idx] = typeof init === 'function' ? (init as () => unknown)() : init;
      const set = (next: unknown) => {
        slots[idx] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(slots[idx]) : next;
      };
      return [slots[idx], set];
    }),
    useRef: vi.fn((init = null) => {
      const idx = rIdx++;
      if (!refs[idx]) refs[idx] = { current: init };
      return refs[idx];
    }),
    useId: vi.fn(() => 'gid-quickacts'),
    useEffect: vi.fn((cb: () => (() => void) | void, deps?: readonly unknown[]) => {
      const idx = eIdx++;
      const prev = effDeps[idx];
      const changed = !prev || !deps || deps.length !== prev.length || deps.some((d, i) => !Object.is(d, prev[i]));
      effDeps[idx] = deps;
      if (changed) queuedEffects.push({ idx, cb });
    }),
  };
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

const acts: QuickAct[] = [
  { id: 'act-meal', name: '吃饭', icon: 'meal' },
  { id: 'act-wc', name: '上厕所', icon: 'wc' },
];

describe('QuickActs immediate tray close (UI Option A)', () => {
  const listeners = new Map<string, Set<(e: unknown) => void>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T12:00:00.000Z'));
    listeners.clear();
    vi.stubGlobal('HTMLInputElement', class MockHTMLInputElement {});
    vi.stubGlobal('document', {
      addEventListener: vi.fn((type: string, fn: (e: unknown) => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn);
      }),
      removeEventListener: vi.fn((type: string, fn: (e: unknown) => void) => {
        listeners.get(type)?.delete(fn);
      }),
    });
    resetHooks();
  });

  afterEach(() => {
    resetHooks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function renderTree(props: {
    current?: string | null;
    onPick?: (id: string, at: string) => void;
    onTemp?: (name: string, keep: boolean, at: string) => void;
  } = {}) {
    const onPick = props.onPick ?? vi.fn();
    const onTemp = props.onTemp ?? vi.fn();
    const elements: Array<ReactElement<Record<string, unknown>>> = [];
    const tree = runWithHooks(() => QuickActs({
      acts,
      current: props.current ?? null,
      onPick,
      onTemp,
    }));
    walk(tree, el => elements.push(el));
    const toggle = elements.find(el => el.type === 'button' && String(el.props.className ?? '').includes('dock-toggle'))!;
    const tray = elements.find(el => el.type === 'div' && el.props.className === 'tray') ?? null;
    return { elements, toggle, tray, onPick, onTemp };
  }

  it('closes tray immediately on activity tile click without 650ms delay and does not auto-close after rapid reopen', () => {
    const onPick = vi.fn();
    let view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(false);
    expect(view.tray).toBeNull();

    // 打开弹层
    (view.toggle.props.onClick as () => void)();
    view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(true);
    expect(view.tray).not.toBeNull();

    // 点击「上厕所」磁贴：同步立即收起弹层（0ms），无需等待定时器
    const wcBtn = view.elements.find(el => el.type === 'button' && el.props.className === 'qa' && JSON.stringify(el.props.children).includes('上厕所'))!;
    (wcBtn.props.onClick as () => void)();
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('act-wc', '2026-11-01T12:00:00.000Z');

    view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(false);
    expect(view.tray).toBeNull();

    // 100ms 后快速重开弹层，再经过 650ms+ 不会被旧定时器意外关闭
    vi.advanceTimersByTime(100);
    (view.toggle.props.onClick as () => void)();
    view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(true);

    vi.advanceTimersByTime(700);
    view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(true);
    expect(view.tray).not.toBeNull();
  });

  it('shows only the configured activities (no built-in sleep tile) and digit 1-9 keydown starts them', () => {
    const onPick = vi.fn();
    let view = renderTree({ onPick });

    // 打开弹层：磁贴只有设置里配置的那几项，没有写死的「睡觉」（0.3.0-beta.3 D6）
    (view.toggle.props.onClick as () => void)();
    view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(true);
    const tiles = view.elements.filter(el => el.type === 'button' && el.props.className === 'qa');
    expect(tiles).toHaveLength(acts.length);
    expect(tiles.some(el => JSON.stringify(el.props.children).includes('睡觉'))).toBe(false);

    // 按数字键 2 启动第 2 项快捷活动（编号仍从第一项用户预设开始）

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    for (const fn of listeners.get('keydown') ?? []) {
      fn({ key: '2', ctrlKey: false, altKey: false, metaKey: false, target: {}, preventDefault, stopPropagation });
    }
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('act-wc', '2026-11-01T12:00:00.000Z');

    view = renderTree({ onPick });
    expect(view.toggle.props['aria-expanded']).toBe(false);
    expect(view.tray).toBeNull();
  });

  it('closes tray immediately on TempRow form submit and preserves click-time timestamp', () => {
    const onTemp = vi.fn();
    let view = renderTree({ onTemp });

    (view.toggle.props.onClick as () => void)();
    view = renderTree({ onTemp });

    const input = view.elements.find(el => el.type === 'input' && el.props['aria-label'] === '临时活动')!;
    (input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '  拿快递  ' } });
    view = renderTree({ onTemp });

    const keepSwitch = view.elements.find(el => el.type === 'button' && el.props.role === 'switch')!;
    (keepSwitch.props.onClick as () => void)();
    view = renderTree({ onTemp });

    const form = view.elements.find(el => el.type === 'form' && el.props.className === 'tray-temp')!;
    const preventDefault = vi.fn();
    (form.props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onTemp).toHaveBeenCalledWith('拿快递', true, '2026-11-01T12:00:00.000Z', '未分类');

    view = renderTree({ onTemp });
    expect(view.toggle.props['aria-expanded']).toBe(false);
    expect(view.tray).toBeNull();
  });
});
