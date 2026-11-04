import type { CallerAgent } from './application.ts';

/*
 * 调用方（agent）的显示名对照（ADR 0019 第 6 条）：原始名字经这里换成显示名，表里没有的 name 记 null、界面按 raw 原样显示。
 * 全部是自报、未验证，只用于显示和筛选。
 * 未实测：下面的原始值来自各客户端公开的默认值，还没有逐个用真实客户端核对（执行方案 E8a4 第 5 条，归入 E9）。
 */
export const MCP_CLIENT_NAMES: Readonly<Record<string, string>> = {
  'claude-ai': 'Claude Desktop',
  'claude-code': 'Claude Code',
  'cursor-vscode': 'Cursor',
  'Visual Studio Code': 'VS Code',
  'codex-mcp-client': 'Codex',
  'gemini-cli-mcp-client': 'Gemini CLI',
};

/** MCP 握手里的 clientInfo → 调用方；读不到（HTTP 无状态模式）记未识别，不猜。 */
export function mcpAgent(info: { name?: unknown; version?: unknown } | undefined): CallerAgent {
  const raw = typeof info?.name === 'string' ? info.name.trim() : '';
  if (!raw) return { name: null, detected_by: 'none' };
  const version = typeof info?.version === 'string' && info.version.trim() ? info.version.trim() : undefined;
  return { name: MCP_CLIENT_NAMES[raw] ?? null, raw, ...(version ? { version } : {}), detected_by: 'mcp_handshake' };
}

/** 界面显示用：显示名 → 原始名字 → 「未识别」。 */
export function agentLabel(agent: Pick<CallerAgent, 'name' | 'raw' | 'detected_by'>): string {
  return agent.name ?? (agent.detected_by === 'none' ? '未识别' : agent.raw ?? '未识别');
}
