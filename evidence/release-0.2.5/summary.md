# 0.2.5 发版准备

日期：2026-11-01。用户在最新隔离版启动后表示「OK，可以准备发版吧」。本轮完成本地发版准备，未提交、推送、打标签、安装或公开发布。

## 当前结论

P2/P2b/P2c/P2d/P2e 均已实现并审核。用户确认当前隔离手测可进入发版准备；该确认不扩写为架构 §8 全部 12 条历史冒烟已重演。两份独立只读发版核验未发现确证代码阻塞、依赖漂移或测试配置混入正式产品。

正式配置 Windows 调试程序已重新构建，ProductName「单轨」，ProductVersion/FileVersion 均为 0.2.5；没有隔离 identifier 或 verify feature。该 EXE 仅为构建证据，未启动，不是签名安装包。元数据与 SHA-256 见 [build-metadata.json](build-metadata.json)。正在运行的用户 P2e 隔离版未操作。

## 最终检查

| 检查 | 结果 | 证据 |
|---|---|---|
| 版本一致性 | npm、Cargo 及两锁文件均为 0.2.5；依赖不变 | [version.log](version.log) |
| 完整检查 | TypeScript、ESLint、66 文件 451 项单测通过，9.69s | [check.log](check.log) |
| 发版工具测试 | 7 项通过；沿用 CI 的实验 module mock 开关与 60s 单测限制 | [release-tools.json](release-tools.json) |
| 正式配置原生构建 | `VITE_VERIFY=false`，Rust 1.95.0 MSVC，`tauri build --debug --no-bundle` 通过 | [build.log](build.log) |
| Git diff 格式 | 退出 0；保留 CRLF 提示，无格式错误 | 本轮 Git 输出 |
| 远端及权限 | master 与本地 HEAD 同为 `5a393bf5df80975feecccb02316559a2e992d1df`；latest 为 v0.2.4；无远端 v0.2.5；gh 有 push 权限 | [preflight.json](preflight.json) |
| 工作流 | 本轮无更改，签名使用仓库 Secrets；正式构建设置 VITE_VERIFY=false | `.github/workflows/release.yml` |

未重新安装依赖，未修改全局 Rust 配置。本轮发版工具测试中的示例 Published 输出来自模块 mock，仅为测试，不代表实际 GitHub 发布。

已完成的专项回归与实际证据：

- [P2/P2b 代码审核](../0.2.5-away-drawer-code-review.md)：底层活动投影、抽屉编辑、pending/away 与普通改名后的动作次序。
- [P2c 审核](../0.2.5-p2c-review.md)：日历和底栏简化、红色停止图标。
- [P2d 最终审核](../0.2.5-p2d-review.md)：24 次真实原生 IPC 对照、每次必读盘的解析缓存及 Journal 校验。18/180 合成实体的热轮次中位耗时 347.9→207.2ms / 1942.4→767.8ms，不等同于用户端到端帧延迟。
- [P2e 验证](../0.2.5-p2e-review.md)：8 个真实 Chrome 场景；临时活动期间底部灰化禁用、准确提示、点击/聚焦阻止与回来后的恢复。此最新要求取代 P2b 历史审核里允许底部按钮可用的约定。
- 最新隔离版已按用户要求重建并启动，连接原隔离测试数据，见 [启动元数据](../0.2.5-p2e-isolated-startup.json)。

## 发布内容与文件边界

用户可见说明已整理在 [docs/releases/0.2.5.md](../../docs/releases/0.2.5.md)。当前版本计划 v1.25，ADR 0006 v1.3、ADR 0007 v1.2。

拟纳入源码/版本/回归、本版计划与证据的明确文件清单见 [待提交清单](candidate-manifest.json)。清单包含各文件 SHA-256，供后续提交前确认其间没有新改动；它不是已经提交或签名的发布资产。

排除并保留既有改动：`CLAUDE.md`、`docs/版本开发流程.md`、`evidence/journal-real.json`、旧 0.2.3/0.2.4 发布资产。没有暂存它们，也不回退。新增生产源码 `ActivityActions.tsx`、`AwayDrawer.tsx`、`activityActions.css` 和新增测试必须与其他本版源码一起纳入，不能只提交已 tracked 文件。

上级产品/UI/原型说明及原型、参考图在 `app/` Git 仓库之外；当前引用仍以这些原文为准，位置和内容哈希记录于 [外部规格清单](external-specs.json)。迁移工作树或机器时需携带原文，清单本身不能恢复文件。

建议准备提交：`feat(0.2.5): 完成临时活动抽屉与快捷活动优化`。包含默认外观和 mini 文案、预设 flat、临时活动抽屉、快捷活动性能优化及底部禁用、对应测试与本版证据。

## 后续正式发布步骤与未测项

1. 按 candidate-manifest 核对后只提交本版文件，保留其他工作区改动。
2. 按既有流程先推 master，再创建并推送 v0.2.5 标签；推标签将触发公开发布，当前未执行。
3. CI 校验后通过 GitHub Secrets 构建签名 NSIS，生成 installer、sig 和 latest.json；核对源码 SHA、版本、说明、签名及下载资产哈希。
4. 记录实际 Release 与升级结果。当前未产生 0.2.5 签名安装包，未验签、安装或测试 0.2.4→0.2.5 应用内更新。

本地当前进程没有 TAURI_SIGNING 环境变量，因此没有尝试本地签名；不搜索或读取仓库外私钥。正式签名沿用 CI。发布脚本没有 dry-run：执行即会创建草稿、上传并公开，不能将其作为本轮只读预检命令。

schemaVersion 仍为 2，迁移实现未变。本轮没有重演全部历史 Windows 冒烟；小窗/记录条/休眠/自启等未受本版直接修改的桌面场景不新增“通过”结论。未测项保持明确记录，不用用户一句 OK 代替详细验收。
