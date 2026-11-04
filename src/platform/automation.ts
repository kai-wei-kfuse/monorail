import { invoke } from '@tauri-apps/api/core';

export interface AutomationHostMetadata {
  executable: string;
  mcp_entry: string | null;
  cli_entry: string | null;
  identifier: string;
  pipe: string;
}

export function readAutomationHost(): Promise<AutomationHostMetadata> {
  return invoke<AutomationHostMetadata>('read_mcp_host');
}
