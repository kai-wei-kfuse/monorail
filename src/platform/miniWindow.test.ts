import { beforeEach, expect, it, vi } from 'vitest';
import { miniWindow } from './miniWindow';
import type { MiniVisibility } from './miniWindow';

const native = vi.hoisted(() => ({
  invoke: vi.fn(), off: vi.fn(),
  receive: null as null | ((event: { payload: MiniVisibility }) => void),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name, receive) => {
  native.receive = receive; return native.off;
}) }));
beforeEach(() => { vi.clearAllMocks(); native.receive = null; });

it('initializes from native visibility and follows independently triggered hide/show events', async () => {
  native.invoke.mockResolvedValue({ visible: true, revision: 1 });
  const receive = vi.fn(); const off = await miniWindow.subscribeVisibility(receive);
  native.receive!({ payload: { visible: false, revision: 2 } });
  native.receive!({ payload: { visible: true, revision: 3 } });
  expect(receive.mock.calls).toEqual([[true], [false], [true]]);
  expect(native.invoke).toHaveBeenCalledWith('read_mini_visibility');
  off(); expect(native.off).toHaveBeenCalledOnce();
});
it('an older initial query reply cannot overwrite a newer visibility event', async () => {
  let resolve!: (state: MiniVisibility) => void;
  native.invoke.mockImplementation(() => new Promise<MiniVisibility>(done => { resolve = done; }));
  const receive = vi.fn(); const pending = miniWindow.subscribeVisibility(receive);
  await Promise.resolve();
  native.receive!({ payload: { visible: false, revision: 4 } });
  resolve({ visible: true, revision: 3 }); await pending;
  native.receive!({ payload: { visible: true, revision: 2 } });
  native.receive!({ payload: { visible: false, revision: 4 } });
  expect(receive.mock.calls).toEqual([[false]]);
});
it('a failed initial query cleans up the listener and reports the error', async () => {
  native.invoke.mockRejectedValue(new Error('native query failed'));
  await expect(miniWindow.subscribeVisibility(vi.fn())).rejects.toThrow('native query failed');
  expect(native.off).toHaveBeenCalledOnce();
});
it('isVisible reads native state without caching a toggle result', async () => {
  native.invoke.mockResolvedValueOnce({ visible: false, revision: 0 }).mockResolvedValueOnce({ visible: true, revision: 1 });
  expect(await miniWindow.isVisible()).toBe(false);
  expect(await miniWindow.isVisible()).toBe(true);
});
