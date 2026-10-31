import type * as React from 'react';
import type * as Zustand from 'zustand';
import { beforeEach, expect, it, vi } from 'vitest';
import { createActions } from './actions';
import { BackpackScreen } from './BackpackScreen';
import { fixture, at, card, task, seed, open } from '../services/serviceFixture';
import type { Ctx } from '../services/commit';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
}));
vi.mock('zustand', async importOriginal => ({
  ...await importOriginal<typeof Zustand>(),
  useStore: vi.fn((store: { getState: () => unknown }, selector: (s: unknown) => unknown) => selector(store.getState())),
}));
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

it('BackpackScreen startCard starts timing via homeService and surfaces errors through report', async () => {
  const f = fixture();
  await seed(f, [card('c1', { task_id: 'm1' }), card('cold-card', { task_id: 'cold', order: 2 })], [
    task('m1'),
    { ...task('cold'), slot: '支线', slot_index: null, status: '冷藏' },
  ]);
  const report = vi.fn();
  const element = BackpackScreen({ ctx: f.ctx, report });
  f.clock(at(3));
  const publishedBefore = f.publish.mock.calls.length;
  element.props.actions.startCard('c1', at(3));
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledTimes(publishedBefore + 1));
  expect(open(f)).toMatchObject({ card_id: 'c1', started_at: at(3) });
  expect(report).not.toHaveBeenCalled();

  f.clock(at(4));
  element.props.actions.startCard('cold-card', at(4));
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  expect(String(report.mock.calls[0][0])).toContain('不在背包');
});
