import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export async function chooseRoot(): Promise<string | null> {
  await invoke('dialog_active', { active: true });
  try {
    const root = await open({ directory: true, recursive: true, multiple: false, title: '选择数据目录' });
    if (root) await invoke('save_config', { root });
    return root;
  } finally { await invoke('dialog_active', { active: false }); }
}
