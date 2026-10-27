# M2 背包与想法逻辑

2026-10-27。任务 `01a17c2e-8fd6-7711-bff6-b2b1b513bf0a`。依据设计 v0.2 的记录、背包、想法池、A3/A4/A6，架构 v1.1，以及本轮 lead 的明确裁定。

## 行为与归属

- `domain/project/backpack.ts`、`services/backpackService.ts`：新建、冷藏、放弃、恢复、makeRoom、卡编辑与完整队列重排。主支线共用最小空格号，已占用格号不变；容量下降不驱逐旧项目，不允许超额新增。恢复显式选择主线或支线，不增加 last_slot；已放弃卡不复活。
- A3：普通任务计时在项目移出时结束并刷新首页；插入活动继续，到回来时进入待机。冷藏只释放进行中卡；放弃终结所属项目全部未完成节点，包括已缩小祖先。已完成卡及底线快照保留。
- A4/A6：卡编辑重置跳过次数，独立维护执行字段并同步提醒；队列只显示待做/进行中的叶子，隐藏已缩小祖先。正常叶子的 passBlocked 未设置；非法 PASS 仍由 cardService/domain 拒绝。移到另一项目的缩小子卡完成或 PASS 时，仅恢复状态仍为已缩小的父卡，不能恢复已放弃祖先。
- `domain/idea/pool.ts`、`arena.ts`、`services/ideaService.ts`：新想法允许暂时超额；60 天按 last_touched_at 判断；编辑、对决、转换、捞回更新触碰时间，读取不更新。转待办只执行一次、保留 kind=想法 和原文/附件，pool=已转待办 后不计上限和对决。
- 冷库提议按 cold_since 最早给两个。空位足够直接捞回；池满需确认，只捞一个对决最弱项。最弱按 last_touched_at、created_at、id 排序。确认后返回对决但暂不写入，取消不算动过；决定胜负才同事务更新双方；对手或空位已改变时明确报错。普通超额擂台配最新创建与最弱旧项，持续到上限以内，无额外轮次上限。
- `domain/record/record.ts`：createRecord 与 extractTags 为记录条和 service 的共用入口；保存 needs、tags、相对附件路径及生命周期字段。旧 M0/M1 记录显式迁移，部分损坏的新格式报错。
- `store/backpackSlice.ts`、`services/backpackProjection.ts`：发布 `appStore.backpack` 的 projects、queue、ideas、coldIdeas，类型和现有背包页面字段一致。页面由 lead 接线，service 不反向引用 pages/widgets。

## 事务结构

想法仍存 records，不新增 ideas 持久化来源。`entityChanges.ts` 统一 card/review/project/record 的同事务合并，commit 提供 saveProject/saveRecord/removeRecord，提交成功后才发布投影。元数据变化保留原 Markdown 正文；实际编辑 text 时才替换正文。

journal 的 `text:null` 表示删除，保留 before 冲突校验；删除成功、后续写入失败时，恢复可幂等继续。MdRepo.remove 校验 mtime。删除想法保留其已生成任务卡与附件文件，本任务不承担附件垃圾回收。

lead 的 `62ce2e2` 修复插入期间卡换项目后 resume 的分类，并引入唯一 `trackOf`。本提交的 cardService 和 backpackService 使用该规则，历史计时不改。获 lead 批准的 domain 方向补充：arena→pool→record、card/edit→card/shared、project/backpack→project/shared。

## 验证与边界

- `npm run check` 通过：31 个测试文件、180 项测试（含同事并行新增的 UI 单测）；日志 `evidence/m2-logic-check.txt`。覆盖 A3/A4/A6、容量/makeRoom 回滚、格号复用、插入换项目、队列同序值、缩小链跨项目、池满确认/对决、过期边界、删除恢复、元数据正文保留和投影。
- `npm run tauri -- build --debug --no-bundle` 通过，普通非 verify Windows 产物 `src-tauri/target/debug/pixel-record.exe`；日志 `evidence/m2-logic-build.txt`。保留既有第三方 PURE 注释和 bundle 大小警告，未更改警告阈值。
- 本轮没有操作真实 exe、9223 调试端口或 `.verification-data/m1-smoke`；UI 接线与原生附件/调度接入由 lead 负责，真实桌面验收由 Pro B/lead 负责。
- 沿用项目测试进程 60 秒上限；coldOffer 的两个候选与池满一次一个来自产品规则，没有新增任意截断、重试上限、自动降级或静默成功路径。

## 接线接口

`backpackService`：createProject(ctx,draft,at)、freezeProject(ctx,id,at)、abandonProject(ctx,id,at)、restoreProject(ctx,id,slot,at,makeRoom?)、saveCard(ctx,id|null,fields,at)、reorderQueue(ctx,projectId|null,完整有序cardIds,at)。PASS 直接使用 cardService.pass。

`ideaService`：convertIdea(ctx,id,{content,projectId},at)、deleteIdea(ctx,id,at)、editIdea(ctx,id,{text,needs},at)、revive(ctx,ids,at,confirmed=false)、resolveDuel(ctx,winnerId,loserId,at)、expire(ctx,at)；同步 expireInTx(tx) 可由 scheduler 在启动/跨日的已有事务中调用。
