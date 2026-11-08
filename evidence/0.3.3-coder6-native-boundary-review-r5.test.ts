import { afterEach, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: nativeMocks.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: nativeMocks.listen }));

import { nativeIdeaWindows } from '../src/platform/ideaWindows';
import { CdpPage, assertWindowClosedWithMainAlive, listTargetsWithLabels } from './0.3.3-isolated/lib.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  nativeMocks.invoke.mockReset();
  nativeMocks.listen.mockReset();
});

const opened = {
  action: 'opened', windowLabel: 'idea-record-a', windowSession: 'session-a',
  mainEpoch: 2, recordId: 'record-a', draftId: null,
};

it('N1: Rust open results map opened/focused without invented labels', async () => {
  nativeMocks.invoke.mockResolvedValueOnce(opened);
  await expect(nativeIdeaWindows.openIdeaWindow('record-a')).resolves.toEqual({
    label: 'idea-record-a', windowSession: 'session-a', mainEpoch: 2, created: true,
  });
  nativeMocks.invoke.mockResolvedValueOnce({
    ...opened, action: 'focused', windowLabel: 'idea-draft-a', recordId: null, draftId: 'draft-a',
  });
  await expect(nativeIdeaWindows.openIdeaDraftWindow({
    draftId: 'draft-a', draftVersion: 1, createOperationId: 'create-a', snapshot: {},
  })).resolves.toEqual({
    label: 'idea-draft-a', windowSession: 'session-a', mainEpoch: 2, created: false,
  });
});

it('N1: alternate open shapes and missing identity fail at the native boundary', async () => {
  for (const raw of [
    { label: 'idea-record-a', created: true, windowSession: 'session-a', mainEpoch: 2 },
    { ...opened, windowLabel: undefined },
    { ...opened, windowSession: undefined },
    { ...opened, action: undefined },
  ]) {
    nativeMocks.invoke.mockResolvedValueOnce(raw);
    await expect(nativeIdeaWindows.openIdeaWindow('record-a')).rejects.toThrow('INVALID_OPEN_IDEA_WINDOW_RESULT');
  }
});

it('N1: hello uses targetKind/initialDraft and rejects obsolete aliases', async () => {
  const raw = {
    windowLabel: 'idea-draft-a', windowSession: 'session-a', mainEpoch: 2,
    targetKind: 'draft', recordId: null, draftId: 'draft-a', draftVersion: 3,
    createOperationId: 'create-a', initialDraft: { title: '保留正文' }, ready: true,
  };
  nativeMocks.invoke.mockResolvedValueOnce(raw);
  await expect(nativeIdeaWindows.hello()).resolves.toEqual({
    label: 'idea-draft-a', windowSession: 'session-a', mainEpoch: 2,
    kind: 'draft', recordId: null, draftId: 'draft-a', draftVersion: 3,
    createOperationId: 'create-a', draftSnapshot: { title: '保留正文' },
  });
  nativeMocks.invoke.mockResolvedValueOnce({ ...raw, targetKind: undefined, kind: 'draft' });
  await expect(nativeIdeaWindows.hello()).rejects.toThrow('INVALID_IDEA_WINDOW_HELLO');
});

it('N1: draft handoff uses the Rust label and rejects a missing label', async () => {
  let deliver: (event: { payload: unknown }) => void;
  nativeMocks.listen.mockImplementation(async (_event, callback) => {
    deliver = callback;
    return () => {};
  });
  const received = vi.fn();
  await nativeIdeaWindows.subscribeDraftHandoff(received);
  const payload = {
    windowLabel: 'idea-draft-a', windowSession: 'session-a', mainEpoch: 2,
    draftId: 'draft-a', draftVersion: 1, createOperationId: 'create-a', snapshot: { title: '正文' },
  };
  deliver!({ payload });
  expect(received).toHaveBeenCalledWith({
    label: 'idea-draft-a', windowSession: 'session-a', mainEpoch: 2,
    draftId: 'draft-a', draftVersion: 1, createOperationId: 'create-a', snapshot: { title: '正文' },
  });
  expect(() => deliver!({ payload: { ...payload, windowLabel: undefined, label: 'idea-draft-a' } }))
    .toThrow('INVALID_IDEA_DRAFT_HANDOFF');
  expect(received).toHaveBeenCalledTimes(1);
});

it('N2: unavailable CDP, HTTP error, invalid JSON shape and empty targets all reject', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockRejectedValueOnce(new Error('CODER6_CDP_UNAVAILABLE'));
  await expect(listTargetsWithLabels(19433)).rejects.toThrow('CODER6_CDP_UNAVAILABLE');
  fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
  await expect(listTargetsWithLabels(19433)).rejects.toThrow('HTTP 503');
  for (const body of [{ message: 'invalid target list' }, []]) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body });
    await expect(listTargetsWithLabels(19433)).rejects.toThrow('empty target list');
  }
});

it('N2: per-target inspection failure rejects instead of dropping the target', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{ id: 'coder6-failed-target', type: 'page', title: '想法', webSocketDebuggerUrl: 'ws://invalid' }],
  }));
  vi.spyOn(CdpPage.prototype, 'connect').mockRejectedValue(new Error('CODER6_TARGET_DISCONNECTED'));
  await expect(listTargetsWithLabels(19433)).rejects.toThrow('Failed to inspect CDP target coder6-failed-target');
});

it('N2: persistent CDP failure cannot resolve the closed-window assertion', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('CODER6_CDP_UNAVAILABLE')));
  const mainPage = { eval: vi.fn().mockResolvedValue('main') };
  const rejected = expect(assertWindowClosedWithMainAlive(19433, mainPage, 'idea-a', 1000))
    .rejects.toThrow('CODER6_CDP_UNAVAILABLE');
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(mainPage.eval).toHaveBeenCalled();
});

it('N2: a non-main CDP probe prevents any closed-window success', async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(assertWindowClosedWithMainAlive(19433, { eval: async () => 'quickbar' }, 'idea-a'))
    .rejects.toThrow('Main window CDP probe failed');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('N2: target absence succeeds only with a responsive main in the target list', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [{ id: 'coder6-live-main', type: 'page', webSocketDebuggerUrl: 'ws://fixture' }],
  }));
  vi.spyOn(CdpPage.prototype, 'connect').mockResolvedValue(undefined);
  vi.spyOn(CdpPage.prototype, 'eval').mockResolvedValue('main');
  await expect(assertWindowClosedWithMainAlive(19433, { eval: async () => 'main' }, 'idea-a'))
    .resolves.toEqual({ closed: true, mainAlive: true, remainingLabels: ['main'] });
});
