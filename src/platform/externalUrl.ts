import { invoke } from '@tauri-apps/api/core';
import {
  extractSafeExternalLinks,
  normalizeSafeExternalUrl,
  openSafeExternalUrl,
  setDefaultExternalUrlPort,
  type ExternalUrlPort,
  type SafeExternalLink,
} from '../shared/externalUrl';

export type { ExternalUrlPort, SafeExternalLink };
export { extractSafeExternalLinks, normalizeSafeExternalUrl, openSafeExternalUrl };

export const nativeExternalUrlPort: ExternalUrlPort = {
  async openExternalUrl(url: string): Promise<void> {
    const safe = normalizeSafeExternalUrl(url);
    if (!safe) {
      throw new Error(`UNSAFE_EXTERNAL_URL：仅允许打开 http 或 https 链接（已拒绝 ${url}）`);
    }
    await invoke('open_external_url', { url: safe.href });
  },
};

setDefaultExternalUrlPort(nativeExternalUrlPort);
