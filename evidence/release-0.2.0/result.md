# 单轨 0.2.0 发布结果

2026-10-28 20:49:14（北京时间）发布成功。

- Release：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.2.0
- 状态：非草稿、非预发布；GitHub 最新正式 Release 为 v0.2.0。
- 原有标签保持不变：`v0.2.0` 标签对象 `ab47a2a33998ec408cb18fe3c73f455adfac4c85`，源码提交 `fa591f75ddefe1ca60d3c9a91dc5e094050ecf82`（包含 `d308438`）。
- 成功 CI：`40688264661`，工作流提交 `0bbdc2a4a3e476f752412997076ffcd090ddec81`，checkout 日志确认构建原标签源码。见 `ci-success.json`、`ci-source-and-build.log`。
- CI 完成 389 项测试、TypeScript、ESLint、生产构建、签名 NSIS 和产物保存。本次显式选择 `publish=false`；因 GitHub 工作流权限限制，用本机已授权 gh 登录运行既有 `release:publish` 脚本完成发布，见 `ci-recovery.md` 和 `publish.log`。

## 发布资产与核验

| 资产 | 字节数 | SHA256 |
|---|---:|---|
| `monorail_0.2.0_windows-x86_64_setup.exe` | 8929344 | `b88291ed2b9dddb1282f68c2572536f8d2738d5252e37e4a41f83e5a9dc6111d` |
| `monorail_0.2.0_windows-x86_64_setup.exe.sig` | 436 | `3a31ebd2d295ffb8b62d5f92d3923d01cbe71572cb8f1c0a0087663b2d947152` |
| `latest.json` | 2799 | `a838c614815a882766af0b07c8da0e3e1fb523bf9afd42bfe1ce93e6e9c2342a` |

- 下载发布后的三项资产，逐项比对 GitHub API 的字节数和 SHA256；安装包 SHA256 另与 CI 原始产物一致。
- 清单版本为 0.2.0，下载地址指向该 Release 安装包的认证 API URL，内嵌签名与 `.sig` 完全一致；清单和 Release 正文与发版说明一致。
- 使用应用配置公钥及应用已有 `minisign-verify 0.3.0` 依赖验证 CI 和发布后安装包的签名、可信注释；均通过。内存中改动一个字节的安装包被拒绝。没有执行安装包。
- 核验实现及结果：`verify-assets.mjs`、`verify-signature.rs`、`verification.json`、`signature-verification.log`、`published-signature-verification.log`。API 快照见 `release-api.json`；artifact 元数据见 `ci-artifacts.json`。

## 文档与工作区

- 核对并修正两份 0.2.0 说明中的迁移触发条件、备份目录名及排除范围、迁移记录位置、待确认起点持久化、回切 v2 时保留 v1 新数据。
- `.github/workflows/release.yml` 明确测试夹具时区，保存签名产物，并支持显式手动发布；恢复流程同步到 `docs/updates.md`。
- 只暂存本次文件。`evidence/journal-real.json` 曾被现有测试自动覆盖，随后用发版前 SHA256 匹配恢复到原始内容，没有暂存或提交。过程见 `preflight.md`。
- 本次未安装程序、未写入 `F:\单轨` 或归档目录。
- 建议提交说明：`chore(release): 记录 0.2.0 发布与签名核验结果`。

## 用户后续验收

- 本机正式安装版本仍是 0.1.3。交接文档 19:54 更新及只读检查均表明 `F:\单轨` 已为空，旧 v2 数据位于 `F:\单轨-旧-20261028`；因此“当前目录已是 v2，旧版启动报错”的旧提醒已过时。如果让 0.1.3 指向归档中的 v2 数据，它仍会启动报错，可能无法进入关于页；此时应手动安装 0.2.0。
- 冒烟第 9 条若用历史 v1 备份，应复制 `F:\单轨-旧-20261028\backup\v1-…` 到另一个目录，跳过 `迁移记录.md` 并按需复制附件，让旧版指向副本再升级。不要让旧版直接打开归档中的 v2 目录。也可先用 0.1.3 在当前空的 `F:\单轨` 里记几条再应用内更新。
- 12 条 Windows 冒烟、真实窗口里的读数确认提示（主窗口、融合大卡、小窗）、实际安装旧版的回退演练仍未测，详见 `evidence/n7-summary.md`。本次自动检查与签名核验不代替这些手动验收。
