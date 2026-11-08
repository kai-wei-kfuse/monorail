# ADR 0027：同时多条主线任务

状态：Accepted v0.2 · 2026-11-08。唯一维护方：coder-6。coder已接受团队推荐：默认2、沿用1–3可调范围与旧1迁2。不是用户指定2条或无限。相关[执行方案](../stages/0.3.3-execution-plan.md)、[范围提案](../stages/changes/0.3.3-title-details-main-tasks.md)、[自动化契约ADR0029](0029-v033-automation-parity.md)。

审核：[0.3.3-final-plan-review-coder.md](../../evidence/0.3.3-final-plan-review-coder.md)；Runner `01M6WSEHW6ZX6YECSPYQEFV4CJ`。同一v0.2基线仅更新接受状态与引用。

## 事实与范围

用户要求“主线任务不要限制只能一个”。0.3.2 `mainTasks` 默认 1，可调 1–3；`mainItems` 默认 5、可调 1–10，是每个主线的待做子项上限。本轮不默认改变子项上限。

容量判断分布在 `task/backpack.ts`、`task/pool.ts`、`task/create.ts`、服务创建/恢复/重新打开与投影。只改 UI 或代码默认值不能满足既有 `settings.yaml` 的需求。

## Current Decision（v0.2，最小满足方案）

保留当前正整数mainTasks设置及既有1–3范围，将新目录默认从1改为2。主线子项mainItems默认5、范围1–10及sideTasks不变。用户确认的是“主线不要只能一个”；本选择使原默认目录直接可并存两条，允许通过已有设置选3，不为本版新增任意上限或nullable/Infinity配置。

原型app.js:98默认mainCap=3，已有两条主线；index.html:39–44演示栏列1/2/3/5，未实际交付正式数量设置。沿用1–3是主审要求的最小推荐，**5条演示不写成已指定正式范围**；若主审认定5条也属于已确认数量范围，须在本ADR修订后落地，不能代码继续卡3却声称完全支持5。coder在`01M6WRR5BNT5X6A32WAC6Q476X`认可可提交审核后，现已按本1–3基线最终放行，审核引用见本稿开头。

### settings v2→v3 迁移规则（v0.2）

| 输入 | 迁移结果 | 保全 / 错误规则 |
|---|---|---|
| settings.yaml不存在的新目录 | 写schemaVersion=3、mainTasks=2，其他新目录设置取已声明默认值 | 仅真实缺文件采用默认；不是坏文件降级 |
| 合法schema2，mainTasks=1 | schemaVersion改3、mainTasks改2 | 包括无法区分的旧默认1与曾手设1；迁移记录写明原1→2，迁移后可在设置主动改回1 |
| 合法schema2，mainTasks=2或3 | schemaVersion改3、mainTasks原样 | 不因新默认2把原3压低 |
| 已是schema3的合法设置 | 原样读取mainTasks，包括用户后来设置的1 | 不每次启动把1改2，不在运行读法偷偷替换 |
| 旧schema1 | 先沿冻结v1→v2映射mainSlots，再按本表迁3 | 不修改冻结旧迁移、计时或旧默认解释 |
| 缺mainTasks、越界、非整数、未知schema或坏YAML的现有文件 | 带settings.yaml路径明确报错，迁移停止 | mainTasks不是defaultWhenMissing键；不得猜2、静默夹值或忽略坏配置 |

迁移只改变上述两个设置字段，原lists及其未知字段、其它设置/未知元数据逐项对账并保留；不能通过当前defaults覆盖旧配置。若settings文件已标3但state仍2，判为不一致并明确报错，不把半迁移当新目录；既有完整journal先恢复后再判断。与想法映射同一份state首项迁移journal，原字节完整备份/读回，重复启动不重复迁移。设置原1→2的可观察变化在迁移记录及版本说明写明。

既有任务数量超过新当前上限时不冷藏、不删除、不重编号；保留ID、slot_index、押注及卡引用，只阻止后续新增/恢复直到有容量。用户降低设置到1时仍遵守这个规则，不能为迁移腾位。每日底线仍按主/支线类别，而不是每条主线各算一条。

## 实现要求（v0.2）

容量统一使用domain/task/pool.ts的canAddTask；putInBackpack先排除当前task.id，再调用同一判断，移除其自行计算main/side数量的重复分支。新建、冷藏恢复、整张/单项撤销、想法转新主线、UI显示均使用当前settings；保留mainItems单独判断。UI不能再只取首条主线，转已有任务明确选择task_id，任务不在背包或容量变化时拒绝，不改选另一条。

共享API新增create_task和convert_idea_to_task，契约与CLI/MCP指令以ADR0029为准；不新增第二套API容量/权限，也不隐式停止计时、排今日任务或冷藏腾位。设置页仍显示可调数量与当前计数，沿现设置控件而不搬原型演示栏。

## 验证（v0.2）

新目录及旧1迁移目录无需设置即可创建第二条主线；原2/3、主动设1、缺键/坏数据、schema1串行迁移、schema3不重迁逐例验证。第3条在limit2时拒绝、设3后可创建，第4条按已有max3拒绝；已超额任务与降低配置不被挤走。GUI/CLI/MCP创建与转换同容量；冷藏恢复、整张/单子项撤销同源；选指定第二主线不加到首条；mainItems、押注回顾和每日底线保持；settings未知字段/原字节备份/逐中断journal恢复对账。生产验证未运行，不把方案校核当实现通过。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-08 | 记录主线数量与子项容量区别、两条未定分支及统一领域入口；待用户答复，不默认无限 |
| v0.2 | 2026-11-08 | 用户确认后按主审最小方案推荐默认2与现1–3范围；固定旧1迁2/旧2或3保留/新3不重迁/坏配置报错和未知字段保全；明确5条演示差异、统一容量与ADR0029契约，待最终审核 |
| v0.2 Accepted | 2026-11-08 | coder最终审核接受默认2/旧1迁2/现1–3方案；补审核引用，仅更新状态，数量/迁移/容量规则不变 |
