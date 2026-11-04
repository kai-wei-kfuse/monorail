# beta.2 主审第一轮

日期：2026-11-04。审核人：coder。

结论：实现范围与 ADR 0017 一致，未发现共享接口、事务或更新行为的回退。两项问题待修正与复核，当前不标记最终验收通过，不发布、不覆盖日常安装版。

## 待处理事项

### R1：真实剪贴板验收未成立（P2）

首轮 `verify-beta2-guide.mjs` 的 clipboard hook 捕获传入文本，并吞掉原 `navigator.clipboard.writeText` 的异常。因此后续真实 MCP/CLI 调用证明生成文本可用，但不能证明系统剪贴板写入成功；截图中的复制成功提示也不能补足此证据。

要求：移除吞错和伪成功，实际读取系统剪贴板比对；失败明确报告。保留首轮证据的适用边界，报告不得将 hook 捕获等同真实复制。

### R2：开发环境的恢复指引无法完成恢复（P2）

`AutomationGuide.tsx` 两处路径缺失提示称执行 `npm run mcp:build` 后点击重新检测即可恢复。但 `write_host_metadata` 在启动时可能已登记空 entry，而 `read_mcp_host` 只复读该元信息，不重新解析资源路径。构建后仍会读取空 entry。

要求：文案指引构建后重启开发应用以刷新登记，再检测；安装版区分完全退出重启与隐藏主窗口。维持读取命令只读，不增加第二套路径推断。

### R3：验收脚本清理与结论范围

Run 项清理应限定本次确认的名称和目标绝对路径，并保护测试前已存在的同名项，不能用宽泛路径子串匹配删除。测试前后快照只证明其中覆盖的 Run 项、日常进程 PID、exe/config 哈希不变，不能表述成日常全部数据及系统状态均未变化。

已把 R1–R3 通过 Runner 定向发给 coder-3；测试脚本、报告与两处恢复文案由其修正。

## 主代理独立验证

- 设置页定向测试：6 项通过（整个测试进程设置 60 秒上限）。
- `npm run check`：69 文件、482 项应用测试、12 项 MCP、6 项 CLI 通过，含类型检查、lint 和 MCP 构建。日志：`main-review-check.log`。
- `cargo test`：40 项通过（进程设置 60 秒上限），日志：`main-review-cargo-test.log`。
- `npm run version:check`：`0.3.0-beta.2` 一致。
- `git diff --check`：通过。
- 逐张查看 6 张真实窗口截图：导航、长路径换行、MCP/CLI 展示、错误状态与关于页均可读，无明显遮挡。
- 复核 coder-3 已有正式配置构建成功日志；本轮未重复构建、安装或执行端到端测试。

## 交付边界

工作区包含此前他人/本地修改，本轮未暂存、提交、回退或发布。完整实现与首次隔离安装版调用证据见 `report.md` 和 `verification-result.json`；真实剪贴板部分以补测为准。

建议提交信息（修正完成并复核后）：`feat(settings): add beta.2 AI automation guide with runtime MCP/CLI config`。
