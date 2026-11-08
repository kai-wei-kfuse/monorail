import { isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdeaWindowCommand, IdeaWindowCommittedEvent, IdeaWindowReply } from '../shared/ideaWindow';
import type { IdeaWindowHello } from '../platform/ideaWindows';

let states: unknown[] = [];
let refs: Array<{ current: unknown }> = [];
let effectDeps: Array<readonly unknown[] | undefined> = [];
let effectCleanups: Array<(() => void) | void> = [];
let stateCursor = 0;
let refCursor = 0;
let effectCursor = 0;
let pendingEffects: Array<{ idx: number; fn: () => void | (() => void) }> = [];

function resetHookState() {
  for (const cleanup of effectCleanups) {
    if (typeof cleanup === 'function') cleanup();
  }
  states = [];
  refs = [];
  effectDeps = [];
  effectCleanups = [];
  stateCursor = 0;
  refCursor = 0;
  effectCursor = 0;
  pendingEffects = [];
}

function depsEqual(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (!prev || !next || prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    if (!Object.is(prev[i], next[i])) return false;
  }
  return true;
}

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const idx = stateCursor++;
      if (!(idx in states)) {
        states[idx] = typeof init === 'function' ? (init as () => unknown)() : init;
      }
      const setState = (next: unknown) => {
        const prev = states[idx];
        states[idx] = typeof next === 'function' ? (next as (p: unknown) => unknown)(prev) : next;
      };
      return [states[idx], setState];
    },
    useRef: (init: unknown) => {
      const idx = refCursor++;
      if (!(idx in refs)) {
        refs[idx] = { current: init };
      }
      return refs[idx];
    },
    useCallback: <T extends (...args: never[]) => unknown>(fn: T) => fn,
    useMemo: <T>(fn: () => T) => fn(),
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => {
      const idx = effectCursor++;
      const prev = effectDeps[idx];
      if (!(idx in effectDeps) || !depsEqual(prev, deps)) {
        effectDeps[idx] = deps;
        pendingEffects.push({ idx, fn });
      }
    },
  };
});

const mockHello = vi.fn<() => Promise<IdeaWindowHello>>();
const mockSend = vi.fn<(windowSession: string, mainEpoch: number, cmd: IdeaWindowCommand) => Promise<void>>();
const mockCloseIdeaWindow = vi.fn<(label: string) => Promise<void>>();
const mockOpenExternalUrl = vi.fn<(url: string) => Promise<void>>();
const mockAckDraftCheck = vi.fn<
  (label: string, dirty: boolean, requestId: string, options?: { saving?: boolean; reason?: string | null }) => Promise<void>
>();
let mockCurrentWindowLabel: string | null = null;

let replyListeners: Array<(reply: IdeaWindowReply) => void> = [];
let committedListeners: Array<(evt: IdeaWindowCommittedEvent) => void> = [];
let eventListeners: Map<string, Array<(event: { payload: unknown }) => void>> = new Map();

vi.mock('../platform/ideaWindows', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../platform/ideaWindows');
  return {
    ...actual,
    getCurrentWindowLabel: () => mockCurrentWindowLabel,
    nativeIdeaWindows: {
      hello: () => mockHello(),
      send: (s: string, e: number, c: IdeaWindowCommand) => mockSend(s, e, c),
      closeIdeaWindow: (l: string) => mockCloseIdeaWindow(l),
      openExternalUrl: (u: string) => mockOpenExternalUrl(u),
      ackDraftCheck: (
        l: string,
        d: boolean,
        reqId: string,
        opts?: { saving?: boolean; reason?: string | null },
      ) => mockAckDraftCheck(l, d, reqId, opts),
      subscribeReplies: vi.fn((cb: (reply: IdeaWindowReply) => void) => {
        replyListeners.push(cb);
        return Promise.resolve(() => {
          replyListeners = replyListeners.filter(item => item !== cb);
        });
      }),
      subscribeCommitted: vi.fn((cb: (evt: IdeaWindowCommittedEvent) => void) => {
        committedListeners.push(cb);
        return Promise.resolve(() => {
          committedListeners = committedListeners.filter(item => item !== cb);
        });
      }),
    },
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
    const list = eventListeners.get(name) ?? [];
    list.push(cb);
    eventListeners.set(name, list);
    return () => {
      eventListeners.set(
        name,
        (eventListeners.get(name) ?? []).filter(item => item !== cb),
      );
    };
  }),
}));

vi.mock('../platform/quickbarContext', () => ({
  subscribeQuickbarContext: vi.fn(() => Promise.resolve(() => {})),
}));

import { IdeaWindowApp } from './IdeaWindowApp';

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach(child => walk(child, visit));
    return;
  }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') {
    if ((el.type as { name?: string }).name === 'SafeMarkdown') {
      visit(el);
      return;
    }
    walk((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visit);
    return;
  }
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

async function flushMicrotasks(ticks = 8) {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

async function renderCycle(): Promise<ReactElement> {
  stateCursor = 0;
  refCursor = 0;
  effectCursor = 0;
  pendingEffects = [];
  const stubWin = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  (globalThis as unknown as { window: unknown }).window = stubWin;
  const tree = IdeaWindowApp() as ReactElement;
  const toRun = [...pendingEffects];
  pendingEffects = [];
  for (const item of toRun) {
    const prevCleanup = effectCleanups[item.idx];
    if (typeof prevCleanup === 'function') prevCleanup();
    effectCleanups[item.idx] = item.fn();
  }
  await flushMicrotasks();
  return tree;
}

function findButton(tree: ReactNode, text: string): ReactElement<Record<string, unknown>> | null {
  let found: ReactElement<Record<string, unknown>> | null = null;
  walk(tree, el => {
    if (el.type === 'button') {
      const childrenText = Array.isArray(el.props.children)
        ? el.props.children.join('')
        : String(el.props.children ?? '');
      if (childrenText.includes(text)) {
        found = el;
      }
    }
  });
  return found;
}

function findByAriaLabel(tree: ReactNode, label: string): ReactElement<Record<string, unknown>> | null {
  let found: ReactElement<Record<string, unknown>> | null = null;
  walk(tree, el => {
    if (el.props['aria-label'] === label) {
      found = el;
    }
  });
  return found;
}

describe('IdeaWindowApp lifecycle, request correlation & empty-title save', () => {
  beforeEach(() => {
    resetHookState();
    replyListeners = [];
    committedListeners = [];
    eventListeners = new Map();
    mockCurrentWindowLabel = null;
    mockHello.mockReset();
    mockSend.mockReset();
    mockCloseIdeaWindow.mockReset();
    mockOpenExternalUrl.mockReset();
    mockAckDraftCheck.mockReset();
    mockSend.mockResolvedValue(undefined);
    mockCloseIdeaWindow.mockResolvedValue(undefined);
    mockAckDraftCheck.mockResolvedValue(undefined);
  });

  it('does not re-run hello or loop draft-load when draft-loaded updates state, and updates dirtyRef synchronously on typing', async () => {
    mockCurrentWindowLabel = 'idea-draft-1';
    mockHello.mockResolvedValue({
      label: 'idea-draft-1',
      windowSession: 'ws-draft-1',
      mainEpoch: 7,
      kind: 'draft',
      recordId: null,
      draftId: 'draft-1',
      draftVersion: 1,
      createOperationId: '11111111-1111-4111-8111-111111111111',
      draftSnapshot: null,
    });

    await renderCycle();
    expect(mockHello).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0]?.[2]).toMatchObject({
      kind: 'draft-load',
      draftId: 'draft-1',
      windowLabel: 'idea-draft-1',
      windowSession: 'ws-draft-1',
    });

    for (const cb of [...replyListeners]) {
      cb({
        kind: 'draft-loaded',
        requestId: 'req-init',
        mainEpoch: 7,
        viewSeq: 1,
        nextOperationId: '11111111-1111-4111-8111-111111111111',
        draft: {
          draftId: 'draft-1',
          draftVersion: 1,
          createOperationId: '11111111-1111-4111-8111-111111111111',
          title: '初始草稿标题',
          detailsMarkdown: '初始草稿详情',
          needs: null,
          taskId: null,
          attachments: [],
          createdAt: '2026-11-08T10:00:00.000Z',
        },
      });
    }

    // Re-render after draft-loaded state changes: must NOT re-run hello or re-send draft-load!
    const treeAfterLoad = await renderCycle();
    expect(mockHello).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const titleInp = findByAriaLabel(treeAfterLoad, '想法单行标题');
    expect(titleInp).not.toBeNull();
    expect(titleInp?.props.value).toBe('初始草稿标题');

    // Simulate user typing into title input AND immediately receiving update-check-draft BEFORE next render cycle
    const onChange = titleInp?.props.onChange as (e: { target: { value: string } }) => void;
    onChange({ target: { value: '用户刚输入的新标题' } });

    // Cross-window update-check-draft for main or quickbar, or missing/invalid generation, must be ignored
    for (const cb of [...(eventListeners.get('update-check-draft') ?? [])]) {
      cb({ payload: { targetLabel: 'main', requestId: 'chk-sync-1', generation: 1 } });
      cb({ payload: { targetLabel: 'quickbar', requestId: 'chk-sync-1', generation: 1 } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1' } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1', generation: 0 } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1', generation: Number.NaN } });
    }
    expect(mockAckDraftCheck).not.toHaveBeenCalled();

    // Matching targetLabel + requestId + positive safe integer generation ACKs once; duplicate event in same round is ignored
    for (const cb of [...(eventListeners.get('update-check-draft') ?? [])]) {
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1', generation: 2 } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1', generation: 2 } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-late-older', generation: 1 } });
    }
    expect(mockAckDraftCheck).toHaveBeenCalledTimes(1);
    expect(mockAckDraftCheck).toHaveBeenCalledWith('idea-draft-1', true, 'chk-sync-1', { saving: false });

    const treeLocked = await renderCycle();
    expect(findByAriaLabel(treeLocked, '想法单行标题')?.props.disabled).toBe(true);

    // Stale draft-check-restore, wrong targetLabel, missing generation, or same ID with wrong generation must NOT unlock maintenanceLocked
    for (const cb of [...(eventListeners.get('draft-check-restore') ?? [])]) {
      cb({ payload: { targetLabel: 'main', requestId: 'chk-sync-1', generation: 2 } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-stale-0', generation: 1 } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1' } });
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1', generation: 99 } });
    }
    const treeStillLocked = await renderCycle();
    expect(findByAriaLabel(treeStillLocked, '想法单行标题')?.props.disabled).toBe(true);

    // Matching draft-check-restore unlocks maintenanceLocked
    for (const cb of [...(eventListeners.get('draft-check-restore') ?? [])]) {
      cb({ payload: { targetLabel: 'idea-draft-1', requestId: 'chk-sync-1', generation: 2 } });
    }
    const treeRestored = await renderCycle();
    expect(findByAriaLabel(treeRestored, '想法单行标题')?.props.disabled).toBe(false);
    expect(mockHello).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('enables saving an idea with empty title when detailsMarkdown is non-empty, and does not re-trigger hello/load after saved', async () => {
    mockHello.mockResolvedValue({
      label: 'idea-draft-empty-title',
      windowSession: 'ws-empty-title',
      mainEpoch: 3,
      kind: 'draft',
      recordId: null,
      draftId: 'draft-empty',
      draftVersion: 1,
      createOperationId: '22222222-2222-4222-8222-222222222222',
      draftSnapshot: null,
    });

    await renderCycle();
    expect(mockSend).toHaveBeenCalledTimes(1);

    for (const cb of [...replyListeners]) {
      cb({
        kind: 'draft-loaded',
        requestId: 'req-init',
        mainEpoch: 3,
        viewSeq: 1,
        nextOperationId: '22222222-2222-4222-8222-222222222222',
        draft: {
          draftId: 'draft-empty',
          draftVersion: 1,
          createOperationId: '22222222-2222-4222-8222-222222222222',
          title: '',
          detailsMarkdown: '只有多行 Markdown 正文，没有单行标题',
          needs: null,
          taskId: null,
          attachments: [],
          createdAt: '2026-11-08T10:00:00.000Z',
        },
      });
    }

    const tree = await renderCycle();
    const saveBtn = findButton(tree, '保存想法');
    expect(saveBtn).not.toBeNull();
    expect(saveBtn?.props.disabled).toBe(false);

    await (saveBtn?.props.onClick as () => Promise<void>)();
    expect(mockSend).toHaveBeenCalledTimes(2);
    const sentCmd = mockSend.mock.calls[1]![2];
    expect(sentCmd.kind).toBe('draft-create');
    if (sentCmd.kind !== 'draft-create') throw new Error('expected draft-create');
    expect(sentCmd.text).toBe('');
    expect(sentCmd.detailsMarkdown).toBe('只有多行 Markdown 正文，没有单行标题');

    for (const cb of [...replyListeners]) {
      cb({
        kind: 'draft-created',
        requestId: sentCmd.requestId,
        operationId: sentCmd.createOperationId,
        mainEpoch: 3,
        viewSeq: 2,
        replayed: false,
        draftId: 'draft-empty',
        draftVersion: 1,
        idea: {
          id: 'idea-created-1',
          text: '',
          detailsMarkdown: '只有多行 Markdown 正文，没有单行标题',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:00:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-after-create',
        },
        nextOperationId: '33333333-3333-4333-8333-333333333333',
      });
    }

    await renderCycle();
    // Must not re-trigger hello or send extra load after boundRecordId and baseRevision state updates!
    expect(mockHello).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('ignores mismatched requestId replies, preserves concurrent edits during in-flight save, and ignores cross-epoch broadcasts', async () => {
    mockHello.mockResolvedValue({
      label: 'idea-rec-1',
      windowSession: 'ws-rec-1',
      mainEpoch: 10,
      kind: 'record',
      recordId: 'idea-rec-1',
      draftId: null,
      draftVersion: null,
      createOperationId: null,
      draftSnapshot: null,
    });

    await renderCycle();
    expect(mockSend).toHaveBeenCalledTimes(1);
    const loadCmd = mockSend.mock.calls[0]![2];
    expect(loadCmd.kind).toBe('load');

    for (const cb of [...replyListeners]) {
      cb({
        kind: 'loaded',
        requestId: loadCmd.requestId,
        mainEpoch: 10,
        viewSeq: 1,
        idea: {
          id: 'idea-rec-1',
          text: '原始标题',
          detailsMarkdown: '原始正文',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:00:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-1',
        },
        initialDraft: {
          title: '原始标题',
          detailsMarkdown: '原始正文',
          needs: null,
          baseRevision: 'ir3:rev-1',
          editMode: true,
        },
        nextOperationId: '44444444-4444-4444-8444-444444444444',
      });
    }

    // Cross-epoch broadcast (mainEpoch: 99 !== 10) must be ignored and must not overwrite mainEpochRef
    for (const cb of [...committedListeners]) {
      cb({
        kind: 'deleted',
        mainEpoch: 99,
        viewSeq: 99,
        recordId: 'idea-rec-1',
        idea: null,
      });
    }

    let tree = await renderCycle();
    const titleInp = findByAriaLabel(tree, '想法单行标题');
    (titleInp?.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '第一次保存标题' },
    });

    tree = await renderCycle();
    const saveBtn = findButton(tree, '保存修改');
    await (saveBtn?.props.onClick as () => Promise<void>)();
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[1]![1]).toBe(10);
    const saveCmd = mockSend.mock.calls[1]![2];
    expect(saveCmd.kind).toBe('save');

    // Mismatched requestId reply must be ignored
    for (const cb of [...replyListeners]) {
      cb({
        kind: 'saved',
        requestId: 'wrong-request-id',
        operationId: 'wrong-op-id',
        mainEpoch: 10,
        viewSeq: 2,
        replayed: false,
        idea: {
          id: 'idea-rec-1',
          text: '错误回包标题',
          detailsMarkdown: '原始正文',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:01:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-wrong',
        },
        nextOperationId: '55555555-5555-4555-8555-555555555555',
      });
    }

    tree = await renderCycle();
    expect(findButton(tree, '保存中…')).not.toBeNull();

    // User modifies details while save is in flight
    const detailsInp = findByAriaLabel(tree, 'Markdown 想法笔记');
    (detailsInp?.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '保存途中继续新增的正文' },
    });

    // Now the matching saved reply arrives
    for (const cb of [...replyListeners]) {
      cb({
        kind: 'saved',
        requestId: saveCmd.requestId,
        operationId: saveCmd.kind === 'save' ? (saveCmd.operationId ?? 'op-1') : 'op-1',
        mainEpoch: 10,
        viewSeq: 3,
        replayed: false,
        idea: {
          id: 'idea-rec-1',
          text: '第一次保存标题',
          detailsMarkdown: '原始正文',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:01:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-2',
        },
        nextOperationId: '66666666-6666-4666-8666-666666666666',
      });
    }

    tree = await renderCycle();
    // Because details changed while save was in flight, window stays in edit mode with the newer details preserved!
    const detailsAfter = findByAriaLabel(tree, 'Markdown 想法笔记');
    expect(detailsAfter).not.toBeNull();
    expect(detailsAfter?.props.value).toBe('保存途中继续新增的正文');
  });

  it('syncs clean edit-mode fields when receiving an external committed broadcast without false dirty conflict, and preserves dirty edits on real conflict', async () => {
    mockHello.mockResolvedValue({
      label: 'idea-rec-clean',
      windowSession: 'ws-rec-clean',
      mainEpoch: 5,
      kind: 'record',
      recordId: 'idea-rec-clean',
      draftId: null,
      draftVersion: null,
      createOperationId: null,
      draftSnapshot: null,
    });

    await renderCycle();
    const loadCmd = mockSend.mock.calls[0]![2];

    for (const cb of [...replyListeners]) {
      cb({
        kind: 'loaded',
        requestId: loadCmd.requestId,
        mainEpoch: 5,
        viewSeq: 1,
        idea: {
          id: 'idea-rec-clean',
          text: '旧标题',
          detailsMarkdown: '旧正文',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:00:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-old',
        },
        initialDraft: null,
        nextOperationId: '77777777-7777-4777-8777-777777777777',
      });
    }

    let tree = await renderCycle();
    const editBtn = findButton(tree, '编辑');
    expect(editBtn).not.toBeNull();
    (editBtn?.props.onClick as () => void)();

    tree = await renderCycle();
    expect(findByAriaLabel(tree, '想法单行标题')?.props.value).toBe('旧标题');

    // External update arrives while window is in edit mode with CLEAN (unedited) inputs
    for (const cb of [...committedListeners]) {
      cb({
        kind: 'updated',
        mainEpoch: 5,
        viewSeq: 2,
        recordId: 'idea-rec-clean',
        idea: {
          id: 'idea-rec-clean',
          text: '外部更新后的新标题',
          detailsMarkdown: '外部更新后的新正文',
          needs: '新需求',
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:02:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-new',
        },
      });
    }

    tree = await renderCycle();
    // Clean editor must sync to the new committed values and NOT show a false conflict banner
    expect(findByAriaLabel(tree, '想法单行标题')?.props.value).toBe('外部更新后的新标题');
    expect(findByAriaLabel(tree, 'Markdown 想法笔记')?.props.value).toBe('外部更新后的新正文');
    expect(findButton(tree, '加载外部最新版')).toBeNull();

    // Now user actually types into the editor (making it dirty) and another external update arrives
    const titleInp = findByAriaLabel(tree, '想法单行标题');
    (titleInp?.props.onChange as (e: { target: { value: string } }) => void)({
      target: { value: '本地未保存修改' },
    });

    for (const cb of [...committedListeners]) {
      cb({
        kind: 'updated',
        mainEpoch: 5,
        viewSeq: 3,
        recordId: 'idea-rec-clean',
        idea: {
          id: 'idea-rec-clean',
          text: '第三次外部标题',
          detailsMarkdown: '第三次外部正文',
          needs: '新需求',
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:03:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-third',
        },
      });
    }

    tree = await renderCycle();
    expect(findByAriaLabel(tree, '想法单行标题')?.props.value).toBe('本地未保存修改');
    expect(findButton(tree, '加载外部最新版')).not.toBeNull();
  });

  it('ignores cross-window loaded replies meant for a different idea record', async () => {
    mockHello.mockResolvedValue({
      label: 'idea-rec-a',
      windowSession: 'ws-rec-a',
      mainEpoch: 5,
      kind: 'record',
      recordId: 'idea-rec-a',
      draftId: null,
      draftVersion: null,
      createOperationId: null,
      draftSnapshot: null,
    });

    await renderCycle();
    const loadCmd = mockSend.mock.calls[0]![2];

    for (const cb of [...replyListeners]) {
      cb({
        kind: 'loaded',
        requestId: loadCmd.requestId,
        mainEpoch: 5,
        viewSeq: 1,
        idea: {
          id: 'idea-rec-a',
          text: '窗口 A 的标题',
          detailsMarkdown: '窗口 A 的正文',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:00:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-a',
        },
        initialDraft: null,
        nextOperationId: '88888888-8888-4888-8888-888888888888',
      });
    }

    // Another window (idea-rec-b) receives its loaded reply over the event bus with a higher viewSeq
    for (const cb of [...replyListeners]) {
      cb({
        kind: 'loaded',
        requestId: 'other-window-load-req',
        mainEpoch: 5,
        viewSeq: 99,
        idea: {
          id: 'idea-rec-b',
          text: '窗口 B 的标题（绝不可污染窗口 A）',
          detailsMarkdown: '窗口 B 的正文',
          needs: null,
          pool: '活跃池',
          tags: [],
          attachments: [],
          taskId: null,
          createdAt: '2026-11-08T10:00:00.000Z',
          lastTouchedAt: '2026-11-08T10:01:00.000Z',
          completedAt: null,
          completedBy: null,
          recordRevision: 'ir3:rev-b',
        },
        initialDraft: null,
        nextOperationId: '99999999-9999-4999-8999-999999999999',
      });
    }

    let tree = await renderCycle();
    const editBtn = findButton(tree, '编辑');
    (editBtn?.props.onClick as () => void)();
    tree = await renderCycle();
    expect(findByAriaLabel(tree, '想法单行标题')?.props.value).toBe('窗口 A 的标题');
    expect(findByAriaLabel(tree, 'Markdown 想法笔记')?.props.value).toBe('窗口 A 的正文');
  });
});
