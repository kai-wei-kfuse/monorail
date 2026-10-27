import { invoke } from '@tauri-apps/api/core';

/** Narrow native write: attachments/<recordId>/<name>. Returns the data-relative path stored on the record. */
export async function saveAttachment(recordId: string, name: string, blob: Blob): Promise<string> {
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
  return invoke<string>('save_attachment', { record: recordId, name, bytes });
}
