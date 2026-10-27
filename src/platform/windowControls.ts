import { getCurrentWindow } from '@tauri-apps/api/window';

/** Self-drawn title bar controls (decorations are off). Closing hides to the tray; Rust intercepts close. */
export const windowControls = {
  startDragging: () => getCurrentWindow().startDragging(),
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  isMaximized: () => getCurrentWindow().isMaximized(),
  hide: () => getCurrentWindow().hide(),
  setPinned: (on: boolean) => getCurrentWindow().setAlwaysOnTop(on),
  isPinned: () => getCurrentWindow().isAlwaysOnTop(),
};
