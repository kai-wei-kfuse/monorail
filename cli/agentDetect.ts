import type { CallerAgent } from '../src/shared/application.ts';

/*
 * CLI 调用方识别（ADR 0019 第 6 条）：--agent <名字> 或 MONORAIL_AGENT（flag，优先）→ 已知 agent 环境变量（env）→ none。
 * 全部是自报，只用于操作历史的显示和筛选。
 * 未实测：下面的环境变量是各工具公开文档里的说法，还没有在本机逐个核对（执行方案 E8a4 第 5 条，归入 E9）；
 * 识别不到的照样记「CLI · 未识别」，不影响调用。
 */
export const ENV_AGENTS: ReadonlyArray<readonly [variable: string, name: string]> = [
  ['CLAUDECODE', 'Claude Code'],
  ['CODEX_SANDBOX', 'Codex'],
  ['GEMINI_CLI', 'Gemini CLI'],
  ['CURSOR_AGENT', 'Cursor'],
];

/** 环境变量的值只在很短时写进证据（避免把长路径、令牌一类的值写进历史）。 */
const evidenceOf = (variable: string, value: string) => (value.length <= 16 ? `${variable}=${value}` : variable);

export function detectAgent(flag: string | undefined, env: Readonly<Record<string, string | undefined>>): CallerAgent {
  const fromFlag = flag?.trim();
  if (fromFlag) return { name: fromFlag, detected_by: 'flag', evidence: `--agent ${fromFlag}` };
  const fromEnv = env.MONORAIL_AGENT?.trim();
  if (fromEnv) return { name: fromEnv, detected_by: 'flag', evidence: `MONORAIL_AGENT=${fromEnv}` };
  for (const [variable, name] of ENV_AGENTS) {
    const value = env[variable];
    if (value !== undefined && value !== '') return { name, detected_by: 'env', evidence: evidenceOf(variable, value) };
  }
  return { name: null, detected_by: 'none' };
}
