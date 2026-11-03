# 0.3.0 Beta 更新渠道执行方案

版本 v1 · 2026-11-03 · Accepted，执行人 coder-3（Agy CLI），主代理最终审核。

依据：用户本轮要求、ADR 0016、`docs/stages/changes/0.3.0-beta-channel-proposal.md`。此前统一接口/MCP/CLI及M9不得回退。产品目标仍是0.3.0，首个可发布Beta产物建议0.3.0-beta.1；版本同步在构建阶段执行，不能仅改前端版本字符串。

## 1. 用户流程与验收承诺

### 1.1 检查更新旁的入口

在现有「设置→关于→检查更新」区域增加当前渠道与「加入 Beta 体验」。点击后显示一次确认：会接收测试版本、可能存在问题、安装保留当前数据且会先备份，可随时退出。确认只改变渠道并检查候选，不自动下载/安装。

已加入显示「已加入 Beta 体验 / 退出 Beta」。退出后立刻改为稳定渠道，并提供：

- 留在当前版本，等待后续稳定更新。
- 「安装稳定版」：展示明确目标版本与是否属于回退、兼容结论、备份说明，再由用户确认下载/验签/安装；不把退出渠道和自动安装绑在一起。

「申请加入」按本地选择实现，无账号申请、服务器审核、邮件或用户信息提交。当前构建为beta与当前跟踪stable可以并存，界面不能把两者混淆。更新繁忙期间切换入口禁用并说明当前操作，原生命令也须拒绝。

### 1.2 没有入口的旧版本

帮助说明明确：到项目GitHub Releases下载带该入口的官方安装包，退出当前应用后直接覆盖原安装，不先卸载，不选清理数据。安装后原数据目录、设置和授权继续可用，再由用户选择加入Beta。手动安装Beta包也不自动改变持久化渠道同意。

### 1.3 保留数据与回稳定版

本轮0.3 Beta保持schema2和现有格式，目标是Beta期间新增想法/待办/计时/附件在已核验的稳定版中仍可读取。安装器不接触用户业务目录；应用内安装前备份，绝不自动把整套数据还原到加入Beta前。

只能对已声明兼容且实测过的目标提供「保数据安装稳定版」。当前优先核验v0.2.5；若不兼容需修兼容实现或明确阻断该目标，不能无依据承诺，不能默默删除新数据。未来跨schema逆迁移不在本轮。

## 2. 现状与根因（结构调整）

现有`private_release.rs`只读GitHub正式latest或固定update-test标签；UI/Rust更新流程是唯一原生状态机，安装已具备主提交队列、快速记录/外部写入、草稿和生命周期收尾。发布脚本的`--prerelease`目前生成update-test标签而非产品Beta。NSIS允许降级不代表updater默认会下载较低版本，二者要分别验收。

采用既有状态机扩展渠道/意图/候选，不新增平行React更新状态或第二套安装器/下载器；候选选择、兼容判断、签名安装各有单一职责。不要用全局allow_downgrades或`version_comparator=always true`快速绕过。

## 3. 责任与涉及文件

coder-3负责实现及证据：

- 原生：`src-tauri/src/private_release.rs`、`update_state.rs`、`updates.rs`，必要时拆出短小`update_channel.rs`/`update_backup.rs`；`lib.rs`注册与command permissions/capabilities。
- 契约与接线：`src/shared/updates.ts`、`src/platform/updater.ts`、`src/services/updateController.ts`/`updateService.ts`、`src/app/useUpdates.ts`/`SettingsScreen.tsx`。
- UI：`src/widgets/UpdatePanel.tsx`及所属样式，沿用现有按钮/确认组件。不要另改设置页分类或顺带实现“AI与自动化”栏目。
- 分发：`scripts/publish-release.mjs`及测试、`.github/workflows/release.yml`、必要的隔离安装配置/验收脚本、`docs/updates.md`与发布说明。
- 测试：相关Rust/TS/update状态单测，签名与安装隔离证据放`evidence/beta-updates/`。

你不是独自在代码库中工作。保留`CLAUDE.md`、journal-real.json、版本开发流程、M9与历史发布证据及`client/windowsLauncher.ts`等既有修复，不回退他人代码。遇到文档冲突先回报并按阶段治理修订。

## 4. 必须表达的合同

### 4.1 渠道与原生快照

`stable|beta`偏好存应用配置目录独立文件（建议update-channel.json），原子持久化；缺文件为stable，损坏明确报错，不能悄悄归零。不得将其加入业务settings.yaml或改变冻结迁移。

快照至少包含selectedChannel、当前构建类型（由实际版本派生）、当前操作意图、已选目标版本/Release ID、兼容结论。状态仍用revision处理乱序；修改渠道成功后清除旧Available/Ready与bytes，再发新快照。若busy拒绝改变，既不排队静默切换，也不让旧检查结果覆盖新偏好。

### 4.2 Release选择

- stable：已发布、非draft、非prerelease、产品`vX.Y.Z`严格SemVer。
- beta：上述stable及产品`vX.Y.Z-beta.N`、prerelease=true，选SemVer较新候选；正式版同基础号高于beta。排除update-test、alpha/rc、不合法版本和矛盾标签。
- GitHub列表正确处理分页，不设任意页数/条数上限，不按发布时间/字符串排序。先锁定应选目标，再读该Release的清单；最高候选缺清单/资产、版本不匹配或签名失败要报错，不静默退到旧候选。
- 保留原repository/asset URL校验和凭据隔离；本轮仍使用已有gh认证，未登录/网络问题不显示“已最新”。固定update-test模式只允许隔离配置，不污染产品候选。
- 每Release保留latest.json及exe/sig；兼容声明放清单独立命名空间，例如`monorail:{channel,dataSchemaVersion,readableDataSchemaVersions}`，准确记录字段语义并由发布脚本生成。旧v0.2.5缺元数据仅通过显式版本兼容表承认，不能默认所有缺字段都兼容。

### 4.3 显式稳定目标覆盖

普通check永远只接受高于当前的候选。单独用户动作选择stable目标，只有该目标通过渠道、资产、版本、兼容验证后，单次比较器才允许低于当前版本。目标许可绑定当次状态/目标身份，切渠道或重查时失效；不得暴露任意URL或任意版本执行接口。

例：0.3.0-beta.2→0.2.5只在「安装稳定版0.2.5」确认流程中允许；0.3.0-beta.2→0.3.0正常升级；0.3.0→0.3.0-beta.9普通检查不降级；退出但未点安装时仅持久化stable偏好。

### 4.4 安装、备份与数据保留

保持「单轨」/`local.pixelrecord.app`/currentUser及同安装目录，稳定与Beta共用它们。安装包不得包含或初始化用户数据目录。检查目标NSIS模板实际降级分支与UPDATE路径，不能仅据历史生成脚本宣称通过。

应用内安装顺序：验证签名→封口主提交/快速记录/MCP并排空→草稿检查→生命周期checkpoint→在冻结状态建立备份并校验→官方updater安装。备份包含业务文件、附件、receipts和必要配置/目录授权；排除备份目录自身以免递归。已有journal必须排空/恢复，不能跳过错误。备份进度可观察，失败不安装，准确恢复原保存状态。用户没有选择恢复时不还原备份。

手动覆盖路径不能依赖旧应用不存在的新备份能力：安装器自身保证不删/不覆盖外部数据与配置；帮助提供手动备份说明。覆盖安装前后hash比较必须单独记录安装器替换阶段；启动后的合法状态恢复/计时变化另列，不能混淆“保留数据”与“所有运行后字节永远不变”。

### 4.5 发布脚本与版本

产品Beta为`v0.3.0-beta.1`等，prerelease=true且latest=false，资产名仍为产品monorail系列，不带update-test前缀。稳定版沿用`vX.Y.Z`。将test-release、product-beta、stable语义显式分开，兼容现有验收脚本而非一概替换。tag、package/Cargo/锁文件、manifest、安装器实际版本必须一致。

本轮可准备0.3.0-beta.1构建与发布材料；不push tag、不创建公开Release、不修改latest、不安装用户日常版本。准备就绪后由主代理审核并按已有发版授权流程执行。

## 5. 执行阶段与证据门槛

| 阶段 | 工作 | 完成条件 |
|---|---|---|
| B0 | 基线、旧稳定兼容审计、UI状态图与可执行测试清单 | 文件归属和兼容目标明确，产品代码尚未改动前记录结论 |
| B1 | 渠道持久化、原生快照/命令及加入退出UI | 重启保持；默认stable；busy/乱序/错误处理正确；UI可审阅 |
| B2 | Release分页筛选、SemVer、单目标稳定覆盖、兼容声明 | 正常更新不降级；显式回stable可选旧目标；损坏候选不假最新 |
| B3 | 签名/封口复用、备份、NSIS与手动数据保留 | 失败无安装/无数据丢失；Beta新增数据在目标stable可读 |
| B4 | Beta发布脚本/CI、版本同步、文档与产物准备 | 正式渠道隔离Beta；test-release不混用；无实际远端发布 |
| B5 | 全量检查、隔离真实UI和双向安装验收、交主审 | 下方矩阵证据齐全；不能只启动server或mock安装成功 |

B1/B2可在同分支逐步推进，B3依赖目标合同；B4/B5不得越过未完成数据保留验证。发现当前schema兼容不成立必须修正目标或回报，不自动扩大成通用逆迁移。

## 6. 最小验收矩阵

1. 默认stable不显示/推送Beta；加入确认/取消；Beta渠道选择最新合法候选；没有Beta时如实显示，无旧候选缓存污染。
2. Beta退出后不自动安装，重启仍stable；手动选择稳定版可安装较低兼容版本；普通check不触发降级；未来更高stable正常接收。
3. 检查/下载/验签/安装期间切渠道、乱序事件、重复点击、IPC断开后重连均保持唯一原生状态；旧ready包不能跨渠道误安装。
4. Release分页/顺序打乱、beta.9与beta.10、0.3.0与0.3.0-beta、draft/test/非法tag、元数据矛盾、清单缺失、签名错误和无网络/登录失败。
5. 稳定版→Beta→下一Beta→较低稳定版：同产品身份/安装路径，原数据、配置、附件、receipts完整；Beta期间创建的记录/待办/计时能在stable读取，目录授权不丢。旧v0.2.5目标使用真实源码/安装包或可审计对应构建。
6. 没入口旧版→GitHub下载包手动覆盖→加入Beta；Beta→手动稳定包覆盖；不卸载/不清理data。比较安装器运行前后hash，再独立验证启动后可读性。
7. 在写入、quickbar草稿、MCP写、备份失败/安装失败/恢复失败情况下不丢记录、不假成功；备份中包含附件，恢复不是默认行为。
8. 后端测试硬超时60秒；定向→类型/lint→相关构建→最小真实冒烟。Windows构建不用LinuxJava/Gradle；隔离NSIS不得触碰日常安装与日常数据。若缺签名或历史包，只能标未测，不能假勾B5。

## 7. 交接输出

每阶段更新Current Plan复选项、相关文档与Revision History。`evidence/beta-updates/`保留实现报告、命令/退出码、UI截图、版本/渠道合同、安装包哈希、覆盖前后数据校验与已知限制。完成后发主代理审核，不以你自行宣布完成代替主审。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-11-03 | 用户授权Beta加入/退出与保数据覆盖；制定同产品双渠道、显式稳定目标、备份及隔离安装验收方案，交coder-3实施 |
