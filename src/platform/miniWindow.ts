import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

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
