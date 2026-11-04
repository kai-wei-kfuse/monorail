import { execFileSync } from 'node:child_process';
import { createElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { applicationContracts } from '../../shared/application';
import { defaults } from '../../shared/settings';
import type { QuickActivity } from '../../shared/settings';
import {
  buildCliExamples,
  CAPABILITY_CATEGORIES,
  formatMcpStdioConfigJson,
  formatPowerShellNodeCommand,
} from './automationData';
import { PresetEditor } from './PresetEditor';
import { SECTIONS } from './sections';
import { SettingsPage } from './SettingsPage';

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useState: vi.fn((init: unknown) => [typeof init === 'function' ? (init as () => unknown)() : init, vi.fn()]),
  useRef: vi.fn((init = null) => ({ current: init })),
  useId: vi.fn(() => 'id-mock'),
  useEffect: vi.fn(),
}));

function walk(node: ReactNode, visit: (el: ReactElement<Record<string, unknown>>) => void): void {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!isValidElement(node)) return;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === 'function') {
    walk((el.type as (props: Record<string, unknown>) => ReactNode)(el.props), visit);
    return;
  }
  visit(el);
  walk(el.props.children as ReactNode, visit);
}

describe('settings defaults & UI', () => {
  it('默认采用融合首页布局与薄荷绿强调色，并在外观设置页默认选中', () => {
    expect(defaults.homeLayout).toBe('fused');
    expect(defaults.accent).toBe('#00f5a0');
    const html = renderToStaticMarkup(createElement(SettingsPage, {
      section: 'look', onSection: vi.fn(), settings: structuredClone(defaults),
      onChange: vi.fn(), onListsChange: vi.fn(), projects: [], knownTags: [],
      dataDir: 'D:\\monorail', onChangeDir: vi.fn(), version: '0.2.5',
    }));
    expect(html).toContain('aria-checked="true" tabindex="0">融合</button>');
    expect(html).toContain('<span class="sw-name">薄荷绿</span>');
  });

  it('窗口与数据设置将小小窗口改名为 mini窗口，点击切换 tiny 模式', () => {
    const onChange = vi.fn();
    const tree = createElement(SettingsPage, {
      section: 'window', onSection: vi.fn(), settings: structuredClone(defaults),
      onChange, onListsChange: vi.fn(), projects: [], knownTags: [],
      dataDir: 'D:\\monorail', onChangeDir: vi.fn(), version: '0.2.5',
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('mini窗口');
    expect(html).not.toContain('小小窗口');

    let clickMini: (() => void) | null = null;
    walk(tree, el => {
      const ch = el.props.children;
      const text = Array.isArray(ch) ? ch[0] : ch;
      if (el.type === 'button' && el.props.role === 'radio' && text === 'mini窗口') {
        clickMini = el.props.onClick as () => void;
      }
    });
    expect(clickMini).not.toBeNull();
    clickMini!();
    expect(onChange).toHaveBeenCalledWith('miniMode', 'tiny');
  });

  it('预设与快捷活动编辑器（05）的分类和标签使用列表同款 flat 无框样式，并保留修改回调', () => {
    const presets: QuickActivity[] = [
      { id: 'q1', name: '吃饭', project: '生活', tags: ['日常'], mode: '插入', place: '弹层' },
      { id: 'q2', name: '上厕所', project: '生活', tags: [], mode: '插入', place: '弹层' },
    ];
    const onChange = vi.fn(), onCreateProject = vi.fn(), onCreateTag = vi.fn();
    const tree = createElement(PresetEditor, {
      presets, place: '弹层', placeholder: '例如：厕所、拿快递、吃饭',
      projects: [{ name: '生活', color: '#888884' }, { name: '运动', color: '#00f5a0' }],
      knownTags: ['日常', '休息'],
      onChange, onCreateProject, onCreateTag,
    });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('class="combo flat"');
    expect(html).toContain('class="tagpick flat"');
    expect(html).not.toContain('class="combo sm"');

    // 验证删除已有标签片触发 onChange 更新对应预设
    let removeTag: ((e: { stopPropagation: () => void }) => void) | null = null;
    walk(tree, el => {
      if (el.type === 'button' && el.props['aria-label'] === '移除 #日常') {
        removeTag = el.props.onClick as (e: { stopPropagation: () => void }) => void;
      }
    });
    expect(removeTag).not.toBeNull();
    removeTag!({ stopPropagation: vi.fn() });
    expect(onChange).toHaveBeenCalledWith([
      { id: 'q1', name: '吃饭', project: '生活', tags: [], mode: '插入', place: '弹层' },
      presets[1],
    ]);
  });

  it('09 AI 与自动化排在 10 关于之前，且能力列表严格对齐 applicationContracts 全部 15 项方法', () => {
    const autoSec = SECTIONS.find(s => s.id === 'automation');
    const aboutSec = SECTIONS.find(s => s.id === 'about');
    expect(autoSec?.no).toBe('09');
    expect(aboutSec?.no).toBe('10');

    const documentedMethods = CAPABILITY_CATEGORIES.flatMap(c =>
      c.methods.split('·').map(s => s.trim()),
    ).sort();
    const contractMethods = Object.keys(applicationContracts).sort();
    expect(documentedMethods).toEqual(contractMethods);
  });

  it('MCP JSON 与 PowerShell 命令生成对含中文、空格、括号、$、反引号与单引号路径安全转义且不触发插值', () => {
    const trickyMcpPath = "C:\\Users\\o'connor\\单轨 测试(4)\\$env:TEMP\\`n\\monorail-mcp.mjs";
    const trickyCliPath = "C:\\Users\\o'connor\\单轨 测试(4)\\$env:TEMP\\`n\\monorail-cli.mjs";

    const jsonText = formatMcpStdioConfigJson(trickyMcpPath);
    const parsed = JSON.parse(jsonText) as { mcpServers: { monorail: { command: string; args: string[] } } };
    expect(parsed.mcpServers.monorail.command).toBe('node');
    expect(parsed.mcpServers.monorail.args).toEqual([trickyMcpPath]);

    const examples = buildCliExamples(trickyCliPath);
    expect(examples.map(e => e.id)).toEqual([
      'context',
      'idea-add',
      'time-summary',
      'timer-start',
      'timer-stop',
      'help',
    ]);

    const ideaCmd = examples.find(e => e.id === 'idea-add')!.command!;
    expect(ideaCmd).toBe(
      "node 'C:\\Users\\o''connor\\单轨 测试(4)\\$env:TEMP\\`n\\monorail-cli.mjs' idea add '整理季度复盘提纲 #规划' --json",
    );

    const httpCmd = formatPowerShellNodeCommand(trickyMcpPath, ['--http', '--port', '8765']);
    expect(httpCmd).toBe(
      "node 'C:\\Users\\o''connor\\单轨 测试(4)\\$env:TEMP\\`n\\monorail-mcp.mjs' --http --port 8765",
    );

    if (process.platform === 'win32') {
      // 在真实 PowerShell 中定义名为 node 的收集函数，验证复制出的命令文本可直接执行且参数无插值破坏
      const psScript = `
        $OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        function node { [Console]::Out.WriteLine((ConvertTo-Json -Compress @($args))) }
        ${ideaCmd}
      `;
      const rawOut = execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], {
        encoding: 'utf8',
      }).trim();
      const receivedArgs = JSON.parse(rawOut) as string[];
      expect(receivedArgs).toEqual([trickyCliPath, 'idea', 'add', '整理季度复盘提纲 #规划', '--json']);
    }
  });

  it('AI 与自动化页在路径有效时可复制 MCP 配置与 CLI 命令，复制失败或路径缺失时明确报错且不猜测路径', async () => {
    const mcpPath = 'D:\\Program Files\\单轨 Beta\\monorail-mcp.mjs';
    const cliPath = 'D:\\Program Files\\单轨 Beta\\monorail-cli.mjs';

    let stateMap: Array<[unknown, ReturnType<typeof vi.fn>]> = [];
    const reactMock = await import('react');
    vi.mocked(reactMock.useState).mockImplementation(((init: unknown) => {
      const val = typeof init === 'function' ? (init as () => unknown)() : init;
      const setter = vi.fn();
      stateMap.push([val, setter]);
      return [val, setter];
    }) as unknown as typeof reactMock.useState);

    const onCopyOk = vi.fn().mockResolvedValue(undefined);
    stateMap = [];
    const validTree = createElement(SettingsPage, {
      section: 'automation',
      onSection: vi.fn(),
      settings: structuredClone(defaults),
      onChange: vi.fn(),
      onListsChange: vi.fn(),
      projects: [],
      knownTags: [],
      dataDir: 'D:\\monorail',
      onChangeDir: vi.fn(),
      version: '0.3.0-beta.2',
      onCopyText: onCopyOk,
      automationHost: {
        loading: false,
        error: null,
        info: {
          executable: 'D:\\Program Files\\单轨 Beta\\单轨.exe',
          mcp_entry: mcpPath,
          cli_entry: cliPath,
          identifier: 'local.pixelrecord.app',
          pipe: '\\\\.\\pipe\\local.pixelrecord.app.mcp',
        },
      },
    });
    const validHtml = renderToStaticMarkup(validTree);
    expect(validHtml).toContain(mcpPath);
    expect(validHtml).toContain(cliPath);
    expect(validHtml).not.toContain('无法生成 MCP 配置');

    let copyMcpClick: (() => void) | null = null;
    walk(validTree, el => {
      const ch = el.props.children;
      const text = Array.isArray(ch) ? ch[0] : ch;
      if (el.type === 'button' && text === '复制 MCP 配置') {
        expect(el.props.disabled).toBeFalsy();
        copyMcpClick = el.props.onClick as () => void;
      }
    });
    expect(copyMcpClick).not.toBeNull();
    copyMcpClick!();
    await Promise.resolve();
    expect(onCopyOk).toHaveBeenCalledWith(formatMcpStdioConfigJson(mcpPath));
    expect(stateMap.at(-1)![1]).toHaveBeenCalledWith({
      targetId: 'mcp-stdio',
      ok: true,
      message: '已复制 MCP 配置 ✓',
    });

    // 复制失败时报错且不伪装成功
    const onCopyFail = vi.fn().mockRejectedValue(new Error('剪贴板被拒绝'));
    stateMap = [];
    const failTree = createElement(SettingsPage, {
      section: 'automation',
      onSection: vi.fn(),
      settings: structuredClone(defaults),
      onChange: vi.fn(),
      onListsChange: vi.fn(),
      projects: [],
      knownTags: [],
      dataDir: 'D:\\monorail',
      onChangeDir: vi.fn(),
      version: '0.3.0-beta.2',
      onCopyText: onCopyFail,
      automationHost: {
        loading: false,
        error: null,
        info: {
          executable: 'D:\\Program Files\\单轨 Beta\\单轨.exe',
          mcp_entry: mcpPath,
          cli_entry: cliPath,
          identifier: 'local.pixelrecord.app',
          pipe: '\\\\.\\pipe\\local.pixelrecord.app.mcp',
        },
      },
    });
    let failMcpClick: (() => void) | null = null;
    walk(failTree, el => {
      const ch = el.props.children;
      const text = Array.isArray(ch) ? ch[0] : ch;
      if (el.type === 'button' && text === '复制 MCP 配置') {
        failMcpClick = el.props.onClick as () => void;
      }
    });
    failMcpClick!();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(stateMap.at(-1)![1]).toHaveBeenCalledWith({
      targetId: 'mcp-stdio',
      ok: false,
      message: '复制 MCP 配置失败：剪贴板被拒绝',
    });

    // 路径缺失时显示错误提示并禁用全部复制按钮，绝不猜测路径
    const missingTree = createElement(SettingsPage, {
      section: 'automation',
      onSection: vi.fn(),
      settings: structuredClone(defaults),
      onChange: vi.fn(),
      onListsChange: vi.fn(),
      projects: [],
      knownTags: [],
      dataDir: 'D:\\monorail',
      onChangeDir: vi.fn(),
      version: '0.3.0-beta.2',
      automationHost: {
        loading: false,
        error: '无法读取本机自动化入口元信息（mcp-host.json 不存在）',
        info: null,
      },
    });
    const missingHtml = renderToStaticMarkup(missingTree);
    expect(missingHtml).toContain('无法生成 MCP 配置（不使用猜测路径）');
    expect(missingHtml).toContain('无法生成可执行 CLI 命令（不使用猜测路径）');
    expect(missingHtml).toContain('无法读取本机自动化入口元信息（mcp-host.json 不存在）');

    const copyButtonsDisabled: boolean[] = [];
    walk(missingTree, el => {
      const ch = el.props.children;
      const text = Array.isArray(ch) ? ch[0] : ch;
      if (el.type === 'button' && (text === '复制 MCP 配置' || text === '复制')) {
        copyButtonsDisabled.push(Boolean(el.props.disabled));
      }
    });
    expect(copyButtonsDisabled.length).toBe(8); // 1 MCP stdio + 1 MCP HTTP + 6 CLI examples
    expect(copyButtonsDisabled.every(Boolean)).toBe(true);

    // R2: 当 mcp-host.json 可读但入口文件缺失（mcp_entry/cli_entry 为 null）时，指引从托盘完全退出重启或构建后重启开发应用
    const nullEntryTree = createElement(SettingsPage, {
      section: 'automation',
      onSection: vi.fn(),
      settings: structuredClone(defaults),
      onChange: vi.fn(),
      onListsChange: vi.fn(),
      projects: [],
      knownTags: [],
      dataDir: 'D:\\monorail',
      onChangeDir: vi.fn(),
      version: '0.3.0-beta.2',
      automationHost: {
        loading: false,
        error: null,
        info: {
          executable: 'D:\\Program Files\\单轨 Beta\\单轨.exe',
          mcp_entry: null,
          cli_entry: null,
          identifier: 'local.pixelrecord.app',
          pipe: '\\\\.\\pipe\\local.pixelrecord.app.mcp',
        },
      },
    });
    const nullEntryHtml = renderToStaticMarkup(nullEntryTree);
    expect(nullEntryHtml).toContain('请从托盘完全退出单轨后重新启动');
    expect(nullEntryHtml).toContain('再重新启动开发应用以刷新入口登记');
  });
});
