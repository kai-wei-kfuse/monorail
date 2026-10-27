import { invoke } from '@tauri-apps/api/core';

/** A save session spans attachments, record, and the data-changed signal. */
export async function withQuickSave<T>(id: string, save: () => Promise<T>): Promise<T> {
  await invoke('begin_quick_save', { id });
  try { return await save(); }
  finally { await invoke('end_quick_save', { id }); }
}
