import { beforeEach, expect, it, vi } from 'vitest';
import { createActions } from './actions';
import type { Ctx } from '../services/commit';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
beforeEach(() => { native.invoke.mockReset(); });

it('each direct quick-record action opens through the existing native command', async () => {
  native.invoke.mockResolvedValue(undefined);
  const report = vi.fn(), actions = createActions({} as Ctx, report);
  await actions.showQuickbar();
  await actions.showQuickbar();
  await actions.showQuickbar();
  expect(native.invoke.mock.calls).toEqual([['show_quickbar'], ['show_quickbar'], ['show_quickbar']]);
  expect(report).not.toHaveBeenCalled();
});

it('reports a failed quick-record open and allows the next attempt', async () => {
  const error = new Error('quickbar unavailable');
  native.invoke.mockRejectedValueOnce(error).mockResolvedValueOnce(undefined);
  const report = vi.fn(), actions = createActions({} as Ctx, report);
  await actions.showQuickbar();
  expect(report).toHaveBeenCalledWith(error);
  await actions.showQuickbar();
  expect(native.invoke).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenCalledTimes(1);
});
