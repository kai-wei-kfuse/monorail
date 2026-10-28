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
预设收藏管理、就地创建项目/标签、完整任务池表单与想法转多项属于 N4；不能把现有纯 UI 组件误称为已接入功能。
N5 日历/列表、N6 独立小窗仍按原计划实施。
