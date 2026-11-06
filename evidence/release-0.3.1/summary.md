# 0.3.1 正式发布完成

日期：2026-11-06（北京时间）。用户明确选择直接正式版、推 master 与 v0.3.1 标签，经 coder-3 完整交接，由 coder 收尾并发布。

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.1
- 源码提交：`9db62a79f88fbf8c861f2dae0dcdefe31dea4791`，annotated tag `v0.3.1`（标签对象 `fc45c40d5249d38314df48d2041386b82cafc177`）。先推 master，再推标签；工作流与默认分支一致。
- CI：https://github.com/kai-wei-kfuse/monorail/actions/runs/42193664969 ，全部成功，含生产配置签名 NSIS 构建与发布；已核对运行的 workflow 路径、push 事件、head_branch=v0.3.1、提交以及签名构建步骤成功。
- Release ID：`436308252`；非草稿，`prerelease=false`；GitHub releases/latest 已是 v0.3.1。
- 安装包：`monorail_0.3.1_windows-x86_64_setup.exe`，9,390,081 字节；SHA-256 `8e0be7ec07b57cfd5e2a586fa88c3b3282be3502141095d16d0c8f0d8a8e3bef`。

## 本地与原生验证

收尾详细见 [0.3.1 汇总](../0.3.1-summary.md)：737 应用、45 Rust、12 MCP、8 CLI、10 发版工具测试通过；Windows 生产前端、正式身份 debug（只构建）、隔离 debug 构建通过。补了标题栏暂停累计显示与回归、0.3.0/0.2.5 有限原生读写往返、主/分开布局/小窗同步、改名整件事同步、960×600 抽屉、跨日启动逐项带过来及同天重启幂等。

README/截图/GIF 按当前代码重拍；当前计划 v0.38 / 执行方案 v1.5 同步完成状态。发布不表示汇总中列出的未测项已经实测。

## 公开资产与签名复验

`verify-publication.mjs 42193664969` 实际执行通过：

- GitHub tag peeled SHA 与上述源码提交一致；CI 成功且来自指定 release.yml/push 标签及 release job。
- Release 精确有 exe、exe.sig、latest.json；下载文件大小和 SHA-256 与 GitHub digest 一致；安装器和签名与该 CI signed-nsis artifact 哈希一致。
- latest.json 的版本、notes（取标签内发行说明）、平台资产 API 地址、签名、stable/schema2 兼容元数据一致；Release 正文也与标签内说明一致。
- 使用标签内生产公钥校验下载的安装包签名和 trusted comment，通过；内存篡改一字节后被拒绝。未执行安装器。

证据：`verification.json`、`ci-result.json`、`release-metadata.json`、`latest-release.json`、`publication-check.log`、`signature-verification.log`。

## 更新渠道复验

`verify-channel-selection.mjs` 从 v0.3.1 取原样生产 Rust 选择/兼容函数，并用真实 GitHub 分页 Release 列表和本版公开清单执行，通过：

- stable、beta、return-to-stable 均选 v0.3.1；
- schema2 兼容来源为 manifest；
- 从0.2.5、0.3.0、0.3.0-beta.3升级的相应判断被接受；0.3.1 不向自己提供同版本更新。

证据：`channel-selection.log`、`channel-check-run.log`。这不等于在日常应用内执行更新安装；日常版没有被停止、覆盖或重启。

## 留存与未完成边界

- 未测矩阵完整保留在 [验证汇总](../0.3.1-summary.md#未实测与边界)：真实休眠/后台长时间/系统通知、运行中换日、全入口与IME/Tab矩阵、真实AI模型行为、完整安装往返等。
- 当前已发布源码不含验证入口（CI `VITE_VERIFY=false`），生产安装器已签名。重启 AI 客户端后再使用更新后的 MCP/CLI；Node.js 需要24+。
- 下载安装器/CI产物、完整 Release 列表快照、帧序列留本地，不提交；evidence/journal-real.json 与早期版本遗留文件保持原状。
- 原始隔离数据与 lifecycle 已恢复，隔离原生进程已停止。临时 worktree junction 清理未完成：Git清理025报Invalid argument；后续删除命令被自动审批以“blocked by policy”拒绝，未给具体原因，故保留030/031临时worktree与025残留目录，不再删除。主仓库依赖和用户日常安装/数据均未改变。

提交：源码 `fix(g9): finalize 0.3.1 validation and stable release`；后续发布记录提交 `docs(release): record 0.3.1 publication verification`。
