import type * as React from 'react';
import type { ReactElement } from 'react';
import type * as Zustand from 'zustand';
import { describe, expect, it, vi } from 'vitest';
import { appStore } from '../../store/appStore';
import { Wipe } from '../../ui/effects/Wipe';
import { HomePage, cardView } from './HomePage';
import type { HomeActions, HomeBagStartRequest } from './HomePage';

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
  effects: [] as { fn: () => void | (() => void); deps?: readonly unknown[]; prevDeps?: readonly unknown[] }[],
  effectCursor: 0,
  refs: [] as { current: unknown }[],
  refCursor: 0,
  reset() {
    this.states = [];
    this.cursor = 0;
    this.effects = [];
    this.effectCursor = 0;
    this.refs = [];
    this.refCursor = 0;
  },
  beginRender() {
    this.cursor = 0;
    this.effectCursor = 0;
    this.refCursor = 0;
  },
  flushEffects() {
    for (const slot of this.effects) {
      const changed = !slot.prevDeps || !slot.deps || slot.deps.some((d, i) => !Object.is(d, slot.prevDeps![i]));
      if (changed) {
        slot.prevDeps = slot.deps;
        slot.fn();
      }
    }
  },
}));

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => {
    const idx = hooks.cursor++;
    if (!(idx in hooks.states)) {
      hooks.states[idx] = typeof init === 'function' ? (init as () => unknown)() : init;
    }
    const set = (next: unknown) => {
      hooks.states[idx] = typeof next === 'function' ? (next as (prev: unknown) => unknown)(hooks.states[idx]) : next;
    };
    return [hooks.states[idx], set];
  }),
  useRef: vi.fn((init: unknown) => {
    const idx = hooks.refCursor++;
    if (!(idx in hooks.refs)) hooks.refs[idx] = { current: init };
    return hooks.refs[idx];
  }),
  useEffect: vi.fn((fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const idx = hooks.effectCursor++;
    if (!hooks.effects[idx]) hooks.effects[idx] = { fn, deps };
    else {
      hooks.effects[idx].fn = fn;
      hooks.effects[idx].deps = deps;
    }
  }),
  useLayoutEffect: vi.fn(),
}));

vi.mock('zustand', async importOriginal => ({
  ...await importOriginal<typeof Zustand>(),
  useStore: vi.fn((store: { getState: () => unknown }, selector: (s: unknown) => unknown) => selector(store.getState())),
}));

const dummyActions = new Proxy({} as HomeActions, {
  get: () => vi.fn(async () => undefined),
});

function setupRunningCardStore(layout: 'split' | 'fused', cardId: string, content: string) {
  const prev = appStore.getState();
  appStore.setState({
    ...prev,
    settings: { ...prev.settings, homeLayout: layout },
    home: {
      ...prev.home,
      mode: 'task',
      insert: null,
      pending: null,
      awayActivity: null,
      card: {
        id: cardId,
        slotNo: '01',
        slotOf: '/03',
        task: '主线任务',
        type: '结果卡',
        goalMinutes: null,
        content,
        progressNote: '',
        status: '进行中',
        project: '工作',
        projectOverridden: false,
        tags: [],
      },
    },
  });
}

function findStageElement(root: ReactElement): ReactElement<{ className: string; children: [ReactElement, ReactElement | null] }> {
  const children = Array.isArray((root.props as { children?: unknown }).children)
    ? ((root.props as { children: unknown[] }).children)
    : [(root.props as { children?: unknown }).children];
  const homeStage = children.find(
    (el): el is ReactElement<{ className?: string; children?: unknown }> =>
      Boolean(el && typeof el === 'object' && 'props' in el && (el as ReactElement<{ className?: string }>).props?.className === 'home-stage'),
  )!;
  const stageChildren = Array.isArray(homeStage.props.children) ? homeStage.props.children : [homeStage.props.children];
  return stageChildren[0] as ReactElement<{ className: string; children: [ReactElement, ReactElement | null] }>;
}

describe('ADR 0025 R5: Bag start Wipe stays in a stable mount position across onCovered card switch', () => {
  it.each([
    { layout: 'split' as const, fromBlank: true },
    { layout: 'split' as const, fromBlank: false },
    { layout: 'fused' as const, fromBlank: true },
    { layout: 'fused' as const, fromBlank: false },
  ])('keeps <Wipe key={bagStart.id}> at .c-stage child[1] when onCovered clears frozen ($layout, fromBlank=$fromBlank)', ({ layout, fromBlank }) => {
    hooks.reset();
    setupRunningCardStore(layout, 'c-old', '旧卡片标题');
    const oldView = fromBlank ? null : cardView(appStore.getState().home, Date.now());

    // 背包点〔开始〕切到新卡 c-new
    setupRunningCardStore(layout, 'c-new', '新卡片标题');
    let bagStart: HomeBagStartRequest | null = {
      id: 'bag-start-1',
      cardId: 'c-new',
      at: '2026-11-07T10:00:00.000+08:00',
      previousView: oldView,
    };

    const renderPage = () => {
      hooks.beginRender();
      const tree = HomePage({
        actions: dummyActions,
        look: { titleScale: 65, topoMode: 'off', topoDepth: 0, timeboxDefault: 60 },
        intro: null,
        completeAt: null,
        onCompleteConsumed: () => {},
        shrinkFor: null,
        onShrinkConsumed: () => {},
        onGuide: () => {},
        onOpenReview: () => {},
        bagStart,
        onBagStartConsumed: () => { bagStart = null; },
      });
      hooks.flushEffects();
      return tree;
    };

    // 初次渲染触发 bagStart effect，二次渲染进入冻结旧画面 + Wipe 遮罩阶段
    renderPage();
    const treeBeforeCover = renderPage();
    const cStageBefore = findStageElement(treeBeforeCover);
    expect(cStageBefore.type).toBe('div');
    expect(cStageBefore.props.className).toBe('c-stage');
    const [bodyBefore, wipeBefore] = cStageBefore.props.children;
    expect(wipeBefore).not.toBeNull();
    expect(wipeBefore!.type).toBe(Wipe);
    expect(wipeBefore!.key).toBe('bag-start-1');
    expect((wipeBefore!.props as { title: string }).title).toBe('新卡片标题');

    // 300ms 遮盖完成回调 onCovered：清除 frozen，底层切到新卡，但 Wipe 仍在 .c-stage 的同一槽位与同一 key
    (wipeBefore!.props as { onCovered: () => void }).onCovered();
    const treeAfterCover = renderPage();
    const cStageAfter = findStageElement(treeAfterCover);
    expect(cStageAfter.type).toBe('div');
    expect(cStageAfter.props.className).toBe('c-stage');
    const [bodyAfter, wipeAfter] = cStageAfter.props.children;
    expect(wipeAfter).not.toBeNull();
    expect(wipeAfter!.type).toBe(Wipe);
    expect(wipeAfter!.key).toBe('bag-start-1');

    if (layout === 'fused') {
      expect(bodyBefore.key).toBe(fromBlank ? 'none' : 'c-old');
      expect(bodyAfter.key).toBe('c-new');
    } else if (!fromBlank) {
      expect((bodyBefore.props as { view: { content: string } }).view.content).toBe('旧卡片标题');
      expect((bodyAfter.props as { view: { content: string } }).view.content).toBe('新卡片标题');
    }

    // 1040ms 退场完成回调 onDone：卸载 Wipe
    (wipeAfter!.props as { onDone: () => void }).onDone();
    const treeAfterDone = renderPage();
    const [, wipeDone] = findStageElement(treeAfterDone).props.children;
    expect(wipeDone).toBeNull();
  });
});
