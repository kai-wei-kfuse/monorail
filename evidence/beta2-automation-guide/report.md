# 0.3.0-beta.2「AI 与自动化」设置说明页实现与验证报告

- **版本**：`0.3.0-beta.2`
- **日期**：`2026-11-04`
- **执行人**：`@coder-3`
- **主审状态**：R1–R3 已关闭，开发审核通过，待用户验收；最终改动和验证边界见 [主审复核报告](./main-review-round2.md)。
- **依据文档**：
  - [docs/stages/0.3.0-beta.2.md](../../docs/stages/0.3.0-beta.2.md)
  - [docs/adr/0017-automation-settings-guide.md](../../docs/adr/0017-automation-settings-guide.md)

---

## 1. 实现范围（C0–C5）

### C0：版本与基线核对
- 执行 `npm run version:set -- 0.3.0-beta.2` 与 `npm run version:check`，同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 至 `0.3.0-beta.2`。
- 保持 15 项共享应用方法、MCP/CLI 协议、Beta 渠道更新状态机、数据 schema（`schemaVersion: 2`）及默认设置不变。

### C1 & C2：只读运行时路径接线、设置页导航与「09 AI 与自动化」说明页
- **Rust 只读命令与存在性校验**（[src-tauri/src/mcp_bridge.rs](../../src-tauri/src/mcp_bridge.rs)、[src-tauri/src/lib.rs](../../src-tauri/src/lib.rs)、[src-tauri/build.rs](../../src-tauri/build.rs)、[src-tauri/capabilities/main.json](../../src-tauri/capabilities/main.json)）：
  - `write_host_metadata` 的 `resolve_bundle_entry_path` 对 `resource_dir()` 与 `exe.parent()` 均校验 `.is_file()`，不在文件缺失时写入不存在的猜测路径。
  - 新增只读命令 `read_mcp_host`，直接读取现有 `%APPDATA%\<identifier>\mcp-host.json` 元信息并二次校验 `mcp_entry` 与 `cli_entry` 在磁盘上真实存在（不存在则置为 `None`），不引入第二套路径推断规则。
- **前端平台层与设置页组件**（[src/platform/automation.ts](../../src/platform/automation.ts)、[src/pages/settings/sections.ts](../../src/pages/settings/sections.ts)、[src/pages/settings/automationData.ts](../../src/pages/settings/automationData.ts)、[src/pages/settings/AutomationGuide.tsx](../../src/pages/settings/AutomationGuide.tsx)、[src/pages/settings/SettingsPage.tsx](../../src/pages/settings/SettingsPage.tsx)、[src/pages/settings/settings.css](../../src/pages/settings/settings.css)、[src/app/SettingsScreen.tsx](../../src/app/SettingsScreen.tsx)）：
  - 左侧导航新增 `09 AI 与自动化（AUTOMATION）`，原 `09 关于` 顺延为 `10 关于（ABOUT）`。
  - **接入概览（OVERVIEW）**：书面说明 MCP 与 CLI 适用场景、按四类完整列出 `applicationContracts` 全部 15 项方法，并明确首次初始化、本机后台按需启动（不同于 Windows 开机自启）及仅限本机访问的能力边界。
  - **MCP 配置（MCP CONFIG）**：使用标准 `JSON.stringify` 生成默认 stdio 配置片段（`mcpServers.monorail.command = "node"`、`args = [mcpEntryPath]`），提供「复制 MCP 配置」按钮及状态反馈；底部以 `<details>` 次要说明提供可选本机 Streamable HTTP 启动命令（`--http --port 8765`）。
  - **CLI 命令（CLI EXAMPLES）**：展示 `monorail-cli.mjs` 真实绝对路径，提供 6 条独立完整的 Windows PowerShell 命令示例（`context`、`idea add`、`time summary`、`timer start`、`timer stop`、`--help`），统一使用单引号安全转义（`quotePowerShellLiteral`：`'...'` 并将内嵌 `'` 加倍为 `''`，防止含空格、中文、括号、`$` 或反引号时发生插值或截断），每条配备独立「复制」按钮。
  - **前提与排错（TROUBLESHOOTING）**：列出 Node.js 24+ 运行要求与 `node -v` / `where.exe node` 排查步骤，以及 `SETUP_REQUIRED`、`CONFIG_CORRUPTED`、`STARTUP_FAILED` / `UNAVAILABLE` / `RECOVERY_FAILED`、`PENDING_CONFIRMATION` / `STATE_CHANGED`、`RESULT_UNKNOWN` / `HOST_LOST` 的规范处置指引。路径缺失或读取失败时显示显式 `role="alert"` 错误提示并禁用全部 8 个复制按钮。

---

## 2. 验证结果与证据清单（C3–C5）

| 验证项 | 命令 / 方式 | 结果 | 证据路径 |
|---|---|---|---|
| 版本号一致性检查 | `npm run version:check` | **通过（`0.3.0-beta.2: consistent`）** | — |
| 全量前端/协议/CLI 检查 | `npm run check` | **通过（69 文件 482 单测 + 12 MCP + 6 CLI）** | [check.log](./check.log) |
| Rust 后端单元测试 | `cargo test` | **通过（40 passed）** | [cargo-test.log](./cargo-test.log) |
| 发版工具测试 | `node --test scripts/publish-release.test.mjs scripts/verify-release-recovery.test.mjs` | **通过（10 passed）** | — |
| 正式配置桌面端构建 | `npm run tauri -- build --debug --no-bundle` | **通过（exit 0）** | [production-build.log](./production-build.log) |
| 隔离 NSIS 非默认中文空格路径安装与真实系统剪贴板复制 E2E 实测 | `node evidence/beta2-automation-guide/verify-beta2-guide.mjs`（不篡改或包装 `navigator.clipboard`，每次点击按钮前向 Windows 剪贴板写入 sentinel，点击后通过 `Get-Clipboard -Raw` 从真实系统剪贴板读回全部 8 项配置/命令并执行真实 MCP 与 PowerShell CLI 调用） | **通过（exit 0）** | [verification-result.json](./verification-result.json)<br>[sample-mcp-host.json](./sample-mcp-host.json) |
| 测试前后 Windows `Run` 注册表与日常版快照核验 | 对比快照覆盖范围（`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 全部键值、日常版 `%LOCALAPPDATA%\单轨\pixel-record.exe` 运行 PID 与文件 SHA-256、日常版 `%APPDATA%\local.pixelrecord.app\config.json` SHA-256；该快照不代表全盘业务数据哈希） | **通过（快照覆盖范围内前后 100% 一致，测试 `autostart: false`）** | [run-registry-before.json](./run-registry-before.json)<br>[run-registry-after.json](./run-registry-after.json) |

### 真实界面视觉核验截图（1000×720）
1. [ui-01-automation-overview.png](./ui-01-automation-overview.png)：`09 AI 与自动化` 页眉、「接入概览」四类 15 项方法卡片与首次初始化/后台按需启动/边界说明。
2. [ui-02-automation-mcp-config.png](./ui-02-automation-mcp-config.png)：「MCP 配置」分区，展示非默认中文空格括号安装路径 `...\隔离安装 目录 (Beta 2)\monorail-mcp.mjs`、标准 JSON 配置片段、「已复制 MCP 配置 ✓」反馈及展开的可选 HTTP 次要说明。
3. [ui-03-automation-cli-examples.png](./ui-03-automation-cli-examples.png)：「CLI 命令」分区，展示 `monorail-cli.mjs` 真实路径与单引号安全转义的 PowerShell 命令示例及独立复制按钮。
4. [ui-04-automation-troubleshooting.png](./ui-04-automation-troubleshooting.png)：「前提与排错」分区，展示 Node.js 24+ 环境要求与 5 类错误码处置指引。
5. [ui-05-automation-missing-path-error.png](./ui-05-automation-missing-path-error.png)：入口文件缺失时显示红色错误提示框「无法生成 MCP 配置（不使用猜测路径）」并禁用复制按钮。
6. [ui-06-about-section-10.png](./ui-06-about-section-10.png)：顺延后的 `10 关于` 页面，显示 `当前构建：v0.3.0-beta.2（Beta 测试构建）`。
