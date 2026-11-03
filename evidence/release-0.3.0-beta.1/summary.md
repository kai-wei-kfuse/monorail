# 0.3.0-beta.1 发布完成

日期：2026-11-04（北京时间）。用户明确授权「那就发版吧」。

- 发布：https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.3.0-beta.1
- 源码提交：`9313970940c7f1d938b6edc0cdab823f7ac9e088`；标签为 annotated tag，已解析核对其目标提交。
- CI：https://github.com/kai-wei-kfuse/monorail/actions/runs/41683642751 ，测试、类型/lint、生产配置签名 NSIS 构建和发布均成功。
- Release ID：`433012898`；非草稿，`prerelease=true`；稳定 latest 仍为 `v0.2.5`。
- 公开安装器：`monorail_0.3.0-beta.1_windows-x86_64_setup.exe`，9,323,783 字节，SHA-256 `f539ad12f702c11622285238418b6595402ad5e8118c05155ff5fadb18c8ead9`。

## 发布后独立验证

重新下载全部公开资产和 CI 签名 artifact，安装器与 `.sig` 逐字节摘要一致；每个公开资产的大小及 SHA-256 与 GitHub digest 一致。`latest.json` 的版本、说明、资产 API URL、签名及 `monorail` Beta/schema2 元数据均与实际发布匹配。

使用产品配置中的生产公钥和 minisign_verify 验证安装器及 trusted comment；验签成功，内存中改动一个字节后拒绝。全程未运行安装器。

从实际 GitHub 分页 Release 列表取得数据，以发布标签中的原始 Rust 纯选择/兼容函数编译独立验证程序：stable 选择 `v0.2.5`，beta 选择 `v0.3.0-beta.1`；对 0.2.5 而言只允许 Beta 渠道升级到本版；已发布清单判定兼容。此项验证生产选择逻辑与真实远端数据，不等同于在用户日常应用中点击更新。

本地验证工具首次直接链接任意缓存 rlib 时混用了 serde 编译特征而失败；改由 Cargo 解析一致依赖图后通过。未修改发布标签、生产代码或发布包。

## 留存与边界

- `verification.json`、`ci-result.json`、`release-metadata.json`、`latest-release.json`：结构化发布证据。
- `signature-verification.log`、`channel-selection.log`：生产签名及实际渠道选择结论。
- `verify-publication.mjs`、`verify-channel-selection.mjs`：只读复验脚本；原始大安装包和 CI 下载资产仅保留本地，不纳入源码提交。
- 本轮保留 `CLAUDE.md`、`evidence/journal-real.json` 与他人版本流程文档的本地状态，未纳入发布提交。未安装/切换用户日常版。
- CI 提示旧版 Actions 使用 Node20 的弃用公告，实际由 GitHub 强制在 Node24 上运行，未影响构建；后续维护可升级 Actions 主版本。

旧版无 Beta 入口时，退出单轨后从本 Release 下载安装器覆盖原路径，不先卸载或清理数据；原数据继续使用，安装后可在「设置→关于」选择加入 Beta。建议额外复制数据目录作手动备份。当前版本仍需本机 gh 登录获取更新；MCP/CLI 需 Node.js24。

提交：`feat(0.3.0-beta.1): ship shared API, MCP, CLI and beta channel`；发布证据提交建议 `docs(release): record 0.3.0-beta.1 publication verification`。
