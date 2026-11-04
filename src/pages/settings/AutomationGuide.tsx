import { useState } from 'react';
import type { ReactNode } from 'react';
import { Group } from '../../ui/layout/GroupTitle';
import { Button } from '../../ui/controls/Button';
import type { AutomationHostState } from './automationData';
import {
  buildCliExamples,
  CAPABILITY_CATEGORIES,
  formatMcpStdioConfigJson,
  formatPowerShellNodeCommand,
  TROUBLESHOOTING_ITEMS,
} from './automationData';

export interface AutomationGuideProps {
  /** 「最近调用」组的内容与细线右端的小字（0.3.0-beta.3 E8c 第 3 条，由接线层给 widgets/history 的 RecentCalls） */
  recent?: ReactNode;
  recentRight?: ReactNode;
  hostState?: AutomationHostState;
  onRefreshHost?: () => void;
  onCopyText?: (text: string) => Promise<void>;
}

const defaultCopyText = async (text: string): Promise<void> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    throw new Error('当前环境不支持剪贴板写入接口');
  }
  await navigator.clipboard.writeText(text);
};

export function AutomationGuide({ recent, recentRight, hostState, onRefreshHost, onCopyText = defaultCopyText }: AutomationGuideProps) {
  const [copyStatus, setCopyStatus] = useState<{ targetId: string; ok: boolean; message: string } | null>(null);
  const loading = hostState?.loading ?? false;
  const info = hostState?.info ?? null;
  const hostError = hostState?.error ?? null;
  const mcpEntry = info?.mcp_entry && info.mcp_entry.trim().length > 0 ? info.mcp_entry : null;
  const cliEntry = info?.cli_entry && info.cli_entry.trim().length > 0 ? info.cli_entry : null;

  const mcpConfigJson = mcpEntry ? formatMcpStdioConfigJson(mcpEntry) : null;
  const mcpHttpCommand = mcpEntry ? formatPowerShellNodeCommand(mcpEntry, ['--http', '--port', '8765']) : null;
  const cliExamples = buildCliExamples(cliEntry);

  const handleCopy = (targetId: string, label: string, text: string | null) => {
    if (!text) return;
    void onCopyText(text).then(
      () => setCopyStatus({ targetId, ok: true, message: `已复制${label} ✓` }),
      err => {
        const detail = err instanceof Error ? err.message : String(err);
        setCopyStatus({ targetId, ok: false, message: `复制${label}失败：${detail}` });
      },
    );
  };

  return (
    <div className="st-auto">
      <Group cn="接入概览" en="OVERVIEW">
        <div className="st-auto-card">
          <p className="st-auto-lead">
            支持 MCP 协议的客户端可通过 <strong>MCP</strong> 接入；具备终端执行能力的 AI 代理、自动化脚本或用户可直接调用{' '}
            <strong>CLI</strong>，无需额外经由 MCP 转发。两种方式共用单轨的同一套应用接口与本地数据。
          </p>
          <div className="st-auto-grid">
            {CAPABILITY_CATEGORIES.map(cat => (
              <div key={cat.title} className="st-auto-item">
                <strong>{cat.title}</strong>
                <code>{cat.methods}</code>
                <p>{cat.summary}</p>
              </div>
            ))}
          </div>
          <div className="st-auto-notes">
            <p>
              <strong>首次初始化与后台按需启动：</strong>首次使用须先打开单轨桌面端并选择数据目录。完成初始化后，即使关闭主窗口或退出应用，MCP
              与 CLI 在收到请求时也会自动按需启动本机后台进程（不弹出主窗口、不抢占焦点）。后台按需启动仅在调用时触发，与「Windows
              开机自启」相互独立。
            </p>
            <p>
              <strong>支持边界与数据影响：</strong>当前仅支持本机访问，不支持电脑关机、设备离线或跨设备远程调用，亦不包含尚未实现的任务整理、想法转任务或周回顾生成功能。AI
              与脚本执行的写入操作会真实修改本地记录与计时状态。
            </p>
          </div>
        </div>
      </Group>

      {recent !== undefined && <Group cn="最近调用" en="RECENT CALLS" right={recentRight}>{recent}</Group>}

      <Group cn="MCP 配置" en="MCP CONFIG">
        <div className="st-auto-card">
          <div className="st-auto-path-row">
            <span>MCP 入口路径：</span>
            {mcpEntry ? (
              <code className="st-path">{mcpEntry}</code>
            ) : (
              <span className="st-err">
                {loading ? '正在读取运行时入口路径…' : '未检测到有效的 monorail-mcp.mjs 路径'}
              </span>
            )}
            {onRefreshHost && (
              <Button disabled={loading} onClick={onRefreshHost}>
                重新检测路径
              </Button>
            )}
          </div>

          {!loading && (hostError || !mcpEntry) && (
            <div className="st-auto-alert" role="alert">
              <strong>无法生成 MCP 配置（不使用猜测路径）</strong>
              <p>
                {hostError ??
                  '当前运行实例未能定位到实际分发的 monorail-mcp.mjs 文件。若为安装版，请从托盘完全退出单轨后重新启动，或重新运行安装包修复；关闭主窗口仅会隐藏窗口。若为源码开发环境，请先执行 npm run mcp:build，再重新启动开发应用以刷新入口登记，然后点击「重新检测路径」。'}
              </p>
            </div>
          )}

          <p className="st-auto-desc">
            默认采用标准输入输出（stdio）方式由客户端按需拉起，无需手动先行启动 HTTP 服务。不同客户端的配置文件路径或外层字段名称（如{' '}
            <code>mcpServers</code>）可能存在差异，请参照对应客户端文档填入：
          </p>
          <pre className="st-auto-code" aria-label="MCP stdio 配置 JSON">
            <code>{mcpConfigJson ?? '// 待检测到有效的 monorail-mcp.mjs 路径后生成配置'}</code>
          </pre>
          <div className="st-auto-actions">
            <Button
              tone="ink"
              disabled={!mcpConfigJson}
              onClick={() => handleCopy('mcp-stdio', ' MCP 配置', mcpConfigJson)}
            >
              复制 MCP 配置
            </Button>
            {copyStatus?.targetId === 'mcp-stdio' && (
              <span className={copyStatus.ok ? 'st-auto-feedback ok' : 'st-err'} role={copyStatus.ok ? 'status' : 'alert'}>
                {copyStatus.message}
              </span>
            )}
          </div>

          <details className="st-auto-sub">
            <summary>可选：本机 Streamable HTTP 启动方式（默认 stdio 无需启动）</summary>
            <p>
              默认 stdio 连接无需手动运行此命令。仅当客户端要求通过本机 HTTP 端点（默认监听{' '}
              <code>http://127.0.0.1:8765/mcp</code>，仅本机可达，需手动启动）连接时，可在 Windows PowerShell 中执行：
            </p>
            <div className="st-auto-cmd-row">
              <code className="st-auto-cmd">{mcpHttpCommand ?? '# 待检测到有效的 monorail-mcp.mjs 路径后生成命令'}</code>
              <Button
                disabled={!mcpHttpCommand}
                onClick={() => handleCopy('mcp-http', ' HTTP 启动命令', mcpHttpCommand)}
              >
                复制
              </Button>
            </div>
            {copyStatus?.targetId === 'mcp-http' && (
              <span className={copyStatus.ok ? 'st-auto-feedback ok' : 'st-err'} role={copyStatus.ok ? 'status' : 'alert'}>
                {copyStatus.message}
              </span>
            )}
          </details>
        </div>
      </Group>

      <Group cn="CLI 命令" en="CLI EXAMPLES">
        <div className="st-auto-card">
          <div className="st-auto-path-row">
            <span>CLI 入口路径：</span>
            {cliEntry ? (
              <code className="st-path">{cliEntry}</code>
            ) : (
              <span className="st-err">
                {loading ? '正在读取运行时入口路径…' : '未检测到有效的 monorail-cli.mjs 路径'}
              </span>
            )}
          </div>

          {!loading && (hostError || !cliEntry) && (
            <div className="st-auto-alert" role="alert">
              <strong>无法生成可执行 CLI 命令（不使用猜测路径）</strong>
              <p>
                {hostError ??
                  '当前运行实例未能定位到实际分发的 monorail-cli.mjs 文件。若为安装版，请从托盘完全退出单轨后重新启动，或重新运行安装包修复；关闭主窗口仅会隐藏窗口。若为源码开发环境，请先执行 npm run mcp:build，再重新启动开发应用以刷新入口登记，然后点击「重新检测路径」。'}
              </p>
            </div>
          )}

          <p className="st-auto-desc">
            <code>monorail-cli.mjs</code> 为自包含执行包，直接通过 <code>node</code> 调用，无需构建源码；当前版本不注册全局{' '}
            <code>monorail</code> 命令或修改系统 <code>PATH</code>。附加 <code>--json</code>{' '}
            参数时，标准输出仅返回结构化 JSON，适合程序与 AI 解析。以下示例均采用 Windows PowerShell 单引号安全引用，点击「复制」仅复制文本，不会在页面内触发写入。
          </p>

          <div className="st-auto-cli-list">
            {cliExamples.map(ex => {
              const targetId = `cli-${ex.id}`;
              return (
                <div key={ex.id} className="st-auto-cli-item">
                  <div className="st-auto-cli-head">
                    <strong>{ex.title}</strong>
                    <span>{ex.desc}</span>
                  </div>
                  <div className="st-auto-cmd-row">
                    <code className="st-auto-cmd">{ex.command ?? '# 待检测到有效的 monorail-cli.mjs 路径后生成命令'}</code>
                    <Button disabled={!ex.command} onClick={() => handleCopy(targetId, `「${ex.title}」命令`, ex.command)}>
                      复制
                    </Button>
                  </div>
                  {copyStatus?.targetId === targetId && (
                    <span
                      className={copyStatus.ok ? 'st-auto-feedback ok' : 'st-err'}
                      role={copyStatus.ok ? 'status' : 'alert'}
                    >
                      {copyStatus.message}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Group>

      <Group cn="前提与排错" en="TROUBLESHOOTING">
        <div className="st-auto-card">
          <div className="st-auto-prereq">
            <strong>运行环境要求：Node.js 24+</strong>
            <p>
              MCP 与 CLI 入口均需本机安装 <strong>Node.js 24</strong> 或更高版本。若客户端或终端提示找不到 <code>node</code>（如{' '}
              <code>spawn node ENOENT</code>），请在 Windows PowerShell 中依次执行 <code>node -v</code> 与{' '}
              <code>where.exe node</code> 核对安装状态及版本；确认无误后重启对应客户端以刷新进程环境变量，或将 MCP 配置中的{' '}
              <code>"command": "node"</code> 替换为 <code>node.exe</code> 的完整绝对路径。
            </p>
          </div>
          <div className="st-auto-errors">
            {TROUBLESHOOTING_ITEMS.map(item => (
              <div key={item.code} className="st-auto-err-item">
                <div>
                  <code>{item.code}</code>
                  <strong>{item.title}</strong>
                </div>
                <p>{item.resolution}</p>
              </div>
            ))}
          </div>
        </div>
      </Group>
    </div>
  );
}
