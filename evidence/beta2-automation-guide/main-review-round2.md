# beta.2 主审复核

日期：2026-11-04。审核人：coder。

结论：R1–R3 已关闭，beta.2 开发审核通过，待用户验收。未执行提交、公开发布或日常版覆盖安装。

## 修正与证据

- **R1 通过**：核对新版 `verify-beta2-guide.mjs`，已删除 clipboard hook。8 个按钮逐次写入 sentinel、触发真实页面复制并用 Windows `Get-Clipboard -Raw` 读回；读回的 MCP 配置及 6 条 CLI 命令用于后续真实调用。新版 `verification-result.json` 记录 8 项剪贴板验证、MCP 保存 ID `aceb745e-5127-4e04-920f-a550852f68b0` 与 CLI 结果。已独立核对 MCP 记录正文、全部列出的记录/receipt/timelog 文件存在性，并复看新版 MCP/CLI 截图。首次 hook 验收的局限保留在 `main-review-round1.md`，本次补测取代其剪贴板结论。
- **R2 通过**：主代理修改 `src/pages/settings/AutomationGuide.tsx` 两处缺失入口提示：安装版从托盘完全退出后重启，开发环境构建后重启应用刷新登记，再检测；明确关闭主窗口只是隐藏。未改变只读命令、路径来源或运行行为。
- **R3 通过**：Run 项清理只在原快照不存在同名项、名称匹配且键值等于隔离 exe 绝对路径（或该路径加双引号）时执行。独立 JSON 比对证明 before/after 快照相等。报告将不变范围限定为 Run 项、日常版 PID、exe/config 哈希，不再声称证明全盘业务数据不变。

## 验证范围

首轮主代理独立通过 482 项应用、12 项 MCP、6 项 CLI、40 项 Rust 测试、版本一致性及 diff 检查。日志：`main-review-check.log`、`main-review-cargo-test.log`。

最终两处文案改动后重新通过：

- 设置页 6 项定向测试，测试进程 60 秒上限。
- `npx tsc --noEmit`、受影响文件 eslint。
- `npm run tauri -- build --debug --no-bundle`，日志 `main-review-build.log`。
- `node --check evidence/beta2-automation-guide/verify-beta2-guide.mjs`、CLI 本地 `--help --json` 冒烟、`git diff --check`。

隔离安装版的系统剪贴板、真实 MCP/CLI、缺失路径和隔离清理由 coder-3 重跑，主代理核对脚本、结果与落盘证据，未重复执行安装。六张窗口截图在文案最后修正前生成；最后改动仅涉及两处恢复说明，已完成最终源码检查与构建，未另重拍该说明。

## 交付

设置增加「09 AI 与自动化」，关于顺延为 10；提供已有能力说明、真实运行时路径、可复制 MCP/PowerShell 配置及排错指引。工作区仍有他人/本地修改，未暂存或回退它们。

建议提交：`feat(settings): add beta.2 AI automation guide with runtime MCP/CLI config`。
