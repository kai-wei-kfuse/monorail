import { invoke } from '@tauri-apps/api/core';

export interface MiniWindowPort { toggle(): Promise<boolean>; showMain(): Promise<void> }
export const miniWindow: MiniWindowPort = {
  toggle: () => invoke<boolean>('toggle_mini'),
  showMain: () => invoke<void>('show_main'),
};
