import { afterEach, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
import { createDraftCheckTracker, MaintenanceCheckError, nativeIdeaWindows } from '../src/platform/ideaWindows';

afterEach(() => invokeMock.mockReset());

const event = (targetLabel: string, requestId: string, generation: number) => ({ targetLabel, requestId, generation });

it('M1: globally delivered per-window checks cause exactly one ACK per actual window', () => {
  const labels = ['main', 'quickbar', 'idea-a'];
  const windows = labels.map(label => ({ label, tracker: createDraftCheckTracker() }));
  const accepted: Record<string, string[]> = Object.fromEntries(labels.map(label => [label, []]));
  for (const target of labels) {
    for (const window of windows) {
      const request = window.tracker.acceptCheck(event(target, 'dc-round-1', 1), window.label);
      if (request) accepted[window.label].push(request);
    }
  }
  expect(accepted).toEqual({ main: ['dc-round-1'], quickbar: ['dc-round-1'], 'idea-a': ['dc-round-1'] });
});

it('M1: duplicate checks stay closed after matching restore', () => {
  const tracker = createDraftCheckTracker();
  expect(tracker.acceptCheck(event('main', 'dc-round-1', 1), 'main')).toBe('dc-round-1');
  expect(tracker.acceptCheck(event('main', 'dc-round-1', 1), 'main')).toBeNull();
  expect(tracker.acceptRestore(event('main', 'dc-round-1', 1), 'main')).toBe(true);
  expect(tracker.acceptCheck(event('main', 'dc-round-1', 1), 'main')).toBeNull();
  expect(tracker.getActiveRequestId()).toBeNull();
});

it('M1: cross-window and previous-round restores cannot unlock the newer round', () => {
  const tracker = createDraftCheckTracker();
  tracker.acceptCheck(event('main', 'dc-round-1', 1), 'main');
  tracker.acceptRestore(event('main', 'dc-round-1', 1), 'main');
  tracker.acceptCheck(event('main', 'dc-round-2', 2), 'main');
  expect(tracker.acceptRestore(event('idea-a', 'dc-round-2', 2), 'main')).toBe(false);
  expect(tracker.acceptRestore(event('main', 'dc-round-1', 1), 'main')).toBe(false);
  expect(tracker.getActiveRequestId()).toBe('dc-round-2');
  expect(tracker.acceptRestore(event('main', 'dc-round-2', 2), 'main')).toBe(true);
});

it('M1: a never-seen late old check cannot replace the active newer round', () => {
  const tracker = createDraftCheckTracker();
  tracker.acceptCheck(event('main', 'dc-round-2', 2), 'main');
  expect(tracker.acceptCheck(event('main', 'dc-round-1', 1), 'main')).toBeNull();
  expect(tracker.getActiveRequestId()).toBe('dc-round-2');
  expect(tracker.acceptRestore(event('main', 'dc-round-2', 2), 'main')).toBe(true);
});

it('M1: restore received before its check permanently closes that round', () => {
  const tracker = createDraftCheckTracker();
  tracker.acceptRestore(event('main', 'dc-round-1', 1), 'main');
  expect(tracker.acceptCheck(event('main', 'dc-round-1', 1), 'main')).toBeNull();
  expect(tracker.getActiveRequestId()).toBeNull();
  expect(tracker.acceptCheck(event('main', 'dc-round-2', 2), 'main')).toBe('dc-round-2');
});

it('M1: native ACK contains the round and invalid round makes no invoke', async () => {
  invokeMock.mockResolvedValue(undefined);
  await nativeIdeaWindows.ackDraftCheck('idea-a', true, 'dc-round-2', { saving: true });
  expect(invokeMock).toHaveBeenCalledWith('ack_draft_check', expect.objectContaining({
    requestId: 'dc-round-2', dirty: true, saving: true,
  }));
  invokeMock.mockClear();
  await expect(nativeIdeaWindows.ackDraftCheck('idea-a', false, '')).rejects.toThrow();
  expect(invokeMock).not.toHaveBeenCalled();
});

it('M1: maintenance cancellation must name its own round and never sends an unbound cancel', async () => {
  invokeMock.mockResolvedValue(undefined);
  await nativeIdeaWindows.cancelMaintenanceCheck('dc-round-2');
  expect(invokeMock).toHaveBeenCalledWith('cancel_maintenance_check', { requestId: 'dc-round-2' });
  invokeMock.mockClear();
  await expect(nativeIdeaWindows.cancelMaintenanceCheck(undefined)).rejects.toThrow();
  expect(invokeMock).not.toHaveBeenCalled();
});

it('M1: a missing or invalid generation cannot advance or replace the active round', () => {
  for (const generation of [undefined, NaN, Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const tracker = createDraftCheckTracker();
    tracker.acceptCheck(event('main', 'opaque-current', 2), 'main');
    expect(tracker.acceptCheck({ targetLabel: 'main', requestId: 'opaque-next', generation }, 'main')).toBeNull();
    expect(tracker.getActiveRequestId()).toBe('opaque-current');
  }
});

it('M1: a restore with the same request ID still needs the exact valid generation', () => {
  for (const generation of [undefined, NaN, Infinity, 0, -1, 1.5, 3, Number.MAX_SAFE_INTEGER + 1]) {
    const tracker = createDraftCheckTracker();
    tracker.acceptCheck(event('main', 'opaque-current', 2), 'main');
    expect(tracker.acceptRestore({ targetLabel: 'main', requestId: 'opaque-current', generation }, 'main')).toBe(false);
    expect(tracker.getActiveRequestId()).toBe('opaque-current');
    expect(tracker.acceptRestore(event('main', 'opaque-current', 2), 'main')).toBe(true);
  }
});

it('M1: matching generation with another request ID cannot unlock the active round', () => {
  const tracker = createDraftCheckTracker();
  tracker.acceptCheck(event('main', 'opaque-current', 2), 'main');
  expect(tracker.acceptRestore(event('main', 'opaque-other', 2), 'main')).toBe(false);
  expect(tracker.getActiveRequestId()).toBe('opaque-current');
});

it('M1: a dirty native result explicitly carries the ticket issued to this call', async () => {
  invokeMock.mockResolvedValue({ ok: false, requestId: 'owned-ticket', error: '有未保存草稿' });
  let caught: unknown;
  try { await nativeIdeaWindows.checkDraftsForMaintenance(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(MaintenanceCheckError);
  expect(caught).toMatchObject({ requestId: 'owned-ticket', message: '有未保存草稿' });
});

it('M1: rejected native admission has no owned ticket', async () => {
  invokeMock.mockRejectedValue('已有别人的检查');
  let caught: unknown;
  try { await nativeIdeaWindows.checkDraftsForMaintenance(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(MaintenanceCheckError);
  expect(caught).toMatchObject({ requestId: null, message: '已有别人的检查' });
});
