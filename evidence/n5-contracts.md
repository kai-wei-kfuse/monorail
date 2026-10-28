# N5 日历和列表：逻辑线契约与简报

2026-10-28。根动作位于 services/timeEditService.ts；UI/app 由 Claude 接线。

```ts
type Instant = string | number; // ISO 或 epoch 毫秒
queryRange(ctx, start: Instant, end: Instant, at = ctx.now()): TimeEntry[]
recentEntries(ctx, days: number, at = ctx.now()): TimeEntry[]
create(ctx, start: Instant, end: Instant, at: string, value?: { description; project; tags }): Promise<string>
update(ctx, id, start: Instant, end: Instant | null, at): Promise<void>
move(ctx, id, start: Instant, at): Promise<void>
copy(ctx, id, at, start?: Instant): Promise<string>
patch(ctx, id, { description?, project?, tags? }, at): Promise<void>
remove(ctx, id, at): Promise<void>
setStart(ctx, id, text: string, at): Promise<void>
setEnd(ctx, id, text: string, at): Promise<void>
setDuration(ctx, id, text: string, at): Promise<void>
setShowIdle(ctx, on: boolean, at): Promise<void>
saveAsCard(ctx, entryId, at): Promise<string> // card id

// services/homeService.ts：沿用同一入口与卡状态对齐
continueEntry(ctx, entryId, at): Promise<void>
// services/presetService.ts
favorite(ctx, entryId, at): Promise<string>
createProject(ctx, name, at): Promise<{name; color}>
createTag(ctx, name, at): Promise<void>
```

## 接线规则

- CalendarActions.create(start,end) → create(ctx,start,end,at)，返回新 id 打开弹层。默认描述「（无描述）」、项目「未分类」。create 的 value 可用于非日历的完整录入。
- CalendarActions.update → update；copy(id,start) → copy(ctx,id,at,start)。拖整块也可直接调用 move，保持原时长。ListActions.copy(id) → copy(ctx,id,at)：复制在原条目之后，放不下时复制在原条目之前，不裁短。
- patch/remove/setStart/setEnd/setDuration 与回调同名；list 输入原文直接交给 service，不能吞掉异常或报告成功。
- setStart 按原开始日解释；setEnd 按原开始日解释，钟点不晚于开始时跨到次日；均复用 shared/duration.parseClock。setDuration 复用 parseDuration，未来结束时间直接拒绝，不裁短。
- 正在计时的条目只能改开始边；结束、时长、移动、复制、删除均拒绝。带卡条目不允许改描述或项目，允许改标签；历史不会反向修改卡。
- queryRange 是半开范围，返回所有相交条目，包括从更早日期跨进来的；返回对象与仓库隔离。只读查询不排事务、不发布、不重扫磁盘，使用启动时索引。recentEntries 按当前设置的活动日边界取最近 N 天。
- CalendarPage 目前自己管理 shift/view，ListPage 自己管理 days；Claude 需将范围变化交回接线层，或先交完整索引数据，再按 home.dataVersion 刷新。尚未改页面的范围回调。
- setShowIdle 保存 calendarShowIdle。ListPage 当前本地 showIdle 开关没有回调，需 Claude 将设置接进页面。
- 存为卡创建一个只有一项的支线任务，继承描述、项目、标签，满了仍保存（E4）；原条目不绑到新卡，不倒算新卡时长。
- 收藏与新建标签均走事务；createTag 拒绝空白和包含空白/#/@的名称。

## 验证

- npm test / npm run check：54 个文件、355 条测试通过；npm run build 通过。
- 证据：n5-tests.log、n5-check.log、n5-build.log。
- 新增测试覆盖日历 E1 共存/复制/移动/删除、范围跨日和只读隔离、列表解析失败整笔不写、午夜处理、卡条目拖动重算/复制累计/完成日不变、计时中非法动作、收藏/设置/存卡。
- 两个只读代理复核 N3/N4 和 N5，未报告可证实的 P1/P2；最终验证由主代理执行。
- 未实测：真实日历拖放、列表编辑、日期导航和分页接线、Windows 窗口。Claude 完成页面接线后再做 UI 冒烟。
- 本次不推送、不发版。cbe1b11 仍需随下次发布带上。
