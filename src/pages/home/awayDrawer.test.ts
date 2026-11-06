import { createElement } from 'react';
import type { FocusEvent } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FreeCard } from './FreeCard';
import { FusedCard } from './FusedCard';
import { TimerBar } from './TimerBar';
import type { TimerActions, TimerEntry, TimerView } from './TimerBar';
import { useEntry } from './useEntry';

// 轻量有状态 Hook 运行器：支持多轮重渲染中保留真实 state / ref 并按依赖触发 useEffect
let slots: unknown[] = [];
let refs: Array<{ current: unknown }> = [];
let effDeps: Array<readonly unknown[] | undefined> = [];
let sIdx = 0, rIdx = 0, eIdx = 0;
let queuedEffects: Array<() => void> = [];

function resetHooks() {
  slots = []; refs = []; effDeps = [];
  sIdx = 0; rIdx = 0; eIdx = 0; queuedEffects = [];
}

function runWithHooks<T>(fn: () => T): T {
  sIdx = 0; rIdx = 0; eIdx = 0; queuedEffects = [];
  let out = fn();
  while (queuedEffects.length > 0) {
    const effects = [...queuedEffects];
    queuedEffects = [];
    for (const eff of effects) eff();
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
    useId: vi.fn(() => 'gid-test'),
    useLayoutEffect: vi.fn(),
    useEffect: vi.fn((cb: () => void, deps?: readonly unknown[]) => {
      const idx = eIdx++;
      const prev = effDeps[idx];
      const changed = !prev || !deps || deps.length !== prev.length || deps.some((d, i) => !Object.is(d, prev[i]));
      effDeps[idx] = deps;
      if (changed) queuedEffects.push(cb);
    }),
  };
});


const entry = (more: Partial<TimerEntry> = {}): TimerEntry => ({
  id: 'e1', description: '学 408', project: '学习', tags: ['408'],
  startedAt: '2026-11-01T09:00:00Z', endedAt: '2026-11-01T09:25:00Z', cardId: null, kind: '普通', ...more,
});
const awayEntry = (more: Partial<TimerEntry> = {}): TimerEntry => ({
  id: 'away-1', description: '上厕所', project: '生活', tags: ['日常'],
  startedAt: '2026-11-01T09:25:00Z', cardId: null, kind: '插入', ...more,
});

function makeActions(): TimerActions {
  return {
    beginPending: vi.fn(), cancelPending: vi.fn(), startFree: vi.fn(), editOpen: vi.fn(),
    pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), continueTimer: vi.fn(), draw: vi.fn(), openBoard: vi.fn(), startFavorite: vi.fn(),
    startCard: vi.fn(), continueEntry: vi.fn(), favorite: vi.fn(),
    readout: vi.fn(async () => ({ kind: 'done' as const, hit: [] })),
    createProject: vi.fn(), createTag: vi.fn(),
  };
}

function makeView(overrides: Partial<TimerView> = {}): TimerView {
  return {
    entry: entry(), away: awayEntry(), idle: false, pending: null, paused: null,
    waitingCard: false, canDraw: true,
    projects: [{ name: '未分类', color: '#888' }, { name: '学习', color: '#00b4ff' }, { name: '生活', color: '#d9a400' }],
    knownTags: ['408', '日常', '休息'],
    suggest: { favorites: [], cards: [], recent: [] },
    ...overrides,
  };
}

describe('插入中的 useEntry 与计时条交互', () => {
  beforeEach(() => resetHooks());

  it('[P1] beginPending 延迟提交与失败时保持底层只读冻结，成功后自动聚焦且不重复派发 beginPending，覆盖先聚焦只读框再点＋', () => {
    const actions = makeActions();
    let view = makeView({ pending: null });

    // 1. 初始 Away 状态：底层只读冻结
    let E = runWithHooks(() => useEntry(view, actions));
    expect([E.deciding, E.isFrozen, E.inputProps.readOnly]).toEqual([false, true, true]);

    // 2. 用户先点击/聚焦只读底层输入框：不触发 beginPending，保持只读
    E.groupProps.onFocus();
    E = runWithHooks(() => useEntry(view, actions));
    expect(actions.beginPending).not.toHaveBeenCalled();
    expect([E.deciding, E.isFrozen, E.inputProps.readOnly]).toEqual([false, true, true]);

    // 3. 点击「＋」（E.next()），但事务尚未提交（或失败返回 undefined，view.pending 仍为 null）：
    //    beginPending 仅调用 1 次，且在 store 提交 pending 前界面仍保持 deciding=false、isFrozen=true、readOnly=true
    E.next();
    E = runWithHooks(() => useEntry(view, actions));
    expect(actions.beginPending).toHaveBeenCalledTimes(1);
    expect([E.deciding, E.isFrozen, E.inputProps.readOnly]).toEqual([false, true, true]);

    // 4. 模拟延迟提交成功：store 发布 pending 后重渲染，自动解除冻结、聚焦输入框，且随后 DOM onFocus 不会第二次派发 beginPending
    view = makeView({ pending: { id: 'p-1', startedAt: '2026-11-01T09:26:00Z' } });
    E = runWithHooks(() => useEntry(view, actions));
    expect([E.deciding, E.isFrozen, E.inputProps.readOnly, E.focused, E.inputProps.value]).toEqual([true, false, false, true, '']);
    E.groupProps.onFocus();
    expect(actions.beginPending).toHaveBeenCalledTimes(1);

    // 5. 输入新活动草稿
    E.inputProps.onChange({ target: { value: '复习操作系统' } });
    E = runWithHooks(() => useEntry(view, actions));
    expect(E.inputProps.value).toBe('复习操作系统');
  });

  it('pending 与 away 并存时底部按钮保留但整组禁用；服务状态切换保留 pending 草稿，普通状态失焦提交保持', () => {
    const actions = makeActions();
    const pending = { id: 'p-coexist', startedAt: '2026-11-01T09:26:00Z' };
    let view = makeView({ pending });
    const now = Date.parse('2026-11-01T09:27:00Z');
    const look = { topoMode: 'off' as const, topoDepth: 0, paused: false };

    // 1. 检查 FusedCard、TimerBar、FreeCard 在 pending + away 并存时均同时渲染「放弃」「暂停」「停止」
    const fusedHtml = renderToStaticMarkup(createElement(FusedCard, {
      view, card: null, cardView: null, now, look, titleScale: 65, actions, onManual: vi.fn(),
    }));
    expect(fusedHtml).toContain('<b>放弃</b>');
    expect(fusedHtml).toContain('<b>暂停</b>');
    expect(fusedHtml).toContain('aria-label="停止"');

    const tbarHtml = renderToStaticMarkup(createElement(TimerBar, {
      view, actions, mode: 'timer', onMode: vi.fn(),
    }));
    expect(tbarHtml).toContain('<b>放弃</b>');
    expect(tbarHtml).toContain('<b>暂停</b>');
    // 插入中没有〔停止〕（已定 57）
    expect(tbarHtml).not.toContain('aria-label="停止"');

    const freeHtml = renderToStaticMarkup(createElement(FreeCard, {
      view, draft: '草稿', over: null, now, look, titleScale: 65, actions,
    }));
    expect(freeHtml).toContain('<b>放弃</b>');
    expect(freeHtml).toContain('<b>暂停</b>');
    expect(freeHtml).toContain('aria-label="停止"');
    for (const html of [fusedHtml, tbarHtml, freeHtml]) {
      expect(html).toContain('disabled="" aria-label="底部活动操作" title="从临时活动回来后可用"');
    }

    // 2. 服务仍可改变当前活动（例如其他窗口）；底部暂停已禁用，此处直接调用动作检查草稿保留：
    //    失焦不触发 startFree / editOpen，抽屉收起（away=null）后 pending ID/起点与输入草稿「准备周会」完整保留
    resetHooks();
    let E = runWithHooks(() => useEntry(view, actions));
    E.groupProps.onFocus();
    E.inputProps.onChange({ target: { value: '准备周会' } });
    E = runWithHooks(() => useEntry(view, actions));
    expect(E.inputProps.value).toBe('准备周会');

    const pauseBtnStub = { closest: (sel: string) => sel === '[data-entry-keep]' ? {} : null };
    E.groupProps.onBlur({ relatedTarget: pauseBtnStub as unknown as Element } as FocusEvent);
    actions.pause();

    expect(actions.startFree).not.toHaveBeenCalled();
    expect(actions.editOpen).not.toHaveBeenCalled();
    expect(actions.pause).toHaveBeenCalledOnce();

    // 暂停后 away 变为 null，但 pending 保持不变，草稿「准备周会」仍在输入框中
    view = makeView({
      away: null,
      entry: entry({ id: 'idle-pause', description: '待机', project: '待机', endedAt: null, kind: '暂停' }),
      idle: true,
      paused: '学 408',
      pending,
    });
    E = runWithHooks(() => useEntry(view, actions));
    expect(E.deciding).toBe(true);
    expect(E.inputProps.value).toBe('准备周会');

    // 3. 普通自由记录编辑（无 pending、无 away）后点击带 data-entry-keep 的暂停/停止：
    //    不走 pending 草稿保留分支，必须先调 editOpen 提交修改、退出 focused，再执行 pause / stop
    for (const op of ['pause', 'stop'] as const) {
      resetHooks();
      const order: string[] = [];
      const normalActions = makeActions();
      normalActions.editOpen = vi.fn((id, patch) => { order.push(`editOpen:${id}:${patch.description}`); });
      normalActions[op] = vi.fn(() => { order.push(op); });
      const normalView = makeView({
        away: null,
        pending: null,
        entry: entry({ id: 'open-1', description: '学 408', endedAt: null }),
      });
      let N = runWithHooks(() => useEntry(normalView, normalActions));
      N.groupProps.onFocus();
      N = runWithHooks(() => useEntry(normalView, normalActions));
      N.inputProps.onChange({ target: { value: `复习 408 (${op})` } });
      N = runWithHooks(() => useEntry(normalView, normalActions));
      N.groupProps.onBlur({ relatedTarget: pauseBtnStub as unknown as Element } as FocusEvent);
      normalActions[op]();
      N = runWithHooks(() => useEntry(normalView, normalActions));
      expect(order).toEqual([`editOpen:open-1:复习 408 (${op})`, op]);
      expect(N.focused).toBe(false);
    }
  });

});
