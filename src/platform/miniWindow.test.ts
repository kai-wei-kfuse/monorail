import { beforeEach, expect, it, vi } from 'vitest';
import { miniWindow, resizeMiniWindow } from './miniWindow';
import type { MiniVisibility } from './miniWindow';
import type * as WindowApi from '@tauri-apps/api/window';

const native = vi.hoisted(() => ({
  invoke: vi.fn(), off: vi.fn(), constraints: vi.fn(), size: vi.fn(),
  receive: null as null | ((event: { payload: MiniVisibility }) => void),
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));
vi.mock('@tauri-apps/api/window', async importOriginal => ({
  ...await importOriginal<typeof WindowApi>(),
  getCurrentWindow: () => ({ setSizeConstraints: native.constraints, setSize: native.size }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_name, receive) => {
  native.receive = receive; return native.off;
}) }));
beforeEach(() => {
  vi.clearAllMocks(); native.receive = null;
  native.constraints.mockResolvedValue(undefined); native.size.mockResolvedValue(undefined);
});

it('limits tiny width without using vertical track constraints that clip the borderless client area', async () => {
  await resizeMiniWindow('tiny', 1200, 46);
  expect(native.constraints).toHaveBeenCalledWith({ minWidth: 320, maxWidth: 520 });
  expect(native.size).toHaveBeenCalledWith(expect.objectContaining({ width: 520, height: 46 }));
  expect(native.constraints.mock.invocationCallOrder[0]).toBeLessThan(native.size.mock.invocationCallOrder[0]);
});

it('enforces minimum width while content and mode determine the programmatic height', async () => {
  await resizeMiniWindow('tiny', 100, 70);
  expect(native.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 320, height: 70 }));
  await resizeMiniWindow('mini', 900, 88);
  expect(native.constraints).toHaveBeenLastCalledWith({ minWidth: 320, maxWidth: 760 });
  expect(native.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 760, height: 88 }));
  await resizeMiniWindow('tiny', 400, 46);
  expect(native.size).toHaveBeenLastCalledWith(expect.objectContaining({ width: 400, height: 46 }));
  expect(native.constraints).toHaveBeenLastCalledWith({ minWidth: 320, maxWidth: 520 });
});

it('reports native constraint failures without applying an unconstrained size', async () => {
  native.constraints.mockRejectedValueOnce(new Error('constraint update failed'));
  await expect(resizeMiniWindow('tiny', 320, 46)).rejects.toThrow('constraint update failed');
  expect(native.size).not.toHaveBeenCalled();
});

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
