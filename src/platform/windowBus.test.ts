import { expect, it, vi } from 'vitest';
import type { MiniSnapshot } from './windowBus';
import { miniWindowBus } from './windowBus';

const transport = vi.hoisted(() => ({ handler: null as null | ((event: { payload: MiniSnapshot }) => void) }));
vi.mock('@tauri-apps/api/event', () => ({ emitTo: vi.fn(async () => {}), listen: vi.fn(async (_event, handler) => {
  transport.handler = handler; return () => {};
}) }));
it('old snapshots cannot replace new views, while equal-revision heartbeats remain visible', async () => {
  const handle = vi.fn(); await miniWindowBus.onSnapshot(handle);
  const snapshot: MiniSnapshot = { revision: 2, entryId: null, cardId: null, pending_id: null, entry: null, pending: null,
    resumeDescription: null, card: null, closedEffectiveMs: 0, currentSegStartedAt: null, awayActivity: null,
    projects: [], knownTags: [], accent: '#fffa00' };
  transport.handler!({ payload: snapshot });
  transport.handler!({ payload: { ...snapshot, revision: 1 } });
  transport.handler!({ payload: snapshot });
  expect(handle).toHaveBeenCalledTimes(2);
});
