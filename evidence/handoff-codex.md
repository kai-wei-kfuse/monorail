# Codex M1 交接（2026-10-27）
- 任务：01a17923-f1f8-7e93-9685-b5ce6ec52d7b，仍 in_progress；用户要求暂停开发换上下文。
- 协调：lead 01a17812-9d85-7e71-a12e-e9b4323d90f5；UI Pro B 01a178ca-1b40-7420-a319-76c7db654072；只用 team_*。
- 依据：根目录设计文档 v0.2（附录 A 优先）、架构 v1.1、首期开发计划；app/CLAUDE.md；不改根文档。
## 已提交
- d64b53c：Tauri 验证骨架；5641420：M0（repos 注入、按日 IO、事务、settingsRepo、测试和约定）。
- 6204347：M1 settings/schema、card/transitions/shrink、baseline/degrade/project/stats 基础规则。
- 6baefad：tx.saveCard/cards/projects/reviews/notices；home 投影/store；picker/review；计时内存索引与恢复测试；mainSlots 1–3。
- 73e45b6（WIP）：card/deal/degrade/record 四个 service 首轮实现，尚未完成 M1 场景验收。
- lead 已提交 5e908f1（sleep/offline 释放卡）及 1c368fc（bootstrap 投影、scheduler、长提醒）；不要覆盖。
- 本次 npm run check：21 文件、92 测试通过，tsc/eslint 通过；尚未针对新增 service 补测试，尚未普通构建/冒烟。
## 工作区未提交
- 本人 service WIP 已按要求提交；本交接文件新建，另行提交。
- evidence/journal-real.json：早先验证生成的修改，不属于本次，禁止顺手暂存。
- src/app/dev/BackpackPreview.tsx、src/pages/backpack/{IdeaPool,ProjectList,QueueList}.tsx、backpack.css：Pro B 正在做视觉，勿改/暂存。
- src/ui/layout/layout.css、src/pages/{review,settings}/、src/widgets/{Arena,ColdPick}.tsx、review.css：Pro B 的工作区，勿改/暂存。
## M1 剩余（WIP 是起点，不代表验收）
- cardService：已写 start/complete/checkComplete/shrink/redraw/pass/leaveTo；补 A2 插入中动作、早完成点击时刻、续卡、A6 链恢复测试与边界核验。
- dealService：已写 refresh(ctx,at)/refreshInTx(tx)/stopInTx(tx)；补新阻塞顶替待做且不计拒绝、运行中不打断、跨日/轮次/权重/空引导测试。
- degradeService：已写 registerRefusalInTx(tx)/returnFromRest(ctx,answer,at)；补 A7 第四次动作先执行再休息、输入提醒不切计时、回答第三次信号测试。
- reconcile：已改 tx.saveCard + refreshInTx，同事务幂等；补 A4 卡字段独立、阻塞接入及提醒计划联动测试。
- stopToday 已放 cardService 编排：释放卡→切待机→deal.stopInTx；补进行中/插入/日边界恢复测试。
- 休息回答：先 switchInTx 待机，再 backfillRangeInTx 覆盖 rest.started_at..at；category=休息/source=自动；空白不覆盖、零时长不补记；需要实测。
- bootstrap.ts 的 TODO(M1)：lead 明确授权替换 onDayChanged 的空 run 为 dealService.refresh(ctx, at)，其余 bootstrap 避免抢改。
- 检查 homeProjection：有效历史+当前尾段分离；补覆盖/跨天/插入、零时长、多个主线格、home_mode 与离线释放后的协调测试。
- dueReview 目前仅处理当前 ISO 周；跨周未完成回顾是否应持续需向 lead 核实；M1 只做周期纯规则/占位，完整回顾 M3。
- 最后 npm run check、普通 npm run tauri -- build --debug --no-bundle、最小冒烟，证据如实留存；只提交本人路径；向 lead/Pro B 双报。
## 已约定合同
- Codex：card/deal/degrade/reconcile、domain picker/baseline/stats/degrade、home/notice；lead：timerService/scheduler/domain-reminders/原生提醒；Pro B：UI/pages/widgets。
- 共享 stateRepo/schemas/settings 修改前通知；mainSlots 范围1–3默认1，支线默认2；主线随机权重1.5、其他1；due=null最后，order同值按id。
- run(rootCtx, tx=>..., at) 串行；InTx 只拿 tx；tx.saveCard 合并同卡写入，避免直接 cards.write 重复路径；tx.notices 提交后发布。
- 计时所有写入经 timerService；switchInTx(tx,at,target,{startAt?,source?})；同事务合并同日写入；切片保留同一逻辑id/seq。
- stopToday 放 cardService，deal 是叶子不调 timer；degrade 用户动作只调 timer，card→degrade→timer、card→deal，不能成环。
- returnFromRest 的活动答案用追加覆盖段（lead批准），不修改历史 activity；恢复原待开始卡、计待机。
- notice 唯一定义 shared/notices.ts，使用 offlineAsk/longActivity/skipSignal/subconscious/inputHint/timeboxShort/restReturn；UI reexport。
- times.snapshot 是启动 scan 构建的可重建内存缓存，transact 成功后刷新；崩溃恢复后启动 scan；不是持久化第二来源。
- stop/sleep 释放进行中卡→待做/current_card=null；sleep 不提前换活动日；离线先落账再追问，lead负责。
- 完成使用最初点击 at；补记覆盖不计任务时长；缩小子卡不续卡；PASS 已缩小父卡禁止；第四次缩小子卡变待做后休息。
- 本轮只排除主动 redraw 卡；自动新阻塞顶替不加拒绝/skip；无候选才引导，运行中/休息不被 refresh 打断。
