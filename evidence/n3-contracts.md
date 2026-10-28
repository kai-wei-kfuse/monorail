# N3 接线草案（N2④实际导出）

2026-10-28。以下类型已落在代码里；N3 结束时再冻结。Claude 可据此接线，UI 保持只读投影与动作回调。

## 首页投影

`store/homeSlice.ts`：

```ts
entry: {
  id: string; description: string; project: string; tags: string[];
  startedAt: string; cardId: string | null;
  paused: boolean; kind: '普通' | '插入' | '暂停';
} | null;
pending: { id: string; startedAt: string } | null;
mode: 'blank' | 'task' | 'guide' | 'rest' | 'review';
```

原有 card、closedEffectiveMs、currentSegStartedAt、baseline、activity 显示投影保留；已用 = closedEffectiveMs + 当前段墙上时间差。实际条目只有 appStore.entries 一份。

`services/homeProjection.ts` 的 `projectHome({ cards, tasks, reviews, entries, state, settings, at, version }): HomeSlice` 是提交后投影入口。

## homeService 根动作

每个根动作返回 Promise，失败抛错，由 actions 的现有 report/guard 处理；一个动作一笔事务，末尾对齐卡。

```ts
beginPending(ctx, at)
cancelPending(ctx, pendingId, at)
startFree(ctx, { description, project, tags }, at)
startCard(ctx, cardId, at)
draw(ctx, at)
editOpen(ctx, entryId, { description?, project?, tags? }, at)
editMeta(ctx, cardId, project: string | null, tags: string[], at)
pause(ctx, at)
resume(ctx, at)
insert(ctx, presetIdOrName, at)
sleep(ctx, at)
wake(ctx, at)
continueEntry(ctx, entryId, at)
backfillRange(ctx, { start, end }, presetIdOrName, at)
commitReadout(ctx, request, seen: ReadoutPlan | null)
```

`commitReadout` 请求与 TimeField 目标一致：

```ts
type HomeReadoutRequest = {
  target: { mode: 'pending' | 'entry' | 'ref'; id: string };
  milliseconds: number;
  at: string;
};
```

pending 的 id 是 pending_id；entry 是条目 id；ref 是卡 id。
成功 `{ kind: 'done', hit }`；需要确认 `{ kind: 'confirm', hit, plan }`。
确认时原样带回同一个 request 和 plan；取消不再调用 service。
domain 的 `ReadoutPlan` 是不透明确认凭据，包含新的起点与完整覆盖区间。UI 只显示 hit，不改写 plan。
错误由 actions 转成 TimeField 的 `{kind:'error',message}`；不能将异常转成 done。

## tracking/api

所有可写操作都接 `TrackingTransaction`（运行时 Transaction 满足这个接口），不再次 run。点击时间统一为 tx.at。

```ts
startRefInTx(tx, ref, template, from?)
stopRefInTx(tx, ref)
renameRefInTx(tx, ref, description)
retagRefInTx(tx, ref, project, tags)
startSystemInTx(tx, project)
activeRefInTx(tx): string | null
refElapsedInTx({ entries, at }, ref): number
previewReadoutInTx(tx, request): ReadoutPlan
setReadoutInTx(tx, request, seen)
setRefTotalInTx(tx, ref, milliseconds, seen)
manualInTx(tx, template, start, end, source?)
editInTx(tx, entryId, patch)
deleteInTx(tx, entryId)
```

`EntryTemplate = {description, project, tags, card_id}`；引用对计时模块是不透明字符串。
日历和列表可通过根用例编排这些 InTx 函数；页面不直接拿 Transaction 或读写文件。

## 后续阶段边界

N3 负责把 TimerBar、TimeField 等组件接到这些真实接口；两种首页布局规则仍由 N3 验收。
完整任务池表单与想法转多项属于 N4；不能把现有纯 UI 组件误称为已接入功能。
N5 日历/列表、N6 独立小窗仍按原计划实施。

## N3 缺口补齐（2026-10-28）

`homeSlice.resumeDescription: string | null` 精确读取 `state.resume_entry_id` 指向条目的描述，无目标为 null。
Claude：将 `TimerView.paused` 接到该字段，删除 `pages/home/timerView.ts` 的 `pausedTarget` 倒推。

```ts
// services/homeService.ts
manual(ctx, { description, project, tags }, start: string, end: string, at: string): Promise<string> // 新条目 id
overlaps(ctx, start: string, end: string, at = ctx.now()): Coverage[] // 同步只读，无事务、无发布
startPreset(ctx, presetId: string, at: string): Promise<void>
// services/presetService.ts
createProject(ctx, name: string, at: string): Promise<{ name: string; color: string }>
addFavorite(ctx, { description, project, tags }, at: string): Promise<string>
favorite(ctx, entryId: string, at: string): Promise<string>
editFavorite(ctx, id: string, { description, project, tags }, at: string): Promise<void>
removeFavorite(ctx, id: string, at: string): Promise<void>
reorderFavorites(ctx, ids: string[], at: string): Promise<void>
```

手动补录走 `manualInTx`，E1 共存，只有待机让位；overlaps 排除待机，from/to 是精确相交区间（还带 Coverage 的项目、标签、卡 id）。非法范围抛错。
创建项目拒绝空白、系统五项、未分类和已有名字；自动生成不重复 RGB 色值。收藏同名不新增，返回已有 id，不存卡引用。
排序必须包含当前所有收藏一次；弹层预设的相对次序不变。收藏相关读取、验证和写入均在同一事务内，避免并发覆盖。
Claude：替换 actions 中的临时 addFavorite/reorderFavorites；启用 ManualForm 和就地新建项目；数字键可以直接调用 startPreset。

### N3 简报

- 已实现上述接口，未修改 UI/app 文件。
- 新增服务测试覆盖准确回到目标、E1 共存/查询无副作用、并发项目配色、保留名拒绝、收藏并发去重/编辑/删除/排序、待确认幂等与收藏起点。
- Windows 实际窗口、ManualForm 接线、快捷键和覆盖提示外观未实测，待 Claude 接线后验收。
- 下次发版必须包含 cbe1b11；本次不推送、不发布。

验证：npm run check 通过（52 个文件、341 条测试）；npm run build 通过。证据：n3-check.log、n3-build.log。

N4 增量：homeSlice 新增 knownTags（按使用次数排序）；首页项目选择可取 backpack.pool.projects（包含系统五项、未分类和自定义项目）。详见 n4-contracts.md。
