# 0.3.0 稳定版发布完成

日期：2026-11-05（北京时间）。用户授权：看过未测项清单后选「1」（直接发）。

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.0
- 源码提交：`23d62408b10380070182a454e0cfee2174db9e91`（`docs(f8)`，master 最新提交）；annotated tag `v0.3.0`（标签对象 `b1e39c11…`）已核对目标提交。发版工作流与 `v0.3.0-beta.3` 时相同，没改过。
- CI：https://github.com/kai-wei-kfuse/monorail/actions/runs/41987076239 ，版本检查、测试、发版工具测试、类型 / lint、Windows 生产配置签名 NSIS 构建和发布都通过。
- Release ID：`434898753`，标题「单轨 v0.3.0」，非草稿，`prerelease=false`，GitHub `releases/latest` 已是 `v0.3.0`（之前是 `v0.2.5`）。
- 安装包：`monorail_0.3.0_windows-x86_64_setup.exe`，9,370,625 字节，SHA-256 `d66aac1ced99219dfa30e9dbe1b8840da6d1e468bb794254e47aa3016f929c47`。

## 发布与验证

发版前 `version:check` 与 `npm run check`（619 应用、12 MCP、8 CLI）通过，正式身份 debug 构建通过；beta.4 的 45 项 Rust 测试和隔离真窗口实测见 [beta.4 证据汇总](../0.3.0-beta.4-summary.md)。

发布后下载 3 个公开资产和 CI 签名 artifact：公开资产的大小和 SHA-256 与 GitHub digest 一致，安装器和 `.sig` 与 CI 产物一致。`latest.json` 的版本、说明（与 `docs/releases/0.3.0.md` 一致，Release 正文也一致）、资产 API 地址、签名和兼容元数据（`channel: stable`、`dataSchemaVersion: 2`、`readableDataSchemaVersions: [2]`）都和实际资产相符（`verify-publication.mjs`、`verification.json`）。

用产品配置的生产公钥验过安装器签名和 trusted comment；在内存里改一个字节后验签被拒绝（`signature-verification.log`）。没有运行安装器。

用已发布标签里原样的 Rust 选择 / 兼容函数和真实 GitHub 分页 Release 列表独立验证（`verify-channel-selection.mjs`、`channel-selection.log`）：

- 稳定渠道、Beta 渠道、Beta 渠道「安装稳定版」都选到 `v0.3.0`；
- 本版清单兼容 schema 2，来源是清单本身；
- 从 0.2.5（稳定渠道）和 0.3.0-beta.3（Beta 渠道、稳定渠道、回到稳定版）升级到 0.3.0 都会被接受，0.3.0 不会再提示更新到自己。

这一项不等于在日常应用里实际执行了安装。

0.2.5 的更新路径（源码判断，未实测）：0.2.5 读 GitHub `releases/latest` 的 `latest.json`，交给 `tauri-plugin-updater` 2.14.0（`git show v0.2.5:src-tauri/Cargo.lock`）。这个版本的清单结构没有 `deny_unknown_fields`，多出的 `monorail` 字段会被忽略。

## 未测

用户知道下面这些没测，决定带着发：

- Windows 冒烟（`../架构设计.md` §8）12 条都没在打包程序上跑。第 6 条只在隔离 debug exe 里测了关掉再打开小窗。
- 0.2.5 经应用内更新到 0.3.0，以及 0.3.0-beta.* 应用内更新到本版：未测。
- beta.4：弹层展开时拖动小窗、多显示器和非 100% 缩放、输入法、重启后小窗位置恢复、真实 MCP 客户端调用 `complete_idea`、隔离 v0.2.5 读已完成的想法。
- beta.3 遗留：系统来源（活动日切换、休眠恢复）、真实 AI 客户端的调用方原始名字、v0.2.5 兼容矩阵 6、D5 小窗切角真窗口放大、D7 回看真窗口与 `recap-view.json`、D3 弹窗输入法、真机性能、「最近一年」回看 61–64 ms 未达 50 ms 目标。

## 留存与边界

- `verification.json`、`ci-result.json`、`release-metadata.json`、`latest-release.json`：结构化证据。
- `publication-check.log`、`signature-verification.log`、`channel-selection.log`、`channel-check-run.log`：检查输出。
- `verify-publication.mjs`、`verify-channel-selection.mjs`：只读复验脚本，由 beta.3 版本改换标签、版本、提交，以及稳定版的断言（非预发布、latest、`channel: stable`、渠道选择）。
- 下载的安装器与签名 artifact（`published/`、`ci-artifacts/`）、完整 Release 列表快照 `channel-release-list.json` 和 CI 监视日志 `ci-watch.log` 只留在本地，不提交（与 beta.2、beta.3 一致）。`evidence/journal-real.json` 和早期版本遗留的未跟踪文件保持原状。
- 没有覆盖用户日常安装版。日常版在「设置 → 关于」检查更新并安装，需要用户自己操作；更换版本后要重启 AI 客户端；MCP / CLI 需要本机 Node.js 24+。
