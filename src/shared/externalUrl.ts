export interface SafeExternalLink {
  href: string;
  host: string;
  protocol: 'http:' | 'https:';
}

export interface ExternalUrlPort {
  openExternalUrl(url: string): Promise<void>;
}

let defaultExternalUrlPort: ExternalUrlPort = {
  async openExternalUrl(url: string): Promise<void> {
    const safe = normalizeSafeExternalUrl(url);
    if (!safe) {
      throw new Error(`UNSAFE_EXTERNAL_URL：仅允许打开 http 或 https 链接（已拒绝 ${url}）`);
    }
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_external_url', { url: safe.href });
  },
};

export function setDefaultExternalUrlPort(port: ExternalUrlPort): void {
  defaultExternalUrlPort = port;
}

/**
 * 严格校验并归一化外部链接（ADR 0026）：
 * 仅允许显式 http: 或 https: 协议且具备有效 hostname 的链接；
 * 拒绝 javascript:、file:、data:、vbscript:、自定义协议或相对路径。
 */
export function normalizeSafeExternalUrl(raw: string | null | undefined): SafeExternalLink | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return {
      href: parsed.href,
      host: parsed.host || parsed.hostname,
      protocol: parsed.protocol,
    };
  } catch {
    return null;
  }
}

/**
 * 从标题或 Markdown 文本中提取去重后的安全 http/https 外链列表。
 */
export function extractSafeExternalLinks(...texts: (string | null | undefined)[]): SafeExternalLink[] {
  const combined = texts.filter((t): t is string => typeof t === 'string' && t.length > 0).join('\n');
  if (!combined) return [];
  const seen = new Set<string>();
  const out: SafeExternalLink[] = [];

  const add = (candidate: string) => {
    const cleaned = candidate.replace(/[),.;!?'"\]>]+$/g, '');
    const safe = normalizeSafeExternalUrl(cleaned);
    if (safe && !seen.has(safe.href)) {
      seen.add(safe.href);
      out.push(safe);
    }
  };

  const mdLinkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  for (let m = mdLinkRe.exec(combined); m; m = mdLinkRe.exec(combined)) {
    add(m[1]);
  }

  const rawUrlRe = /\bhttps?:\/\/[^\s<>()[\]"']+/gi;
  for (let m = rawUrlRe.exec(combined); m; m = rawUrlRe.exec(combined)) {
    add(m[0]);
  }

  return out;
}

export async function openSafeExternalUrl(
  rawUrl: string,
  port: ExternalUrlPort = defaultExternalUrlPort,
): Promise<SafeExternalLink> {
  const safe = normalizeSafeExternalUrl(rawUrl);
  if (!safe) {
    throw new Error(`UNSAFE_EXTERNAL_URL：仅允许打开 http 或 https 链接（已拒绝 ${rawUrl}）`);
  }
  await port.openExternalUrl(safe.href);
  return safe;
}
