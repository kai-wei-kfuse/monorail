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

/** 弹层放在哪边、实际给多高（逻辑像素）。 */
export interface MiniFit { up: boolean; popup: number }
/**
 * 小窗随弹层变高（0.3.0-beta.4 D1）：barHeight 是小窗本体（含说明那一条）的高度，popup 是弹层想要的高度，0 = 收起。
 * Rust 以收起时的本体位置为锚点：下面放得下往下，放不下且上面更宽就往上（窗口上移、本体不动），高度不超过工作区剩余。
 */
export async function fitMiniWindow(mode: 'mini' | 'tiny', width: number, barHeight: number, popup: number): Promise<MiniFit> {
  const bounds = miniWindowSizes[mode], window = getCurrentWindow();
  await window.setSizeConstraints({ minWidth: bounds.minWidth, maxWidth: bounds.maxWidth });
  return invoke<MiniFit>('fit_mini_window', { width: Math.max(bounds.minWidth, Math.min(width, bounds.maxWidth)), barHeight, popup });
}

export interface MiniVisibility { visible: boolean; revision: number }
export interface MiniWindowPort {
  toggle(): Promise<boolean>; showMain(): Promise<void>;
  isVisible(): Promise<boolean>;
  subscribeVisibility(handler: (visible: boolean) => void): Promise<() => void>;
  subscribeExplicitClose(handler: () => void): Promise<() => void>;
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
  subscribeExplicitClose(handler) {
    return listen('mini-explicit-close', () => handler());
  },
};
