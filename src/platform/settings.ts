import { invoke } from '@tauri-apps/api/core';
import { enable, disable } from '@tauri-apps/plugin-autostart';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type HotkeyKey = 'quickbarHotkey' | 'mainHotkey';
export interface SettingsPlatform {
  setHotkey(key: HotkeyKey, shortcut: string): Promise<void>;
  setAutostart(enabled: boolean): Promise<void>;
  setAlwaysOnTop(enabled: boolean): Promise<void>;
}
export interface DataDirectoryPort { changeDataDirectory(): Promise<void> }
export const nativeSettingsPlatform: SettingsPlatform = {
  setHotkey: (key, shortcut) => invoke('set_shortcut', { key, shortcut }),
  setAutostart: enabled => enabled ? enable() : disable(),
  setAlwaysOnTop: enabled => getCurrentWindow().setAlwaysOnTop(enabled),
};
