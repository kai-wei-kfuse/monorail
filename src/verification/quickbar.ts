import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import type { RecordEntry } from '../domain/record/record';

export async function install(persist: (input: RecordEntry) => Promise<void>) {
  if (!await invoke<boolean>('verification_enabled')) throw new Error('Verification build required');
  await listen<RecordEntry>('verification-create-record', event => {
    void persist(event.payload).then(() => emit('verification-record-saved', event.payload.id))
      .catch(error => invoke('evidence', { message: `verification-quickbar-failed:${String(error)}` }));
  });
  await invoke('evidence', { message: 'verification-ready-quickbar' });
}
