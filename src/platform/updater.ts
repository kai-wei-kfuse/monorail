import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UpdateChannel, UpdateState } from '../shared/updates';

export interface UpdatesPort {
  snapshot(): Promise<UpdateState>;
  subscribe(receive: (state: UpdateState) => void): Promise<() => void>;
  check(): Promise<UpdateState>;
  checkStableTarget?(): Promise<UpdateState>;
  setChannel?(channel: UpdateChannel): Promise<UpdateState>;
  dismissTarget?(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  prepareInstall(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  cancelInstall(error: string): Promise<UpdateState>;
  focusDirtyWindow?(): Promise<string | null>;
}

export const nativeUpdates: UpdatesPort = {
  snapshot: () => invoke('read_update_state'),
  subscribe: receive => listen<UpdateState>('updater-state', event => receive(event.payload)),
  check: () => invoke('check_update'),
  checkStableTarget: () => invoke('check_stable_update'),
  setChannel: channel => invoke('set_update_channel', { channel }),
  dismissTarget: () => invoke('dismiss_update_target'),
  download: () => invoke('download_update'),
  prepareInstall: () => invoke('prepare_update_install'),
  install: () => invoke('install_update'),
  cancelInstall: error => invoke('cancel_update_install', { error }),
  focusDirtyWindow: () => invoke('focus_dirty_window'),
};
