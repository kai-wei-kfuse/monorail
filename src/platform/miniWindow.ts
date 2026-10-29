import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';

// Keep the compact modes short enough to remain floating controls, while allowing longer titles.
export const miniWindowSizes = {
  mini: { width: 520, height: 88, minWidth: 320, maxWidth: 760 },
  tiny: { width: 320, height: 46, minWidth: 320, maxWidth: 520 },
} as const;

export async function resizeMiniWindow(mode: 'mini' | 'tiny', width: number, height: number): Promise<void> {
  const bounds = miniWindowSizes[mode], window = getCurrentWindow();
  // Native hit testing disables vertical resizing. Equal min/max heights let Windows' resize frame clip the client area.
  await window.setSizeConstraints({ minWidth: bounds.minWidth, maxWidth: bounds.maxWidth });
  await window.setSize(new LogicalSize(Math.max(bounds.minWidth, Math.min(width, bounds.maxWidth)), height));
}

export interface MiniVisibility { visible: boolean; revision: number }
export interface MiniWindowPort {
  toggle(): Promise<boolean>; showMain(): Promise<void>;
  isVisible(): Promise<boolean>;
  subscribeVisibility(handler: (visible: boolean) => void): Promise<() => void>;
}
export const miniWindow: MiniWindowPort = {
  toggle: () => invoke<boolean>('toggle_mini'),
  showMain: () => invoke<void>('show_main'),
  isVisible: async () => (await invoke<MiniVisibility>('read_mini_visibility')).visible,
  async subscribeVisibility(handler) {
    let revision = -1;
    const receive = (state: MiniVisibility) => {
      // Initial query replies and native events can cross in transit. Never regress the displayed state.
      if (state.revision <= revision) return;
      revision = state.revision; handler(state.visible);
    };
    const off = await listen<MiniVisibility>('mini-visibility', event => receive(event.payload));
    try { receive(await invoke<MiniVisibility>('read_mini_visibility')); }
    catch (error) { off(); throw error; }
    return off;
  },
};
