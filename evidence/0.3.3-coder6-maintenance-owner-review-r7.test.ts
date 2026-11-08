// Execute production SettingsScreen callback and installUpdate. Hooks are a controlled
// component-logic boundary; this is not a React DOM mount or native installer test.
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: () => {},
    useCallback: (callback: unknown) => callback,
    useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, vi.fn()],
  };
});
vi.mock('zustand', () => ({ useStore: (store: { getState(): unknown }, selector: (value: unknown) => unknown) => selector(store.getState()) }));
vi.mock('../src/app/useHistory', async importOriginal => ({
  ...await importOriginal<typeof import('../src/app/useHistory')>(),
  useRecentAutomation: () => ({ records: [], error: null }),
}));

import { SettingsScreen } from '../src/app/SettingsScreen';
import {
  createDraftCheckTracker, MaintenanceCheckError, nativeIdeaWindows,
  runAppExitWithMaintenanceCheck, runDirectoryChangeWithMaintenanceCheck,
} from '../src/platform/ideaWindows';
import { installUpdate } from '../src/services/updateService';
import { fixture } from '../src/services/serviceFixture';
import type { UpdateState } from '../src/shared/updates';

afterEach(() => vi.restoreAllMocks());

it('M1: SettingsScreen admission rejection cannot cancel a different operation visible in global active state', async () => {
  const f = fixture();
  const other = createDraftCheckTracker();
  other.acceptCheck({ targetLabel: 'main', requestId: 'other-operation', generation: 200 }, 'main');
  const failure = new Error('已有别人的草稿检查，当前操作未取得 ticket');
  vi.spyOn(nativeIdeaWindows, 'checkDraftsForMaintenance').mockRejectedValue(failure);
  const cancel = vi.spyOn(nativeIdeaWindows, 'cancelMaintenanceCheck').mockResolvedValue(undefined);
  vi.spyOn(nativeIdeaWindows, 'focusDirtyWindow').mockResolvedValue(null);
  let finish!: (error: unknown) => void;
  const reported = new Promise<unknown>(resolve => { finish = resolve; });
  const element = SettingsScreen({
    ctx: f.ctx, root: 'controlled-memory-root', initialErrors: {}, onSaved() {}, report: finish,
    updates: { state: null } as never,
  }) as ReactElement<{ onChangeDir(): void }>;
  element.props.onChangeDir();
  const observed = await reported;
  expect(observed instanceof Error ? observed.message : String(observed)).toContain(failure.message);
  console.log('SETTINGS_UNOWNED_CANCEL', JSON.stringify(cancel.mock.calls));
  expect(cancel).not.toHaveBeenCalled();
});

it('M1: installUpdate prepare rejection before acquiring a ticket cannot cancel an existing native check', async () => {
  const f = fixture();
  const failure = new Error('已有别人的维护轮次，本次 prepare 未取得 ticket');
  const ready: UpdateState = {
    revision: 1, currentVersion: '0.3.3', phase: 'ready', busy: false, step: 'ready',
    downloaded: 1, total: 1, release: { version: '0.3.3', notes: null }, history: [], updatedAt: 1, error: null,
  };
  const cancelInstall = vi.fn(async () => ready);
  const install = vi.fn(async () => ready);
  await expect(installUpdate(f.ctx, {
    prepareInstall: async () => { throw failure; }, install, cancelInstall,
  })).rejects.toThrow(failure.message);
  console.log('INSTALL_UNOWNED_CANCEL', JSON.stringify(cancelInstall.mock.calls));
  expect(install).not.toHaveBeenCalled();
  expect(cancelInstall).not.toHaveBeenCalled();
});

it('D1: a dirty exit failure cancels only the ticket returned by that call', async () => {
  const failure = new MaintenanceCheckError('未保存草稿', 'owned-exit-ticket');
  const cancel = vi.fn(async () => {});
  const exit = vi.fn(async () => {});
  await expect(runAppExitWithMaintenanceCheck({
    checkDraftsForMaintenance: async () => { throw failure; },
    performAppExit: exit, cancelMaintenanceCheck: cancel, focusDirtyWindow: async () => null,
  })).rejects.toThrow('未保存草稿');
  expect(cancel).toHaveBeenCalledExactlyOnceWith('owned-exit-ticket');
  expect(exit).not.toHaveBeenCalled();
});

it('D1: an exit execution failure cancels the successfully acquired ticket', async () => {
  const cancel = vi.fn(async () => {});
  await expect(runAppExitWithMaintenanceCheck({
    checkDraftsForMaintenance: async () => 'owned-clean-ticket',
    performAppExit: async () => { throw new Error('退出未完成'); },
    cancelMaintenanceCheck: cancel, focusDirtyWindow: async () => null,
  })).rejects.toThrow('退出未完成');
  expect(cancel).toHaveBeenCalledExactlyOnceWith('owned-clean-ticket');
});

it('D1: a second directory check that reports dirty cancels its own ticket without committing', async () => {
  const check = vi.fn()
    .mockResolvedValueOnce('owned-first-ticket')
    .mockRejectedValueOnce(new MaintenanceCheckError('第二轮有未存稿', 'owned-second-ticket'));
  const cancel = vi.fn(async () => {});
  const close = vi.fn(async () => {});
  const commit = vi.fn(async () => {});
  await expect(runDirectoryChangeWithMaintenanceCheck(async () => true, commit, {
    checkDraftsForMaintenance: check, cancelMaintenanceCheck: cancel,
    focusDirtyWindow: async () => null, closeAllIdeaWindows: close,
  })).rejects.toThrow('第二轮有未存稿');
  expect(cancel.mock.calls).toEqual([['owned-first-ticket'], ['owned-second-ticket']]);
  expect(close).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
});

it('D1: a failed first cancellation prevents directory selection and any commit', async () => {
  const choose = vi.fn(async () => true);
  const commit = vi.fn(async () => {});
  const check = vi.fn(async () => 'owned-directory-ticket');
  await expect(runDirectoryChangeWithMaintenanceCheck(choose, commit, {
    checkDraftsForMaintenance: check,
    cancelMaintenanceCheck: async () => { throw new Error('无法确认原生解除'); },
    focusDirtyWindow: async () => null, closeAllIdeaWindows: async () => {},
  })).rejects.toThrow('无法确认原生解除');
  expect(choose).not.toHaveBeenCalled();
  expect(commit).not.toHaveBeenCalled();
  expect(check).toHaveBeenCalledTimes(1);
});

it('D1: a failed close of old-directory windows prevents commitChange', async () => {
  const commit = vi.fn(async () => {});
  await expect(runDirectoryChangeWithMaintenanceCheck(async () => true, commit, {
    checkDraftsForMaintenance: async () => 'owned-directory-ticket',
    cancelMaintenanceCheck: async () => {}, focusDirtyWindow: async () => null,
    closeAllIdeaWindows: async () => { throw new Error('旧目录窗口未关闭'); },
  })).rejects.toThrow('旧目录窗口未关闭');
  expect(commit).not.toHaveBeenCalled();
});

it('D1: failed exit cancellation exposes native restore failure', async () => {
  await expect(runAppExitWithMaintenanceCheck({
    checkDraftsForMaintenance: async () => { throw new MaintenanceCheckError('原草稿错误', 'owned-exit-ticket'); },
    performAppExit: async () => {},
    cancelMaintenanceCheck: async () => { throw new Error('原生恢复失败'); },
    focusDirtyWindow: async () => null,
  })).rejects.toThrow('原生恢复失败');
});

it('D1: second-round cancellation must be confirmed before committing the directory change', async () => {
  const check = vi.fn().mockResolvedValueOnce('owned-first-ticket').mockResolvedValueOnce('owned-second-ticket');
  const cancel = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('第二轮原生解除未确认'));
  const commit = vi.fn(async () => {});
  await expect(runDirectoryChangeWithMaintenanceCheck(async () => true, commit, {
    checkDraftsForMaintenance: check, cancelMaintenanceCheck: cancel,
    focusDirtyWindow: async () => null, closeAllIdeaWindows: async () => {},
  })).rejects.toThrow('第二轮原生解除未确认');
  console.log('SECOND_CANCEL_FAILURE_COMMIT_COUNT', commit.mock.calls.length);
  expect(commit).not.toHaveBeenCalled();
});
