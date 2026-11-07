# ADR 0022：整张任务完成、子项单行完成/取消完成与任务重新打开

状态：Accepted（修订4，两侧定向复核通过） · 2026-11-07 · 对应 [0.3.2 需求](../stages/0.3.2.md) 第1条与第7条。前序任务侧 [S1–S5/N1–N4](../../evidence/0.3.2-plan-review-task.md) 与自动化侧复核已通过；修订3–4纳入第7条（任务详情单行完成子任务与取消完成恢复待做，保留底部整张完成）并吸收 [v1.6 技术审核 S1–S5](../../evidence/0.3.2-plan-review-v1.6-coder.md) 与 [需求审核 N1–N5](../../evidence/0.3.2-plan-review-item7.md)，两侧定向复核通过，接口联动见 [ADR 0023](0023-032-automation-coverage.md)。

## 问题与现状

用户需要在任务详情中既能**按行选择完成单个子任务（及取消完成恢复待做）**，也能在底部**直接完成整张主线/支线任务**（剩余未完成项一起完成，腾出格位，进入已完成列表，并可撤销）。今日任务板的行不增加完成入口。

- `domain/task/task.ts` 已有 `已完成` 状态，但没有完成时间或撤销信息。
- `domain/task/pool.ts:afterItem` 只自动结束没有活跃事项的支线；`backpackProjection` 仅有名字列表 `doneSides`，不能定位、展示详情或恢复任务。
- `cardService.complete` 是当前卡的根事务，不能在批量完成或 `runOperation` 中循环调用。其旧缩小父卡恢复规则也不适合完成整张任务。
- `backpackService.restoreTaskInTx` / `makeRoomInTx` 和 `domain/task/backpack.ts:putInBackpack` 已提供满格拒绝、明确腾位与格号分配。
- `taskSchema`、`cardSchema` 为 passthrough；`MdRepo.write` 合并原始 frontmatter 后写入。TypeScript 类型不会在运行时删除额外属性。旧版实际写回仍要测试，不能只凭类型推断兼容。

## 选择

最小按钮补丁只改 task.status，无法说明子项撤销；从操作历史恢复又会依赖180天保留期，回执也没有完整前态。选择**任务内可选的完成元数据与字段级恢复快照**，和卡、计时、历史一起进现有 journal。不要另建撤销数据库或第二套提交队列。

### 1. 存储

schemaVersion 维持2，Task新增可选、可空字段；不改任务/卡状态枚举，不向 state.yaml 加字段。

```ts
completed_at?: string | null;
completion?: {
  id: string;                     // 本次手动完成的UUID，重新打开时绑定这一批
  at: string;
  task_slot: '主线' | '支线';
  member_ids: string[];            // 完成时本任务的全部卡ID，排序后保存
  cards: {
    id: string;
    before: {
      status: '待做' | '进行中';
      completed_at: string | null;
      completed_day: string | null;
      completed_track: '主线' | '支线' | null;
    };
  }[];
} | null;
```

- `cards` 只保存本次从待做/进行中改成完成的项；原来已完成、已放弃、已缩小的项不改、不放入恢复集合。
- 批量完成保留内容、项目、标签、顺序、目标时长、拆分关系和已有进度笔记，只改 status 与卡的完成时间/活动日/轨道。
- 不保存整卡副本，避免撤销覆盖后续合法的内容修改；不依赖历史记录重建前态。
- 新版自动完成支线也写 completed_at、slot_index=null、completion=null；旧任务没有时间时显示“完成时间未记录”，不猜测时间。已完成列表先按已知时间倒序，无时间项按原有稳定顺序排在后面。
- schema只校验字段本身；不增加“任务非完成就不能带completion”的跨状态refine。旧版恢复任务后可能保留旧快照，这是合法往返，不应让整个目录打不开。

### 2. 手动完成规则

`completeTaskInTx(tx, taskId)` 放在 backpackService，GUI根动作与自动化共用：

1. 只允许背包中进行中的任务；已完成任务返回noop，不重复生成快照/重写完成时间。冷藏、已放弃不自动恢复后完成。
2. 先完整校验，再生成本批completion.id、记录member_ids和受影响卡字段。时间统一使用tx.at，活动日取当前设置。
3. 若本任务包含正在计时或卡暂停中的当前卡，停该引用并清理current_card/home_mode；不影响另一个任务或自由活动。
4. 若它是插入中/插入暂停中正在等待的原任务，拒绝 `IN_AWAY_ACTIVITY`，提示先回到任务或结束原任务。不要用stopRef顺带结束当前插入的事。正在等待确认起点且本操作会停止其关联卡时也明确拒绝；不对无关任务加计时门槛。
5. 在任务仍为进行中时先确定本批track=task.slot，再批量完成全部活跃卡。不能先保存完成Task再用trackOf求轨道，否则主线会被误记为支线。卡纯转换允许待做/进行中且保留progress_note；现有completeCard会要求进行中并写note，不能原样拿它批量覆盖笔记。当前单卡入口仍保持自身限制，不循环启动待做卡，不新增零长度计时条目，不逐项弹时间盒未计满提示。
6. 不调用旧缩小链的restoreParent，避免复活已缩小祖先。最后直接组成Task：status=已完成、slot_index=null，写completed_at和completion，保留slot与原bet_ends_at。**不调用leaveBackpack**，它会把bet_ends_at清成null。
7. 不改plans文件。完成状态按既有派生规则从背包/候选中过滤，今天板子按既有完成项显示；重新打开后若项仍在当前板子文件中可重新出现。

GUI先展示一次确认，明确“还剩N项，将一并完成并腾出格位”；确认期间变化由提交时重新校验。MCP/CLI的complete_task本身表示明确完成整张任务，描述与返回值写清受影响项。

### 3. 重新打开规则

`reopenTaskInTx(tx, {taskId, completionId, makeRoom?})`：

- task必须为已完成；`completionId` 明确可空。有快照必须精确匹配当前completion.id，防止旧列表误撤销另一批完成；旧任务/自动完成无快照时必须传null。
- 有快照：比较当前任务slot、卡成员ID集合、每个受影响卡仍属本任务且仍为本批完成（status/完成时间/活动日/轨道匹配）。发现删除、重分配或再次完成等变化，整次拒绝 `TASK_COMPLETION_CHANGED`，给出冲突卡ID；不跳过冲突项或部分恢复。
- 校验匹配后，只恢复本批改变的卡字段；原来进行中的项恢复为**待做**。原来已完成的项继续完成。历史计时、进度和内容不回滚，不自动重开计时或替换当前在做的事。
- 无快照：明确返回 `reopen_mode: task_only`，只重新打开任务，所有子项保持原状。UI说明“此任务没有批量完成前记录，已完成事项保持完成”，不伪造旧状态。这覆盖已有自动完成任务和旧版任务。
- 恢复到任务原有主线/支线类别。复用putInBackpack分配空格与现有makeRoom语义，但该函数当前会重设主线押注日期；不能直接保存它的原样结果。重新打开保存 `{ ...putInBackpack(...), bet_ends_at: task.bet_ends_at }`，同一事务中沿用原日期，不复制第二份格位/满格算法。例：原截止11月20日，11月7日重新打开仍是11月20日，不是新周期；旧任务已无日期就保持null。
- 满格且未提供makeRoom：`TASK_CAPACITY_FULL`，返回同类别可选腾位对象；GUI复用MakeRoomPicker，API允许明确 `{task_id, action: freeze|abandon}`。选定对象与恢复同一事务提交，自身、已离格或不同类别拒绝。不能自动冷藏/放弃别人。
- **腾位对象的局部计时保护与 noop 顺序（吸收S2/S4）**：
  - 在任何 `saveTask / saveCard / stopRefInTx` 之前，`makeRoomInTx`（及 `removeTaskInTx`）统一对选定腾位对象执行局部计时保护：若腾位对象包含正在插入/插入暂停等待的原卡（`insertStateInTx(tx)` 且 `resume?.card_id` 或 `tx.state.current_card` 属于该腾位任务），拒绝 `IN_AWAY_ACTIVITY`（即使 `expected_state` 令牌匹配也不得截断插入事件）；若 `Boolean(tx.state.pending_id || tx.state.pending_at)` 且 `tx.state.current_card` 属于该腾位任务，拒绝 `PENDING_START_CONFIRMATION`；若腾位任务包含正在普通计时或卡暂停的当前卡，在明确腾位确认与令牌校验通过后停止该卡计时并清 `current_card/home_mode`。
  - 若目标任务已处于背包 `进行中`：未传 `makeRoom` 时直接返回幂等 `noop`；若调用方在无需腾位的已恢复状态下仍传入 `makeRoom`，明确拒绝 `MAKE_ROOM_NOT_NEEDED`，绝不在 `noop` 时执行腾位改变其他任务。
- 全部成功后清completed_at/completion，任务回进行中。不立即调用afterItem再次自动完成没有活跃项的支线；允许用户向重新打开的任务添加事项。
- 既有restoreTaskInTx遇已完成任务时走这条共用恢复路径，不能留下绕过快照校验的第二入口。冷藏/已放弃恢复行为保持原规则。

### 3b. 子项单行完成与取消完成规则（需求第7条，吸收S1–S5/N1–N5）

1. **职责归属与共享纯转换（吸收S1）**：
   - `domain/card/transitions.ts`：
     - `completeCardItem(card, at, day, track, note?)`：允许 `card.status === '待做' || card.status === '进行中'`，置 `status = '已完成'`、写 `completed_at / completed_day / completed_track`；当 `note === undefined` 时保留原 `card.progress_note`，传入字符串时更新 `progress_note`。供首页当前卡完成、任务详情单行完成子项、整张任务批量完成三处共用。
     - `reopenCardItem(card)`：要求 `card.status === '已完成'`，返回 `{ ...card, status: '待做', completed_at: null, completed_day: null, completed_track: null }`，保留 `progress_note / content / project / tags / order / timebox_minutes / shrunk_from`。
   - **唯一服务编排归属（防反向边）**：
     - **`completeTaskItemInTx` 归属 `cardService`**（直接复用 `cardService` 内部的 `restoreInTx`、`finishItemInTx`、`alignInTx`）；
     - **`reopenTaskItemInTx` 归属 `backpackService`**（直接复用 `backpackService` 内部的 `makeRoomInTx`、`putInBackpack` 与父任务恢复逻辑）；
     - 两者仅共用 `domain` 纯转换与 `tracking/api`，`cardService` 与 `backpackService` 之间绝不互相导入或调用根动作。
2. **单子项完成事务（`cardService.completeTaskItemInTx(tx, { cardId, note?, finishEarly? })`，吸收S4/S5）**：
   - **严格校验与 noop 顺序（吸收S4）**：
     1. 校验 `card` 存在且所属 `task` 存在（否则报 `CARD_NOT_FOUND` / `TASK_NOT_FOUND`）；
     2. 若父任务为 `冷藏` 或 `已放弃`，直接拒绝 `TASK_NOT_ACTIVE`；
     3. **若 `card.status === '已完成'`**：即使父支线任务刚刚因该尾项完成而自动变为 `已完成`，新 `operation_id` 的重复完成也在此时立即返回幂等 `noop`，不重写 `completed_at / completed_day / completed_track`；
     4. 校验父任务在背包进行中（`inBackpack(task)`），否则拒绝 `TASK_NOT_ACTIVE`；
     5. 校验 `card.status === '待做' || card.status === '进行中'`，若为 `已放弃 / 已缩小` 拒绝 `CARD_NOT_ACTIVE`。
   - **不要求先在首页开始计时（不强制全局 `requireCurrent`，吸收S5/N5）**：
     - 若该卡**不是**当前首页关联卡（`tx.state.current_card !== cardId` 且非插入原目标 `resume?.card_id !== cardId`），允许直接从 `待做`（或历史孤立 `进行中` 状态）标为 `已完成`，不影响正在运行的另一张卡、自由计时或插入事件，也不写入零长度计时段，不弹时间盒未达量提示。
     - 若该卡**正是**当前首页卡（无论是正在运行还是**卡自身暂停中** `open?.kind === '暂停'`）或插入等待的原卡：校验 `insertStateInTx(tx)`（插入中/插入暂停中拒绝 `IN_AWAY_ACTIVITY`，防止 `stopRefInTx` 截断插入条目）与真实待确认字段 `Boolean(tx.state.pending_id || tx.state.pending_at)`（拒绝 `PENDING_START_CONFIRMATION`）；若该当前关联卡为 `时间盒卡` 且已计时间未达目标时长（含运行中与卡暂停中），未传 `finishEarly=true` 时统一返回/提示 `TIMEBOX_NOT_REACHED`（GUI 与 API 口径一致，确认后传 `finishEarly=true`）；通过后调用 `stopRefInTx(tx, cardId)` 并清 `current_card = null, home_mode = 'blank'`。
   - 调用 `completeCardItem`（轨道取 `task.slot`）、`restoreInTx`（兼容旧版 `已缩小` 父卡）、`afterItem(task, tx.cards, tx.at)`、`alignInTx` 与 `refreshInTx`。
   - **主线与支线尾项差异及已完成任务详情入口（吸收S3/N3）**：
     - 支线最后一项子任务完成后，`afterItem` 自动将该支线标为 `已完成`（`slot_index = null, completed_at = tx.at, completion = null`）。
     - `BagDrawer` 通过在 `[...pool.mains, ...pool.sides, ...pool.doneTasks]` 中解析 `detail` 任务，使尾项完成时当前详情页保持打开不闪退；同时**「已完成」任务列表每行除〔重新打开〕（整批恢复）外，支持点击任务（或〔详情 ›〕）进入已完成任务的详情页**（绝不先偷偷调用整任务 `reopen`），在详情页每行展示已完成子项与〔取消完成〕。
     - 主线即使全部子项逐个完成仍保持 `进行中` 留在背包，用户可在详情继续取消完成子项、添加新子项，或点底部〔✓ 完成整张任务〕归档腾格（此时 `completion.cards` 为 `[]`，重开整张主线时原先逐项完成的子项保持完成）。
3. **单子项取消完成事务（`backpackService.reopenTaskItemInTx(tx, { cardId, makeRoom? })`，吸收S2/S3/S4/S5/N1）**：
   - **严格校验与 noop 顺序（吸收S4）**：
     1. 校验 `card` 存在且所属 `task` 存在；
     2. 若父任务为 `冷藏` 或 `已放弃`，明确拒绝 `TASK_NOT_REOPENABLE`（绝不自动解冻或将子项变成隐藏在冷藏/放弃任务里的 `待做`）；
     3. **若 `card.status === '待做'`**：若调用方同时传入了 `makeRoom` 则拒绝 `MAKE_ROOM_NOT_NEEDED`（防止 `noop` 误腾位伤及其他任务）；未传 `makeRoom` 且父任务在背包进行中时直接返回幂等 `noop`；
     4. 校验 `card.status === '已完成'`，若为 `进行中 / 已放弃 / 已缩小` 拒绝 `CARD_NOT_COMPLETED`。
   - **父任务在背包进行中（`inBackpack(task)`）**：
     - 若传入了 `makeRoom`，拒绝 `MAKE_ROOM_NOT_NEEDED`（父任务已在格内无需腾位）；
     - 若 `task.slot === '主线'`，必须先校验主线剩余活跃名额 `itemCapacity(task, tx.cards, limits) <= 0`（`domain/task/pool.ts:18`，第三参 `PoolLimits` 取动态 `tx.settings.mainItems` 而非写死 5；当剩余名额 `<= 0` 时拒绝 `MAIN_TASK_ITEMS_FULL`），提示先完成或移出其他待做项；
     - 通过后调用 `reopenCardItem(card)` 将该子项恢复为 `待做`，不自动启动计时，不回滚已记录的计时条目与进度笔记。
   - **父任务处于 `已完成`（从已完成任务详情或支线尾项刚自动完成的详情中点单个子项〔取消完成〕，吸收S2/S3）**：
     - 同一事务内先校验 `itemCapacity(task, tx.cards, limits) <= 0`（动态 `tx.settings.mainItems`），再按 §3 格位与局部计时保护规则（S2：`makeRoom` 对象若含插入原卡报 `IN_AWAY_ACTIVITY`、含 `pending_id/pending_at` 关联卡报 `PENDING_START_CONFIRMATION`）将父任务恢复回原 `task.slot`（满格无 `makeRoom` 报 `TASK_CAPACITY_FULL`；保留原 `bet_ends_at`，并清空父任务 `completed_at = null, completion = null` 以免残留失效批量快照），同时**只将该目标子项恢复为 `待做`**，其余已完成子项保持 `已完成`。GUI 对此路径展示明确确认说明“任务将一并回到背包，只恢复这一项”（满格时在同一弹窗内提供 `MakeRoomPicker`，取消零写）。

### 4. 其他状态转换与兼容

- 新版自动完成、重新打开及其他明确改变完成状态的路径，统一维护完成元数据；读到非完成任务携带旧快照时不将它当已完成。未来再次手动完成覆盖旧快照。
- 先在任务详情逐项完成部分子项、再点底部〔✓ 完成整张任务〕时，`completion.cards` 仅记录点整张完成那一刻从 `待做/进行中` 变为 `已完成` 的剩余子项；后续整张任务〔重新打开〕只恢复这批剩余子项，此前单独完成的子项保持 `已完成`（回详情后仍可按行单独点〔取消完成〕）。
- 旧版0.3.1/0.3.0/0.2.5应能解析新任务字段并保留未知字段；退回期间看不到新版完成列表/撤销入口，不声称功能兼容。旧版修改后回新版，如状态或成员不再匹配就拒绝快照撤销，不覆盖旧版改动。
- 不能通过“字段存在”就默认数据兼容；实现前锁定旧schema，完成后执行源码与隔离原生往返，再决定兼容表。此ADR不提前承诺继续兼容所有旧版。
- 证据必须分为三类：旧schema.parse新任务/卡不抛；旧版read→改名称等已知字段→MdRepo.write后嵌套快照字段逐字段仍在；旧版改变成员/完成批次后交回新版，重新打开整次拒绝且不覆盖。三类分别报告，不能只跑parse就说“写回兼容”。

### 5. UI、历史与层次

- **任务详情双入口（需求第1条 + 第7条）**：
  - **行级子项完成/取消完成**：任务详情每行左侧方框改为可点击按钮 `<button className="st">`，右侧操作区对未完成项提供〔完成〕（与〔排进今天/明天〕〔开始〕并列）、对已完成项提供〔取消完成〕；点左侧方框或右侧按钮均触发同一子项完成/取消完成动作（`stopPropagation` 不误触行编辑）。
  - **底部整张任务完成**：任务详情底部并列〔✓ 完成整张任务〕〔冷藏〕〔放弃〕。新增任务“已完成”列表，显示主/支线、名称、时间、项数与〔重新打开〕；保持想法自己的已完成列表，不混成同一个实体列表。
- 插入/待确认只对关联的原任务或原卡禁用完成并说明原因；其他任务和待做子项仍可操作，不能照抄全局计时前置条件导致所有完成按钮灰掉。自由记录在计时中完成无关任务或待做子项，不改变其description、started_at或ended_at。
- 列表包含原有自动完成的支线任务，不只显示新版手动完成项；用结构化doneTasks取代仅名字的doneSides，不保留第二份相同完成任务数据。
- 只新增必要投影/回调：backpackProjection/store → BagScreen → BagDrawer/QuestDetail。界面不直接改文件或实现状态恢复。
- `backpack.completeTask` / `backpack.reopenTask`、`card.complete` / `card.reopen`、`auto.complete_task` / `auto.reopen_task` / `auto.complete_task_item` / `auto.reopen_task_item` 各一次用户动作一条历史；批量子项、停计时、腾位任务是effects。TASK语义比较白名单只加完成时间，**不加入completion**，避免text()把整份快照JSON打印成历史字段；任务/卡状态与完成时间照常比较。
- backpackService继续只用domain、tracking/api、既有deal刷新；不反向调用homeService、不嵌套根事务。
- 遵守架构“task领域不修改card”：domain/task/complete只构造Task完成元数据、验证快照并给出已核验ID集合；卡的完成/恢复纯转换放domain/card/transitions，由backpackService组合。task/complete不导入card/transitions，不在task纯函数里批量改卡，也不让backpack反向调用cardService。

## 验收

混合待做/进行中/原已完成/已放弃/旧已缩小；详情单行完成待做子项（不影响当前其他计时）、单行完成进行中子项（时间盒提前完成确认并停计时）、单行取消完成恢复待做（含主线5项活跃上限校验、已完成父任务原子恢复）；先单行完成部分子项再整张完成与重开只恢复本批；主线全部子项单行完成后仍留背包可再整张完成；支线最后一项单行完成后自动完成；批量完成停当前卡但保留其他活动；插入/待确认局部拒绝不写；重复完成/取消完成noop；满格拒绝/明确腾位/同事务故障恢复；旧快照/成员变化拒绝；兼容schema与旧版往返；GUI列表、确认、重新打开与跨MCP/CLI幂等。所有写入连同history/receipt进入同一journal，失败前不部分修改。

## Revision History

| 修订 | 日期 | 变更 |
|---|---|---|
| 草案 | 2026-11-07 | 任务完成与字段级恢复快照方案，Proposed |
| 1 | 2026-11-07 | 按任务侧审核S1–S5/N1–N4明确押注保留、完成顺序、纯转换边界、三类兼容证据、自动完成清格与局部计时限制；用户功能范围不变 |
| 2 | 2026-11-07 | 两侧定向复核通过，技术方案标Accepted；GUI原型已制作，用户确认仍待办，未开始实现 |
| 3 | 2026-11-07 | 纳入用户第7条（任务详情单行完成子任务与取消完成恢复待做 + 底部完成整张任务）：补充 §3b 共享纯转换 `completeCardItem`/`reopenCardItem`、单子项完成与取消完成事务、主线活跃容量校验、已完成父任务原子恢复及与批量快照联动 |
| 4 | 2026-11-07 | 吸收 @coder S1–S5 与 @coder-5 N1–N5：S1 明确 `completeTaskItemInTx` 归 `cardService`、`reopenTaskItemInTx` 归 `backpackService` 防反向边；S2 `makeRoom` 对象局部保护拦截插入原卡/pending；S3 已完成任务列表可进详情只恢复单个子项（不先调批量 reopen）；S4 明确父任务状态校验与 `noop`（含支线尾项重复完成、`noop` 带 `makeRoom` 拒绝 `MAKE_ROOM_NOT_NEEDED`）顺序；S5 暂停时间盒同须 `finishEarly`、使用真实 `pending_id/pending_at` 字段、主线容量跟随动态 `settings.mainItems` |
