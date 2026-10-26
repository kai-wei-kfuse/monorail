import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import type { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

let saved: { size: PhysicalSize; position: PhysicalPosition; maximized: boolean; pinned: boolean } | null = null;
export async function setMini(on: boolean): Promise<void> {
  const window = getCurrentWindow();
  if (on) {
    if (saved) return;
    saved = { size: await window.innerSize(), position: await window.outerPosition(), maximized: await window.isMaximized(), pinned: await window.isAlwaysOnTop() };
    if (saved.maximized) await window.unmaximize();
    await window.setMinSize(new LogicalSize(520, 88));
    await window.setSize(new LogicalSize(520, 88));
    await window.setAlwaysOnTop(true);
  } else {
    if (!saved) return;
    await window.setMinSize(new LogicalSize(960, 600));
    await window.setSize(saved.size);
    await window.setPosition(saved.position);
    await window.setAlwaysOnTop(saved.pinned);
    if (saved.maximized) await window.maximize();
    saved = null;
  }
}
