import type * as React from 'react';
import type * as Zustand from 'zustand';
import { beforeEach, expect, it, vi } from 'vitest';
import { createActions } from './actions';
import { BagScreen } from './BagScreen';
import { fixture, at, card, task, seed, open, getCard } from '../services/serviceFixture';
import type { Ctx } from '../services/commit';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init: unknown) => ({ current: init })),
  useEffect: vi.fn(),
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

it('背包抽屉的〔开始〕经 homeService 开始计时，出错交给 report（取代原来 BackpackScreen 的同一条）', async () => {
  const f = fixture();
  await seed(f, [card('c1', { task_id: 'm1' }), card('cold-card', { task_id: 'cold', order: 2 })], [
    task('m1'),
    { ...task('cold'), slot: '支线', slot_index: null, status: '冷藏' },
  ]);
  const report = vi.fn();
  // BagScreen 交回一个片段：第一个子元素是抽屉，动作在它的 props 上
  const fragment = BagScreen({ ctx: f.ctx, open: true, onOpen: vi.fn(), onClose: vi.fn(), drawAt: null, onDrawn: vi.fn(), report, children: null });
  const element = (fragment.props.children as { props: { actions: { start: (id: string) => void } } }[])[0];
  // 抽屉在点下那一刻取时间（同日历、列表），这里把系统时间拨到 at(3)
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at(3)));
  f.clock(at(3));
  const publishedBefore = f.publish.mock.calls.length;
  element.props.actions.start('c1');
  await vi.waitFor(() => expect(f.publish).toHaveBeenCalledTimes(publishedBefore + 1));
  expect(open(f)).toMatchObject({ card_id: 'c1', started_at: at(3) });
  expect(report).not.toHaveBeenCalled();

  vi.setSystemTime(new Date(at(4))); f.clock(at(4));
  element.props.actions.start('cold-card');
  await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  expect(String(report.mock.calls[0][0])).toContain('不在背包');
  vi.useRealTimers();
});

it('背包抽屉的〔PASS〕接上 cardService.pass（G7 审核 B2）', async () => {
  const f = fixture();
  await seed(f, [card('c1', { task_id: 'm1' })], [task('m1')]);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(at(3))); f.clock(at(3));
  const report = vi.fn();
  const fragment = BagScreen({ ctx: f.ctx, open: true, onOpen: vi.fn(), onClose: vi.fn(), drawAt: null, onDrawn: vi.fn(), report, children: null });
  const element = (fragment.props.children as { props: { actions: { pass: (id: string) => void } } }[])[0];
  const before = f.publish.mock.calls.length;
  element.props.actions.pass('c1');
  await vi.waitFor(() => expect(f.publish.mock.calls.length).toBeGreaterThan(before));
  expect((await getCard(f, 'c1')).status).not.toBe('待做');
  expect(report).not.toHaveBeenCalled();
  vi.useRealTimers();
});
