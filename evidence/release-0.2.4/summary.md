# 0.2.4 整体审核与发布记录

日期：2026-10-31。审核基线为 `ad914d0ccd0c6cc6d384b628b0b2db17a5ca137e`（0.2.3），范围为本次 0.2.4 产品代码、测试、版本文件及相关规格的全部改动。先完成准备提交 `f6bcc0a9e08a8a45aa2ec8c2e2dce455a5b0a746`，随后按用户「好，发版吧」的明确授权公开发布；未安装或替换用户日常程序。

## 审核结论

主审与两份独立只读复核均未发现阻断发布的已确认代码问题。覆盖：

- 回顾进入、重进、完成不改变当前条目、卡、暂停、休息、回到目标和待确认；旧 `timer_entry_id` 只读兼容，明确冷藏/放弃任务仍按原规则停止相关计时。
- 背包直接启动复用 `homeService.startCard`，保留原待确认起点与卡状态对齐，不复制事务；菜单测量实际高度和裁切容器边界，清理滚动、缩放及外部点击监听。
- 当前计时、卡片、小窗、背包和列表复用 `shared/duration` 进位显示；`mmss` 与兼容 `hms` 的整秒往返一致。列表编辑使用显示对应的两段/三段解析，全局其他时长表单规则不变。
- 自由记录保留 `useEntry`、项目/标签快捷解析及焦点组，TaskCard 进入编辑保留适配字号；列表 flat 样式与紧凑布局不改写入权限。
- npm/Cargo 及两份锁文件仅同步版本，不更新依赖；不改变 schemaVersion 2、迁移、原生命令、更新签名或安装协议。

开发过程中已发现并修复的菜单裁切、显示/解析不一致、长标题编辑字号重置与测试隔离问题均已复核。此前各轮记录是历史过程，本记录对应最终源码。

## 最终检查

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm run check` | TypeScript、ESLint、62 文件 424 项测试全部通过；测试进程沿用 60 秒期限 | `check.log` |
| `npm run version:check` | 0.2.4 一致 | `version.log` |
| 发版工具测试 | 按 CI 的 `--experimental-test-module-mocks --test --test-timeout=60000` 命令运行，7 项通过 | `release-tools.log` |
| 正式配置构建 | `VITE_VERIFY=false npm run tauri -- build --debug --no-bundle` 通过；未传隔离配置或 verify feature | `build.log` |
| Windows PE 元数据 | ProductName 为「单轨」，ProductVersion/FileVersion 均为 0.2.4 | `build-metadata.json` |
| 改动格式与提交范围 | 相关 diff 检查通过；只纳入本版源码、测试、版本与准备文档 | 本地 Git 提交及 `git show --stat HEAD` |
| 远端准备检查 | 本地 master 与远端 master 基线相同；检查时无 v0.2.4 标签；GitHub CLI 登录有效，工作流本轮未改 | 本轮命令输出 |

首次本机调用发版工具测试遗漏了实验模块 mock 开关，出现 `t.mock.module` 不存在；采用既有 CI 命令重跑后 7 项通过。没有为通过检查修改发版工具或增加降级逻辑。

## 用户手测与边界

用户在本轮明确表示「我已经测试过了」。将此作为本版改动的用户手测完成确认；此前隔离 Windows 版本由用户亲自操作，代理只构建、启动并确认独立窗口和数据连接。本轮没有再次操作真实任务，也没有将模拟 DOM 单测描述成浏览器渲染验收。

未在本轮重演架构文档的全部 12 条历史冒烟，也未验证尚未发布的 0.2.4 签名安装包或正式应用内升级；这些不列为已通过。没有新增产品超时、长度上限、静默回退或隐藏降级。

## 规格与提交边界

- 当前计划更新至 v1.11，用户修改说明见 `docs/releases/0.2.4.md`；回顾解耦见 ADR 0004，背包入口与读数契约见 ADR 0005。
- 同步仓库外的 `../架构设计.md`、`../像素记录系统 设计文档 v0.3.md`、`../UI风格规范.md`，消除「首页唯一入口」及旧读数、布局示例冲突；改动归档为零上下文补丁 `spec-sync.patch`。这些原文不在 app Git 仓库中，换机器需带上补丁，在包含这三份文档的目录使用 `git apply --unidiff-zero`。
- 原有 `CLAUDE.md`、`evidence/journal-real.json`、`docs/版本开发流程.md` 和 0.2.3 发布证据不暂存、不回退。真实数据及隔离数据副本不纳入提交。
- 建议/本次本地提交标题：`feat(0.2.4): 完成背包直启与计时交互优化`。

## 本次发布结果

- 标签 `v0.2.4` 保持指向审核提交 `f6bcc0a9e08a8a45aa2ec8c2e2dce455a5b0a746`；先推 master，再推标签，没有覆盖或删除标签。
- [签名 CI 41193987242](https://github.com/kai-wei-kfuse/monorail/actions/runs/41193987242) 成功；源码 SHA 与标签一致，见 `ci-result.json`。
- [公开 Release](https://github.com/kai-wei-kfuse/monorail/releases/tag/v0.2.4) 已于 `2026-10-31T10:50:30Z` 发布，是最新正式版本，非 draft、非 prerelease。
- 三份资产完整：`monorail_0.2.4_windows-x86_64_setup.exe`、同名 `.sig`、`latest.json`。安装包 8,936,392 字节，SHA-256 为 `4bdd3efc43a3be4ce7e3c4dce23f5083acdd0512e7ff9749d257dd71791bb522`。
- 从公开 Release 下载的三份文件哈希均匹配 GitHub digest；安装包和签名与 CI `v0.2.4-signed-nsis` artifact 一致。更新清单版本为 0.2.4，说明匹配仓库发版说明，下载 API 指向本次安装包，清单签名匹配 `.sig`。见 `verification.json`。
- 使用应用配置中的公钥及 `minisign_verify` 验证安装包与可信注释成功，并验证修改首字节后的副本被拒绝。见 `signature-verification.log`；仅在内存修改副本，未修改下载产物。
- 原始下载留在本地 `published/` 与 `ci-artifacts/`，不将安装包重复提交到源码仓库。未在本次发布中执行本机安装或应用内更新，结果不写成已验收。
