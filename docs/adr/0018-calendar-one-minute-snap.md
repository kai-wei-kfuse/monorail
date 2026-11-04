# ADR 0018：日历手动新建与调整的最小步长改为 1 分钟

状态：Accepted · 2026-11-04。

## 背景

用户反馈日历处手动添加条目的最小间隔应设为 1 分钟，而此前实现要求至少 5 分钟间隔。排查发现两层原因：

1. **步长默认值与参数传递**：`src/shared/settings.ts` 中 `calendarSnapMinutes` 默认值为 `5`，且 `TimeScreens.tsx` / `CalendarPreview.tsx` 硬编码传入 `snapMinutes={5}`。
2. **指针拖动激活门槛与像素密度冲突**：`CalendarBoard.tsx` 在 `HOUR_PX = 46` 下，1× 比例每分钟高度仅约 `0.767px`（4× 比例每分钟也仅约 `3.067px`），但 `onPointerMove` 硬编码要求 `|dy| + |dx| > 4` 才置 `moved = true`。这导致用户在 1×–4× 比例下直接垂直拖动 1 分钟（甚至 1× 下拖动 1–5 分钟）时，`moved` 始终为 `false`，松手时误入单击分支直接新建 30 分钟默认块，无法通过拖动创建或调整 1 分钟条目。同时，1 分钟短块的渲染高度夹紧为 `4px`，原先固定的上下各 `6px` 边缘手柄（`.blk > i`）会完全覆盖并重叠在短块上。

## 决定

1. **唯一默认步长来源**：将 `src/shared/settings.ts` 中 `settingDefinitions.calendarSnapMinutes.default` 由 `5` 改为 `1`。`TimeScreens.tsx` 与 `CalendarPreview.tsx` 统一引用 `defaults.calendarSnapMinutes`，不在 `grid.ts` 或 `CalendarPage.tsx` 增设第二套平行默认常量；由于设置页未暴露 `calendarSnapMinutes` 控件，直接读取 `defaults.calendarSnapMinutes` 即可对新老目录统一生效，不篡改冻结的 `v2.ts` 迁移逻辑，也不擅自改写用户磁盘上已有的 `settings.yaml`。
2. **修复指针 `down → move → up` 拖动激活门槛**：在 `src/pages/calendar/grid.ts` 中抽离纯状态转换函数 `beginBoardDrag`、`moveBoardDrag`、`endBoardDrag` 并由 `CalendarBoard.tsx` 调用。当指针实际移动时间跨度达到至少半个步长（`|t - rawT0| >= 0.5 * step`）且经 `dragTo` 吸附后的区间产生至少 1 个 `step`（1 分钟）的有效变化时，即置 `moved = true` 进入拖动状态；原地单击（或 `< 0.5 * step` 的微抖动）仍保持 `moved = false`，松手时在空白处新建 30 分钟默认块、在已有块上打开 `EntryPopover`。
3. **短块边缘手柄高度保护**：将 `src/pages/calendar/calendar.css` 中 `.blk > i` 的高度由固定 `6px` 改为 `min(6px, 25%)`，在大块上保持 `6px` 不变，在 `4px`–`20px` 的短块上限制上下边缘手柄各占不超过 25% 高度，避免上下手柄重叠并保留中间至少 50% 区域供点击打开弹窗或整块平移/复制。

## 影响与验证

影响 `src/shared/settings.ts`、`src/pages/calendar/grid.ts`、`src/pages/calendar/CalendarBoard.tsx`、`src/pages/calendar/calendar.css`、`src/app/TimeScreens.tsx`、`src/app/dev/CalendarPreview.tsx`。在 `src/pages/calendar/grid.test.ts` 中覆盖 `1× / 2× / 3× / 4×` 四档比例下 `CalendarBoard` 的真实 `onPointerDown → onPointerMove → onPointerUp` 链路（验证直接垂直拖动 1 分钟新建 1 分钟块、原地单击新建 30 分钟块、单击短块打开弹窗、按 1 分钟调整上下边与整块平移）。
