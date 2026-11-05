# 0.3.0-beta.3 发布完成

日期：2026-11-05（北京时间）。用户授权「发版到beta版去测吧」。

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.0-beta.3
- 源码提交：`ccd733babb875af3904874807089daa605033538`；annotated tag `v0.3.0-beta.3`（标签对象 `8be805eb…`）已核对目标提交。
- CI：https://github.com/kai-wei-kfuse/monorail/actions/runs/41949480154 ，测试、类型/lint、Windows 生产配置签名 NSIS 构建和发布均通过。
- Release ID：`434670353`，非草稿，`prerelease=true`，稳定 latest 仍为 `v0.2.5`。
- 安装包：`monorail_0.3.0-beta.3_windows-x86_64_setup.exe`，9,372,116 字节，SHA-256 `c91010410d11f09d1bc833311defa880aa3f3bc6df2e5f0940f2c3fd8d29c265`。

## 发布与验证

发版前版本一致性检查与全量 `npm run check`（604 应用测试、12 MCP、8 CLI）通过；E9 的 44 项 Rust 测试通过。隔离真窗口实测与 v0.2.5 兼容矩阵 1–5 见 `../beta3-isolated/README.md`。

发布后下载全部 3 个公开资产及 CI 签名 artifact，核对公开资产大小和 SHA-256 与 GitHub digest 一致、安装器和 sig 与 CI 产物一致。`latest.json` 版本、说明、资产 API URL、签名和 Beta/schema2 兼容元数据与实际资产相符。

使用产品配置的生产公钥验证安装器签名及 trusted comment，并验证内存中篡改一个字节后验签拒绝。未运行安装器。

以已发布标签的原始 Rust 选择/兼容函数和真实 GitHub 分页 Release 数据独立验证：stable 选择 `v0.2.5`，beta 选择 `v0.3.0-beta.3`，本版清单兼容 schema2；从 0.2.5 和 0.3.0-beta.2 升级到本版只在 Beta 渠道被接受。本项不等同于日常应用中执行安装。

## 未测

- 用户决定这次不测：系统来源（活动日切换、休眠恢复）、真实 AI 客户端（调用方识别只用模拟的客户端名字测过）、v0.2.5 兼容矩阵 6（需另建 beta.2）。
- 另外未测：D5 真窗口放大截图、D7 回看真窗口与 `recap-view.json`、D3 输入法组合输入、Windows 冒烟、真机性能（Tauri 文件 IPC 下的回看一年聚合与 180 天历史）。
- 应用内检查更新并实际安装本版：未测。

## 留存与边界

- `verification.json`、`ci-result.json`、`release-metadata.json`、`latest-release.json`：结构化证据。
- `publication-check.log`、`signature-verification.log`、`channel-selection.log`、`channel-check-run.log`：检查输出。
- `verify-publication.mjs`、`verify-channel-selection.mjs`：只读复验脚本，由 beta.2 版本改换标签、版本和提交（`verify-publication.mjs` 内残留的 `beta2-signature-check` 只是临时目录名）。
- 下载的安装器与签名 artifact（`published/`、`ci-artifacts/`）、完整 Release 列表快照 `channel-release-list.json` 和 CI 运行监视日志 `ci-watch.log` 仅留本地，不纳入源码提交（与 beta.2 一致）。`evidence/journal-real.json` 及早期版本遗留的未跟踪文件保持原状态。
- 未覆盖用户日常安装版。Beta 用户可通过应用内检查更新取得本版；更换版本后需重启 AI 客户端；MCP/CLI 仍需本机 Node.js 24+。

源码提交：`docs(e9): isolated real-window run and v0.2.5 compatibility matrix for 0.3.0-beta.3`（`ccd733b`）。发布证据提交：`docs(release): record 0.3.0-beta.3 publication verification`。
