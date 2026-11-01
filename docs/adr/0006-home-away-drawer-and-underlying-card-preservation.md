# ADR 0006：首页右上角临时活动下拉抽屉（AwayDrawer）与底层卡片保持不变

- 状态：Accepted（v1.3：按用户最新要求，临时活动期间底部操作整组灰色禁用；取代 v1.2 对底部入口可用性的约定）
- 日期：2026-11-01
- 生效版本：0.2.5
- 依据：用户要求在正在学习/做任务时点击快捷活动（如上厕所），在首页右上角弹出临时下拉抽屉展示临时活动，底层首页卡片内容保持不变且状态显示「进行中（暂停）」，并已确认 HTML 原型 v4 效果。

## 问题与决定

此前插入快捷活动（`kind === '插入'`）时，首页直接将当前 `open_entry` 渲染为主卡内容：当用户正在进行自由记录（如「学 408」）时，整张首页大卡的标题、分类和计时读数会被替换成「上厕所」；当用户正在做任务卡时，仅在卡头右上角显示文字链接「回来 · 厕所」。这冲淡了临时活动「附加、短暂插入」的语义，也打断了底层学习任务的视觉连续性。

决定在首页引入右上角临时活动下拉抽屉（`AwayDrawer`），并将底层卡片展示与临时活动展示解耦：

1. **底层首页卡片展示与只读/可写边界**：
   - 当当前运行条目 `home.entry.kind === '插入'` 时，首页视图映射（`timerView`）将当前插入条目暴露为 `view.away`（对应 `state.open_entry`，即唯一正在运行的计时条目），而将 `view.entry` 设为被中断的原条目 `home.resumeEntry`（由 `state.resume_entry_id` 指向的已截断条目，含非空 `endedAt`；若从待机插入或返回目标已失效则为 `null`）。
   - **底层展示冻结（无 `pending` 时）**：无论在融合布局还是分开布局下，底层首页卡片（`FusedCard`、`TaskCard`、`FreeCard`）与上方计时条（`TimerBar`）继续展示原活动的标题、项目、标签、进度竖条及截至离开时刻的已用时长（自由记录按真实的 `Date.parse(entry.endedAt) - Date.parse(entry.startedAt)` 计算，任务卡按 `closedEffectiveMs` 计算，均来自每次提交重算的 `projectHome` 投影，不维护本地影子缓存）。
   - **动作与编辑目标边界（防止误用历史 ID 调用 `editOpen` 或 `commitReadout`）**：
     - **当前 `open_entry`（`view.away`）**：唯一可经 `editOpen(away.id, patch)` 与 `commitReadout({ target: { mode: 'entry', id: away.id } })` 编辑的计时条目，其编辑入口仅位于右上角 `AwayDrawer`。
     - **底层已截断自由记录（`view.entry`，当 `view.away !== null && view.pending === null` 时）**：由于该条目在后端已结束（非 `state.open_entry`），在 `useEntry`、`TimerBar`、`FreeCard`、`FusedCard` 中一律设为**只读展示**：
       - `useEntry`：当 `!!view.away && !deciding`（即 `isFrozen === true`）时，`inputProps.readOnly = true`，项目与标签选择器 `disabled = true`，点击底层输入框不触发 `editOpen(resumeEntry.id)` 也不自动开启 `beginPending`（只有显式点 `＋` / `写别的` 调用 `E.next()` 时才开启 `beginPending`）。
       - v1.3：底部保留原按钮布局，但整个操作组在 `view.away` 存在期间灰色禁用，包含暂停/停止/＋/抽卡、卡自身动作及并存 pending 的底部放弃；悬停统一提示「从临时活动回来后可用」。鼠标、键盘均不能激活，回来后解除整组禁用，按钮自身原有禁用条件仍生效。卡头「写别的」等非底部入口和既有待确认语义不在本次修改范围。
       - `TimerBar`：当 `!!view.away && !pending` 时，`#elapsed` 的 `TimeField` `disabled = true`、`target = null`，且隐藏针对 `running.id` 的设为收藏按钮，防止向后端发送已结束的 `resumeEntry.id`。
       - `FreeCard`：当 `!!view.away && !pending` 时，`editable = null`，标题不可双击编辑，`#free-project` 与 `#free-tags` 为 `disabled = true`，`#free-elapsed` 的 `TimeField` 为 `disabled = true`、`target = null`。
       - 只读与显示值分离：FreeCard 的项目和标签取真实 resumeEntry，不能因 editable 为空而显示「未分类」和空标签。
       - `FusedCard` / `fusedState`：当 `!!view.away && !view.pending` 时，`target = null`（禁用底层 `#f-elapsed` 读数编辑）。
     - **底层进行中任务卡（`home.card`）**：卡自身的标题（`editContent(card.id)`）与卡头项目/标签（`editMeta(card.id)`）修改的是卡实体（`cardService`），在临时活动期间仍可正常修改卡本身；但卡的「已用」读数（`#f-elapsed` / `TaskCard` 读数）在 `view.away && !view.pending` 期间禁用编辑（因 `commitReadout` 的 `mode: 'ref'` 要求 `open_entry.card_id === card.id`）。
     - **底层操作入口（v1.3）**：临时活动期间底部「暂停」「停止」等按钮禁用；临时活动的〔回来〕仅由抽屉提供，继续可用。本次仅收窄 UI 可用性，不修改服务动作、快捷键或持久化语义。
2. **底层活动状态文案改为「进行中（暂停）」**：
   - 当 `view.away` 存在、无 pending 且底层存在进行中的任务卡（`c.status === '进行中'`）或原自由记录（`resumeEntry && resumeEntry.project !== '待机'`）时，底层首页卡片右下角读数旁的状态文字统一单行显示为 `进行中（暂停）`（`PAUSED`）；有 pending 时遵守下一节的待确认优先级。
   - 移除 `HomePage.tsx`（第 208–210 行）、`FusedCard.tsx`（第 55、94 行）与 `FreeCard.tsx`（第 36 行）中卡片右上角 `.c-corner` 内旧的文字链接「回来 · xxx」，统一收口至右上角 `AwayDrawer`。
3. **右上角浅色简约临时活动下拉抽屉（`AwayDrawer`）**：
   - 当 `view.away` 非空且 `home.mode !== 'rest'` 时，在 `.home-stage` 右上角渲染 `AwayDrawer`，采用与首页大卡同源的三段式浅色纸面设计（`--paper-2` 底 + 等高线 `Topo` + 顶部 4px 强调色挂轨 + 左侧 4px 黑边 + 右下 14px 折角）：
     - 顶行：`■ 临时活动 │ 记到` + `ProjectPicker flat` + `TagPicker flat` + 右侧 `开始于 HH:MM`
     - 中行：临时活动标题（支持点击/双击 `InlineInput` 就地改名）
     - 底行：左侧 `〔回来 ←〕` 按钮 + 右侧深色字读数 `ELAPSED 临时计时`（`TimeField` 可点改临时活动时长）
   - 背景与折角位于独立背景层 `.away-bg`（外层 `--ink` 14px 切角嵌套内层 `--paper-2` `inset: 4px 1px 1px 4px` + 13.5px 同心切角），确保 1px 边线严丝合缝且不裁切分类/标签下拉弹层；通过 `.home-stage` 容器查询（`cqi` / `cqh`）随窗口自适应缩放，不遮挡下方进度竖条与主计时读数。
   - 统一去除旧规范的天蓝色（`--cyan`）状态点，统一使用主题强调色 `var(--yellow)`。

## `pending`（待确认）与临时活动并存时的优先级与归属契约

后端允许「先 `beginPending` 再插入临时活动」与「临时活动中点 `＋ / 写别的` 触发 `beginPending`」两条路径使 `state.pending_id !== null` 与 `open_entry.kind === '插入'` 同时存在。此时规则明确如下：

1. **展示位置与优先级**：
   - **右上角 `AwayDrawer`**：只要 `open_entry.kind === '插入'`（`view.away !== null`），`AwayDrawer` 始终保持显示当前正在运行的临时活动。
   - **底层卡片与 `TimerBar`**：当 `view.pending !== null` 时，底层卡片与 `TimerBar` 优先展示 `pending`（待确认）状态：
     - 若有抽到待做的卡（`card.status === '待做'`）且未点「写别的」（`!write`）：显示该待做卡，状态为 `['待开始 · 已在计时', 'PENDING']`，读数计入 `now - pending.startedAt`。
     - 否则（无卡，或进行中卡/自由记录下点了 `＋ / 写别的`）：`useEntry`、`TimerBar`、`FreeCard`、`FusedCard` 切入待确认输入态（`WAIT / PENDING / 待确认 · 已在计时`），允许用户输入新活动或选择建议项。
2. **读数编辑归属（两个读数各自独立有效）**：
   - **抽屉内读数（`#away-elapsed`）**：目标始终为 `{ mode: 'entry', id: away.id }`，修改的是当前临时活动 `open_entry` 的开始时刻。
   - **底层读数（`#f-elapsed` / `#elapsed` / `#free-elapsed`）**：当 `view.pending !== null` 时启用，目标为 `{ mode: 'pending', id: pending.id }`。后端 `commitReadoutInTx` 针对 `mode: 'pending'` 仅校验 `request.target.id === tx.state.pending_id` 并更新 `tx.state.pending_at`，不要求匹配 `open_entry`，因此可正常修改待确认起点；当 `view.pending === null` 时底层读数禁用（`target = null`）。
3. **动作交互结果**：
   - **确认待确认（输入回车/失焦调 `startFree`、点待做卡〔开始〕调 `startCard`、或点切换型收藏）**：按现有 `claim` 规则结算，以条目实际开始时刻与当前 pending 起点的关系为准。10:00 pending、10:05 插入、10:10 确认时，插入段保留至 10:10，新活动从 10:10 开始；10:00 插入、10:05 pending、10:10 确认时，原插入在 pending 之前开始，在 10:05 截断，新活动从 10:05 开始。修改 pending 读数后按实际起点重算；离线保护不变。确认关闭临时活动并清空 pending/返回目标，收起抽屉。插入型收藏仍走连续插入规则，不因名称为“收藏”而清掉 pending。
   - **取消待确认（按 `Escape` 或点〔放弃〕调 `cancelPending(pending.id)`）**：仅清空 `pending_id` / `pending_at`（并收起待做卡），不停止正在运行的临时活动 `open_entry`，也不清空 `resume_entry_id`；底层卡片立即恢复为冻结展示 `resumeEntry`（或待机），`AwayDrawer` 保持打开。
   - **在并存期间点抽屉〔回来〕（`actions.resume`，v1.3）**：结束临时活动并恢复 `resume_entry_id`（若无则转待机），收起抽屉且不静默丢弃已有 `pending_id` / `pending_at`。底部暂停/停止及放弃按钮在临时活动中不可激活；Escape 取消待确认等非底部路径沿用既有语义。

## 抽屉内改读数覆盖前序记录及返回目标（`resumeEntry`）的契约

在 `AwayDrawer` 内点击 `#away-elapsed` 调大临时活动时长（使临时活动起点前移）时，严格复用既有 `planReadout` / `commitReadoutInTx` -> `place(..., 'switch')` -> `acceptInTx` -> `alignInTx` -> `projectHome` 链路，不引入保护返回目标的特殊覆盖豁免，也不在前端缓存旧快照：

1. **预览与取消确认**：
   - 若前移后的起点与前序非待机条目（包括 `resumeEntry` 本身或更早条目）相交，首次 `commitReadout` 返回 `{ kind: 'confirm', hit, plan }`，在抽屉下方渲染 `<HitNote />`（`将覆盖：… 〔确定〕〔取消〕`）。
   - 点击〔取消〕：丢弃预览，不修改任何条目。
   - 确认期间若 `open_entry` 已被切换（如小窗操作）或前序相交区间发生变化：再次提交时由 `commitReadoutInTx` 拒绝（`已经换成别的事了`）或重新返回最新 `confirm` 预览。
2. **部分覆盖返回目标（Partial Overwrite）**：
   - 用户点击〔确定〕后，`place(..., 'switch')` 将 `resumeEntry` 的 `ended_at` 截短至临时活动的新起点，`resumeEntry.id` 保持不变，`state.resume_entry_id` 仍有效。
   - 提交后 `projectHome` 从最新 `entries` 重新投影 `home.resumeEntry`（及任务卡的 `closedEffectiveMs`）：底层自由记录或任务卡的已用读数立即重算为截短后的真实时长，状态仍为 `进行中（暂停）`；随后点击〔回来〕仍正常恢复该原活动。
3. **完全覆盖返回目标导致目标失效（Full Overwrite / Target Invalidated）**：
   - 若临时活动新起点早于或等于 `resumeEntry.started_at`，用户点击〔确定〕后，`place(..., 'switch')` 会删除被完整覆盖的 `resumeEntry`。
   - `acceptInTx`（`src/services/tracking/transaction.ts:16`）检测到 `state.resume_entry_id` 指向的条目已不存在，立即将 `tx.state.resume_entry_id` 清空为 `null`。
   - 若原活动为进行中的任务卡且该卡已无运行引用，同事务末尾的 `alignInTx`（`cardService.ts`）因 `activeRef(tx) === null` 将该卡状态退回 `'待做'` 并清空 `current_card`（`home_mode = 'blank'`）。
   - 提交后 `projectHome.resumeEntry` 为 null，原进行中卡按 align 规则释放。若仍有 pending，保留其 ID、起点和输入，继续显示待确认或已抽到的待做卡；没有 pending 和待做卡时才显示空白待机底层，不再显示已删除的原活动或“进行中（暂停）”。此时真实正在计时的仍是抽屉临时活动，不创建第二条待机计时。
   - 随后用户在 `AwayDrawer` 点击〔回来〕时，`homeService.resumeInTx` -> `timerService.resumeInTx` 因 `state.resume_entry_id === null` 直接切换为 **`待机`**（`startSystemInTx(tx, '待机')`），收起抽屉。不承诺在原活动已被完全覆盖删除后仍恢复原活动，也不使用前端影子状态伪造恢复。

## 验证

HTML 原型已在 `原型/页面/` 经过 4 轮迭代并通过 `原型/测试/` 全部 7 项测试，无头 Edge 多尺寸截图存证于 `../UI参考截图/v0.2.5-01..05-*.png`。正式应用补充 `homeProjection`、`homeService`、`timerView.test.ts`、`cardArea.test.ts` 与 `fused.test.ts` 单测、全量 `npm run check` 及无头 Edge 浏览器视觉/交互验证。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-11-01 | 记录用户确认的 AwayDrawer 视觉与投影方向 |
| v1.1 | 2026-11-01 | coder-3 补齐只读边界、pending 并存与覆盖返回目标契约 |
| v1.2 | 2026-11-01 | coder 复审明确显式新活动入口与焦点行为、两种 claim 时间语义、冻结元数据展示和目标失效后的 pending 优先级；不改变现有事务或持久化格式 |
| v1.3 | 2026-11-01 | 用户手测截图要求临时活动期间底部按钮灰色不可按，悬停提示从临时活动回来后可用；替代 v1.2 底部入口可用约定，涵盖两种布局和 pending 并存，服务/数据及非底部入口不变 |
