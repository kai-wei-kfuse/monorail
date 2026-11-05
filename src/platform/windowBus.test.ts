import { expect, it, vi } from 'vitest';
import type { MiniSnapshot } from './windowBus';
import { acceptMiniSnapshot, miniWindowBus } from './windowBus';

const transport = vi.hoisted(() => ({ handler: null as null | ((event: { payload: MiniSnapshot }) => void) }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async (_event, handler) => {
  transport.handler = handler; return () => {};
}) }));
const snapshot: MiniSnapshot = { epoch: 1, revision: 2, entryId: null, cardId: null, pending_id: null, entry: null, pending: null,
  resumeDescription: null, card: null, closedEffectiveMs: 0, currentSegStartedAt: null, awayActivity: null,
  projects: [], knownTags: [], accent: '#fffa00', suggest: { favorites: [], cards: [], recent: [] } };
/** 依次送进一个新订阅，交回被接下的 (epoch, revision)。 */
async function feed(list: [number, number][]) {
  const handle = vi.fn(); await miniWindowBus.onSnapshot(handle);
  for (const [epoch, revision] of list) transport.handler!({ payload: { ...snapshot, epoch, revision } });
  return handle.mock.calls.map(([s]) => [(s as MiniSnapshot).epoch, (s as MiniSnapshot).revision]);
}

it('old snapshots cannot replace new views, while equal-revision heartbeats remain visible', async () => {
  const handle = vi.fn(); await miniWindowBus.onSnapshot(handle);
  transport.handler!({ payload: snapshot });
  transport.handler!({ payload: { ...snapshot, revision: 1 } });
  transport.handler!({ payload: snapshot });
  expect(handle).toHaveBeenCalledTimes(2);
});
it('a reloaded main window (larger epoch) is accepted even though its revision starts over (D4)', async () => {
  expect(await feed([[1, 10], [2, 2], [2, 2], [2, 3]])).toEqual([[1, 10], [2, 2], [2, 2], [2, 3]]);
});
it('late snapshots and heartbeats from an older session are dropped', async () => {
  expect(await feed([[1, 10], [2, 2], [1, 11], [1, 10], [2, 1]])).toEqual([[1, 10], [2, 2]]);
});
it('reloads A → B → C: when C arrives before the never-seen B, the late B is dropped and C keeps its heartbeats', async () => {
  expect(await feed([[1, 5], [3, 2], [2, 9], [3, 2], [3, 3]])).toEqual([[1, 5], [3, 2], [3, 2], [3, 3]]);
});
it('the first snapshot of a subscription is accepted whatever arrives first', async () => {
  expect(await feed([[4, 0], [3, 50]])).toEqual([[4, 0]]);
  expect(acceptMiniSnapshot(null, { epoch: 0, revision: 0 })).toBe(true);
});
