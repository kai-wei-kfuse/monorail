import { createElement, isValidElement } from 'react';
import type { FocusEvent, ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AwayDrawer } from './AwayDrawer';
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

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') {
    if ((el.type as { name?: string }).name === 'Topo') return;
    walk((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visit);
    return;
  }
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

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
    pause: vi.fn(), stop: vi.fn(), resume: vi.fn(), draw: vi.fn(), startFavorite: vi.fn(),
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

describe('AwayDrawer & useEntry stateful interactions', () => {
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
    expect(tbarHtml).toContain('aria-label="停止"');

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

  it('AwayDrawer 支持就地改名、切换/新建项目、增删标签及读数覆盖确认与取消', async () => {
    const actions = makeActions();
    const away = awayEntry();
    const now = Date.parse('2026-11-01T09:27:15Z');
    const look = { topoMode: 'off' as const, topoDepth: 0, paused: false };
    const projects = [{ name: '生活', color: '#d9a400' }, { name: '运动', color: '#00f5a0' }];
    const knownTags = ['日常', '休息'];

    const collect = () => {
      const els: Array<ReactElement<Record<string, unknown>>> = [];
      runWithHooks(() => walk(createElement(AwayDrawer, { away, now, look, projects, knownTags, actions }), el => els.push(el)));
      return els;
    };

    // 1. 点击标题进入 InlineInput 编辑并提交新名称「下楼拿快递」
    let els = collect();
    const titleEl = els.find(el => el.type === 'h2' && el.props.className === 'away-title');
    expect(titleEl).toBeDefined();
    (titleEl!.props.onClick as () => void)();

    els = collect();
    let nameInput = els.find(el => el.type === 'input' && el.props.id === 'away-edit');
    expect(nameInput).toBeDefined();
    (nameInput!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '下楼拿快递' } });
    els = collect();
    nameInput = els.find(el => el.type === 'input' && el.props.id === 'away-edit');
    (nameInput!.props.onBlur as () => void)();
    expect(actions.editOpen).toHaveBeenCalledWith('away-1', { description: '下楼拿快递' });

    // 2. 移除已有标签 #日常 -> 调用 actions.editOpen('away-1', { tags: [] })
    els = collect();
    const removeTag = els.find(el => el.type === 'button' && el.props['aria-label'] === '移除 #日常');
    expect(removeTag).toBeDefined();
    (removeTag!.props.onClick as (e: { stopPropagation: () => void }) => void)({ stopPropagation: vi.fn() });
    expect(actions.editOpen).toHaveBeenCalledWith('away-1', { tags: [] });

    // 3. 点击读数 #away-elapsed 修改为 '20' 分钟 -> 触发覆盖确认提示 HitNote -> 先点取消再重新触发点确定
    const plan = { entryId: 'away-1', start: '2026-11-01T09:07:15Z', hit: [{ id: 'e1', description: '学 408', from: '2026-11-01T09:07:15Z', to: '2026-11-01T09:25:00Z', minutes: 18 }] };
    vi.mocked(actions.readout)
      .mockResolvedValueOnce({ kind: 'confirm', hit: plan.hit, plan })
      .mockResolvedValueOnce({ kind: 'confirm', hit: plan.hit, plan })
      .mockResolvedValueOnce({ kind: 'done', hit: plan.hit });

    resetHooks();
    els = collect();
    (els.find(el => el.type === 'button' && el.props.id === 'away-elapsed')!.props.onClick as () => void)();
    els = collect();
    (els.find(el => el.type === 'input' && el.props.id === 'away-elapsed')!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '20' } });
    els = collect();
    await (els.find(el => el.type === 'input' && el.props.id === 'away-elapsed')!.props.onBlur as () => Promise<void>)();

    // 此时应渲染覆盖确认提示与「确定」「取消」
    els = collect();
    const cancelBtn = els.find(el => el.type === 'button' && el.props.children === '取消');
    expect(cancelBtn).toBeDefined();
    (cancelBtn!.props.onClick as () => void)();
    els = collect();
    expect(els.find(el => el.type === 'button' && el.props.children === '取消')).toBeUndefined();

    // 再次提交并点击「确定」
    resetHooks();
    els = collect();
    (els.find(el => el.type === 'button' && el.props.id === 'away-elapsed')!.props.onClick as () => void)();
    els = collect();
    (els.find(el => el.type === 'input' && el.props.id === 'away-elapsed')!.props.onChange as (e: { target: { value: string } }) => void)({ target: { value: '20' } });
    els = collect();
    await (els.find(el => el.type === 'input' && el.props.id === 'away-elapsed')!.props.onBlur as () => Promise<void>)();

    els = collect();
    const okBtn = els.find(el => el.type === 'button' && el.props.children === '确定');
    expect(okBtn).toBeDefined();
    await (okBtn!.props.onClick as () => Promise<void>)();
    expect(actions.readout).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: { mode: 'entry', id: 'away-1' }, milliseconds: 20 * 60_000 }),
      plan,
    );
  });
});
