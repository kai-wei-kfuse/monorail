# 0.3.0-beta.2 发布完成

日期：2026-11-04（北京时间）。用户授权「可以发版了」。

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.0-beta.2
- 源码提交：`7cafb28a14437e625d35c8bc979faf142590cee9`；annotated tag `v0.3.0-beta.2` 已核对目标提交。
- CI：https://github.com/kai-wei-kfuse/monorail/actions/runs/41790109868 ，测试、类型/lint、Windows 生产配置签名 NSIS 构建和发布均通过。
- Release ID：`433611780`，非草稿，`prerelease=true`，稳定 latest 仍为 `v0.2.5`。
- 安装包：`monorail_0.3.0-beta.2_windows-x86_64_setup.exe`，9,335,109 字节，SHA-256 `8c0b4e99696115d22c0733ed9889f3a7ee6e1f6dfe1aba7cc5683f1399248c1a`。

## 发布与验证

发版前重新通过版本一致性、全量 `npm run check`（482 应用测试、12 MCP、6 CLI）及 10 项发版工具测试。开发审核中的 40 项 Rust 测试和最终桌面构建保持通过，见 `../beta2-automation-guide/main-review-round2.md`。

发布后下载全部 3 个公开资产及 CI 签名 artifact，核对公开资产大小和 SHA-256 与 GitHub digest 一致、安装器和 sig 与 CI 产物一致。`latest.json` 版本、说明、资产 API URL、签名和 Beta/schema2 兼容元数据均与实际资产相符。

使用产品配置的生产公钥验证安装器签名及 trusted comment，并验证内存中篡改一个字节后验签拒绝。未运行安装器。

以已发布标签的原始 Rust 选择/兼容函数和真实 GitHub 分页 Release 数据独立验证：stable 选择 `v0.2.5`，beta 选择 `v0.3.0-beta.2`，本版清单兼容 schema2，只有 Beta 渠道接受从 0.2.5 升级到本版。本项不等同于日常应用中执行安装。

## 留存与边界

- `verification.json`、`ci-result.json`、`release-metadata.json`、`latest-release.json`：结构化证据。
- `signature-verification.log`、`channel-selection.log`：签名及实际渠道选择结论。
- `verify-publication.mjs`、`verify-channel-selection.mjs`：只读复验脚本。
- 下载的安装器、签名 artifact、完整本机 Run 快照和隔离测试数据仅留本地，不纳入源码提交。保留 `CLAUDE.md`、`evidence/journal-real.json` 及他人/本地文档的原状态。
- CI 的 Actions Node20 弃用提示未影响结果；本轮不改变工作流。
- 未覆盖用户日常安装版。Beta 用户可通过应用内检查更新取得本版；MCP/CLI 仍需本机 Node.js 24+。

源码提交：`feat(0.3.0-beta.2): add AI automation settings guide`。发布证据提交：`docs(release): record 0.3.0-beta.2 publication verification`。
