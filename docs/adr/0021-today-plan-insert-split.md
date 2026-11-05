# ADR 0021：今日任务板、插入、缩小拆分、接着做的存法与规则

状态：Proposed（修订 2）· 2026-11-06 · 第 1 轮审核 `evidence/0.3.1-plan-review-round1.md`（pro-b-4，3 阻塞 / 9 应改 / 7 建议）的处理见文末「审核记录」；待复核。需求来源 `docs/stages/0.3.1.md` v0.29（已定 0–55）、流程图 `docs/stages/0.3.1-flows.md` v0.10、界面 `../UI风格规范.md` §11.14 / §11.15。路径相对 `app/`。

## 背景

0.3.1 把任务卡改成「前一晚 / 早上排进今天 → 犹豫时从今天的板子里抽一张」。现在没有「今天要做哪些」「今天做多少」「优先级」；抽卡从整个背包里抽；做卡途中开始别的事会把卡放回待做；缩小是「父卡已缩小 + 子卡」，有级数上限；「还要接着做」会新建一张卡、从 0 计时；拒绝次数会把人推进降级休息。

约束（第 1 轮审核已对照代码核对，见报告「已核对属实」）：

1. **退回兼容**（ADR 0016）：0.3.1 的退回基线是 0.3.0（当前 `src/` 与 tag `v0.3.0` 相同）。`cardSchema` / `recordSchema` / `taskSchema` 带 `passthrough()`、状态值是严格枚举；`stateSchema` 是不带 `passthrough` 的 `z.object`，**未知字段会被丢掉**（zod 4.6.7 默认 strip，已在本机验证），`home_mode` 是严格枚举；`settingsSchema` 带 `passthrough`，`SettingsRepo.write` 先合并原文件。0.3.0 每次事务读全部卡，一张卡校验失败所有写都失败。
2. **不改 `schemaVersion`**，不写迁移（流程文档第 2 节例外条款）。
3. 0.3.0 前端只列各仓库自己的目录，不扫数据根，`plans/` 会被忽略；journal 恢复只检查路径安全，含 `plans/` 写入的残留 journal 0.3.0 也能恢复；应用内更新前的备份递归收集整个数据目录。
4. 分层与事务按 `CLAUDE.md`：纯规则放 `domain/`，`services/` 只编排；所有改动走 `run` + journal；`plans/` 与卡、计时在同一份 journal。

## 决定

### 1. 今日任务板：`plans/<活动日>.yaml`

```yaml
schemaVersion: 1          # plans/ 自己的版本号，与数据根的 schemaVersion: 2 无关
day: 2026-11-05           # 活动日（按 dayBoundaryHour），同文件名
skip_until_planned: false # 已定 49 提议 1：选了「这次先不排」，到当天结束或排进第一项为止（放这里不放 state.yaml：0.3.0 写 state 会丢掉未知字段，而且它本来就是按天的）
carried_from: null        # 这一天的板子从哪一天带过来的；null = 没带过 / 没有可带的
carried_confirmed: true   # 已定 4：带过来的项是否已确认
seen: []                  # 本轮〔换一张〕跳过的卡（见第 2 条第 4 点）
items:
  - card_id: 2f1c…        # 只放卡（已定 9）
    priority: 高           # 普通 | 高（已定 1，v0.4）
    today_minutes: 60     # 时间盒才有：今天做 N 分钟；结果卡为 null（已定 2，v0.4）
    added_at: 2026-11-04T22:10:00+08:00
    carried: false        # 这一项是从前一天带来的（确认前不进候选）
```

- **为什么不写进卡**：同一张卡可以今天、明天各排一次、量不同；卡、记录、任务的 schema 一个字段都不加，退回 0.3.0 时这些文件和 0.3.0 自己写的一样。
- **今天 / 明天** = `plans/<今天>.yaml`、`plans/<明天>.yaml`，「今天」**每个事务按 `tx.at` 现算**，不用启动时的日期。旧文件不删也不读（只为以后的回看），保留 180 天，并进 `historyService` 的 `maintain` 清理（ADR 0019 第 7 条）。
- **派生、不存**：今天已计（按条目 `card_id` 和活动日切）、今日达成（结果卡：卡已完成；时间盒：今天已计 ≥ `today_minutes` 或卡已完成）、行是否显示、候选。
- **板子上的卡离开背包**（放弃、PASS、冷藏、所在任务冷藏 / 放弃、0.3.0 里改的）：**不写盘移出**，投影和抽卡读的时候过滤掉（审核 S1）。这样 `plans/` 只在排进、移出、改量、改优先级、跳过、带过去、缩小时写，不新增 `backpack / card → plan` 的调用方向。卡回到背包（任务解冻）时，如果它的项还在今天或明天的文件里，就重新出现。
- **读写**：`data/planRepo.ts` 照 `StateRepo` / `ReceiptRepo` 的写法（读 `plans/<day>.yaml`，`createWrite` 交给同一份 journal）；严格 schema，坏文件报错、不静默覆盖。`Transaction` 多一个按需读的 `plan(day)`（同一事务内缓存）和 `savePlan(plan)`；每个事务至少读今天，抽屉投影读今天和明天，带过去时再读更早的一份。
- **退回 0.3.0**：`plans/` 被忽略；再升回来接着用（期间在 0.3.0 里完成、放弃的卡按卡状态显示 / 过滤）。

### 2. 抽卡：候选只来自今天的板子，结果不写首页状态

`domain/picker/pick.ts` 改成纯函数 `pickFromPlan(input)`：

1. 插入中、插入暂停、插入停了还在等（第 3 条三种状态），或 0.3.0 遗留的 `state.rest` 未处理：返回 `{ kind: 'blocked', reason }`，〔抽一张〕灰掉。
2. 今天的板子：
   - 没有文件或没有项，且 `skip_until_planned = false`：`{ kind: 'plan' }`，界面弹「今天还没排」。选「这次先不排」写 `skip_until_planned: true`，候选改为整个背包里待做 / 进行中的卡（`isCandidate`，沿用），只做加权随机。排进第一项时清掉这个标记。
   - `carried_confirmed = false`：`{ kind: 'confirmCarry' }`，先确认带过来的项（审核 S3）。
3. 候选 = 板子上的项 − 今日达成的 − 卡已不在背包或不是待做 / 进行中的 − 正在计的那张 − `seen`。候选空了但 `seen` 非空：清空 `seen` 开新一轮（同现在的 `resetRound`）。全部达成：`{ kind: 'done' }`。
4. 权重 = 优先级（普通 1、高 3）× 主线 1.5（`MAIN_CARD_WEIGHT` 保留，加 `PRIORITY_WEIGHT`），不做设置项。
5. 去掉：阻塞先出（已定 12）、回顾卡（13）、快到期先出（15）、每日底线（已定 2）。`baseline` 其余用处（`homeProjection`、`homeSlice`、`entityChanges`）开工时逐个核对，没人读了再删。
6. **结果只给界面，不写 `state.current_card` / `home_mode`**（审核 B3）：`dealService.drawFromPlan(ctx)` 是只读排队（`readSerial`），返回 `{ card, candidates }`，翻卡用 `candidates` 背面朝上摊开。界面上：
   - 〔开始〕= `startCard(card.id)`（同抽屉里的〔开始〕，一个写事务，历史 `home.startCard`，来源附「抽卡」）。
   - 〔换一张〕= `planService.skip(card.id)`：只把卡 id 写进今天板子的 `seen`，再抽一次。不再走 `cardService.redraw`、不要求 `requireCurrent`、**不累计 `skip_count`**、不推送「拆小或 PASS」提示（审核 N6：「跳过信号」属于降级机制，已定 48 去掉了，`skipSignalCount` 设置一并去掉）。
   - 关闭翻卡（Esc / 点遮罩）不写盘。
   - `state.seen` 不再使用（0.3.0 用的），0.3.1 不读也不写；`plans/` 里的 `seen` 是按天的，换日自然清空（审核 S3 最后一点）。
7. 完成后不再自动抽（`cardService.complete` 末尾的 `drawInTx` 去掉），`home_mode = 'blank'`。
8. `state.yaml` 里 0.3.0 留下的 `home_mode: 'review'` / `'guide'`：0.3.1 按 `blank` 显示（审核 S7 已定 13），`ReviewCard`、`GuideCard` 的首页渲染删除；`home_mode` 的写入只剩 `blank` / `task`。

### 3. 插入：做卡时开始别的事，卡等你回来

沿用 0.2.5 的插入机制（`resume_entry_id` 指向原来那条计时，`activeRefInTx` 在开着的条目不是 `普通` 时用 `resume_entry_id` 找卡，所以原来那张卡保持 `进行中`，`alignInTx` 不会放回待做），扩大到所有入口，并补齐「插入的事暂停 / 停了」两种状态（审核 B1）。

**三种插入状态**（不加字段、不加枚举；判断函数 `domain/timeline/insert.ts` 的 `insertState(open, resume)`）：

| 状态 | 开着的条目 | `kind` | `resume_entry_id` | 界面 |
|---|---|---|---|---|
| 插入中 | 插入的那件事 | `插入` | 原来那条（带 `card_id` 或自由记录） | 插入卡在计时，〔暂停〕〔停止〕 |
| 插入的事停了，还在等 | 待机 | `插入` | 原来那条 | 插入卡显示「已停 · 还在等你回去」，回去区域照常 |
| 不在插入 | 其他 | `普通` / `暂停` | 任意 | — |

- **插入的事「暂停」不做**：一条 `resume_entry_id` 已经被原来那条占着，表达不了「插入的事暂停后还能续上」。插入卡的按钮排只剩〔停止〕：停止 = 开一条 `待机 / 插入`（`startSystemInTx(tx, '待机', '插入')`），`resume_entry_id` 不动，插入卡进「停了还在等」。之后可以〔回到任务〕、〔结束原任务〕，或再开始一件事（又是插入）。这与原型（〔暂停〕〔停止〕）不同，**要用户确认**（见计划 v0.29 待确认第 1 条）；用户坚持要暂停，再加一个新文件存插入的回到目标。
- `assertEntries` 不拦「待机 + 插入」：它只要求待机不和别的条目重叠（`entry.ts:24-25`），与 `kind` 无关。`isIdle` 只看项目名。0.3.0 读到 `待机 / 插入`：`applicationController.ts:96-98` 进 `away`，`homeProjection` 把它当临时活动显示「待机」，〔回来〕走 `resumeInTx` 回到原来那张卡，行为合理。G1 锁定测试加这一种。
- **入口规则**（已定 21、22、25），判断放进 InTx 函数**内部**（审核 S4），调用方（MCP、小窗、日历、列表、计时框）不用逐个改：

| 正在做 | 快捷活动（`place: '弹层'`）、临时活动 | 计时框、小窗新事件、收藏（`place: '计时条'`）、最近的记录、日历 / 列表「继续这一条」 |
|---|---|---|
| 一张卡（`普通` 且 `card_id`） | 插入 | 插入 |
| 插入中 / 停了还在等 | 替换插入的事（`resume_entry_id` 不变） | 替换插入的事 |
| 自由记录（`普通`，非待机） | 插入 | 切换 |
| 待机 / 暂停 / 什么都没在计 | 直接开始 | 直接开始 |

  快捷活动和收藏靠预设的 `place` 区分（`presetService.ts:20-38`），不再读 `mode`（设置里照写原值，退回 0.3.0 时 0.3.0 自己读）。改动的函数：`startFreeInTx`、`startPresetInTx`、`continueEntryInTx`、`dispatchMiniCommand` 的 `editOpen` 新事件、MCP `start_break` 找预设的条件（`homeService.ts:271` 由 `mode === '插入'` 改看 `place`）。
- **MCP / CLI 在插入中**：`start_timer` / `start_break` 与界面一致，替换插入的事（`checkNormalPreconditions` 第 217 行对 `start_timer` 的 `IN_AWAY_ACTIVITY` 拒绝改成放行并走同一套判断）；`allowed` 表（`applicationController.ts:94-118`）和第 243 行提示同步，`away` 模式下 `allowed` 加 `start_timer`。`pause_timer` / `stop_timer` 在插入中：`stop_timer` = 停止插入的事（进「停了还在等」），`pause_timer` 拒绝（插入不支持暂停，同上）。
- **回到任务** = 现有 `resumeInTx`。
- **结束原任务** = `homeService.endOriginalInTx`：调 tracking 新导出 `promoteInsertInTx(tx)`（审核 S5，`timerService` 内部把开着的那条 `kind` 改成 `普通`、清 `resume_entry_id`，走 `place` / `acceptInTx`；停了还在等时开着的是待机，改成 `待机 / 普通`），然后 `alignInTx` 自然把原来那张卡放回待做（仍在今天的板子上，进度不变，已定 19、26）。自由计时时同样，只是没有卡。历史 `home.endOriginal`，主体是原来那张卡。
- **插入中不能抽卡、也不能直接开始另一张卡**（已定 20；计划 v0.7 第 6 条「直接开始另一张卡改成不允许」；审核 B2）：抽屉里卡上的〔开始〕、详情里的〔开始〕、板子行的〔开始〕在三种插入状态下都灰掉，提示「先回到任务或结束原任务」。MCP `start_task_item` 在插入中报 `IN_AWAY_ACTIVITY`（沿用现有错误码），`start_task_item` 不在 `away` 的 `allowed` 里。
- **悄悄结束原任务的路径（有意保留）**：`sleep`（`homeService.ts:91`）和离线结算（`timerService.ts:61-67`）会清 `resume_entry_id`，插入中发生时等于结束原任务；睡觉、长时间离线本来就意味着原来的事不接着了。两处历史都已有记录（`home.sleep`、`system.resume`），连带改动里显示原来那张卡回待做。
- **换日时在插入中**：第 6 条换日处理里自动「结束原任务」（同上调用），历史 `system.carry` 的连带改动。
- `cardService.leaveTo` 没有界面调用方（只剩历史目录登记），删除，同时删 `card.leaveTo` 的历史登记以外的引用（历史目录保留，旧记录还要显示）（审核 S4）。
- 首页右上角临时活动抽屉 `AwayDrawer` 由插入卡取代，ADR 0006 改为 Superseded（本条接替）。

### 4. 缩小 = 把一张卡拆成两张（已定 50、54）

`domain/card/shrink.ts` 的 `shrinkCard` 换成 `splitCard(card, input)`，返回 `{ today, rest }`：

- `today`：**原来那张卡**改内容和时长，id 不变，所以它的计时条目、板子上那一项、正在计的状态都不动。改内容走 `editContentInTx`（`cardService.ts:48-51`），开着的那条计时描述跟着改；之前的计时条目保留旧描述（审核 S6）。`shrink_level + 1`、`shrunk_from` 不变。
- `rest`：新卡，`content = 剩下的`、同类型、同 `task_id / project / tags / due_at`，`order` 紧跟原卡（同任务内重排），`status: 待做`，`shrunk_from = 原卡 id`，`shrink_level = 原卡 + 1`，`split_note = 原来的内容`（见下），不在板子上。
- **时间盒的分钟**：「原今天的量」= 板子上的 `today_minutes`；卡不在今天的板子上（直接开始的、「今天先不排」时）回落到「剩下的时长」= `timebox_minutes − 总已计`（审核 S6）。用户分成「今天做的 a」和「剩下的 b」，`a + b = 原今天的量`；`today.timebox_minutes = 原 timebox_minutes − b`，`rest.timebox_minutes = b`。约束：`a ≥ 今天已计`（向上取到 5）、`b ≥ 5`，并断言 `today.timebox_minutes ≥ 这张卡的总已计`。板子上这一项的 `today_minutes` 改成 `a`。
- 结果卡：两张都是结果卡、不分时间；两句都不能为空。
- **没有「已缩小」状态了**：原卡不变成 `已缩小`。0.3.0 的 `restoreInTx` 只在父卡是 `已缩小` 时改父卡（`cardService.ts:22-27`），对新数据不触发；0.3.0 的 `continueCard` 拒绝 `shrunk_from !== null` 的卡、完成对话框对它们不出「接着做」，所以 `rest` 在 0.3.0 里不能接着做，其余照常（审核已核对）。旧数据里已有的 `已缩小` 父卡照 0.3.0 规则处理（`restoreInTx` 保留）。
- **主线事项上限**（审核 S6）：`mainItems`（默认 5）数的是主线任务里待做 + 进行中的卡（`domain/task/pool.ts:10,17-18`）。拆分产生的 `rest` **允许超出上限**（已定 54 可以一直拆），超出时卡片上沿用现有 `overLimit` 显示（`backpackProjection.ts:29`），只限制「新建 / 加一项」，不限制拆分。`mainItems` 的设置描述（`sections.ts:20`）改成「缩小拆出来的不受限」，去掉「还要接着做」的续卡说法（S8）。
- **不设上限**：`shrinkMaxLevel`、`no_shrink` 不再读，设置 02 去掉；文件照写。
- **「从哪一项缩小来的」**（审核 N3，采纳）：`rest` 卡加可选字段 `split_note: string`（原来的内容）。这是**卡上唯一的新字段**：卡 schema 带 `passthrough()`，0.3.0 读写原样保留，不影响校验；不变量相应改成「不加 0.3.0 会拒绝的字段或枚举值」。`today` 卡不加字段，它的原内容只在操作历史 `card.split` 的改前值里。鼠标提示只读 `split_note`。
- 历史 `card.split`（取代 `card.shrink`），改前值有原内容、原时长、板子上的原量。

### 5. 接着做：同一张卡（已定 5）

完成对话框「还没做完，下次接着做」开着时走新的 `cardService.keepGoingInTx`：不记完成，写 `progress_note` / `progress_noted_at`，`releaseCard` 回待做，停计时。不再 `continueCard`，不写 `continued_from`。板子上这一项留着（时间盒今天没计够的还能抽到）。历史动作 `card.keepGoing`。回看的「完成的卡」只算 `已完成`，不用改。

### 6. 换日与带过去（已定 4、49 提议 6、7；审核 S3）

- 放进启动和换日共用的 `newDay()`（`bootstrap.ts:84-89`），在 `expireInTx` 之后调 `planService.rolloverInTx(tx)`；`scheduler` 已经在换日时调 `newDay()`，两路都覆盖，不另挂调度器。
- `rolloverInTx`：今天的文件不存在就建（读明天的那份作今天：前一晚排的「明天」就是今天）；然后找「今天之前最近的一份、且今天的 `carried_from` 为空」作来源（隔了几天才打开也只带最近那份），把来源里未达成、卡仍在背包、今天还没排的项加进今天，`carried: true`、保留优先级、`today_minutes = min(来源填的, 剩下的时长)`；有带过来的项就写 `carried_from = 来源日、carried_confirmed = false`。
- 换日时**还在计的卡**：直接加进今天（`carried: false`，已定 49 提议 6），不等确认。**插入中**：先结束原任务（第 3 条），原来那张卡按未达成处理、要确认。
- 确认：抽屉打开时今日任务板顶上一条「昨天还有 N 项没做完」，列出带过来的项，默认都勾着，〔确认〕〔全部去掉〕，逐项可去勾（已定 4：预先勾好，用户确认或去掉）。没确认前这些项不进候选，〔抽一张〕先弹这条（第 2 条第 2 点）。首页不另问。历史 `plan.carry`（用户确认）与 `system.carry`（换日自动建 / 带）。
- 0.3.0 遗留的 `state.rest`（用户在 0.3.0 降级休息中升级）：启动后的第一个事务（`newDay()` 里）按 0.3.0 的〔回来〕处理一次（`returnFromRest` 的条目部分，不问回答、不计数），然后清空，历史 `system.dayChange` 的连带改动（审核问答第 4 条）。

### 7. 降级：只剩主动休息和缩小（已定 48、55）

- 删除拒绝计数：`registerRefusalInTx` 不再被调用；`refusals`、`last_rest_ended_at`、`rest_answers` 不再写新值（`state.yaml` 照写原值，0.3.0 要求有）。设置 02 的拒绝次数 / 窗口 / 重置 / 输入提示 / 潜意识次数五项和 `skipSignalCount` 界面去掉，文件照写。
- 主动休息 `homeService.restInTx` = 插入一条「休息」（项目「休息」，`kind: 插入`），等同快捷活动；回来就是〔回到任务〕，不问、不计数。不用 `state.rest`、`home_mode: 'rest'`；`RestCard` 删除。已定 14 的两个漏洞随降级休息一起消失。

### 8. 兼容与回退汇总

| 文件 | 0.3.1 写了什么 | 退回 0.3.0 |
|---|---|---|
| `plans/*.yaml` | 新目录 | 忽略，板子消失 |
| `cards/*.md` | 拆分：原卡改内容和时长；`rest` 新卡带 `shrunk_from`（指向非 `已缩小` 卡）和可选 `split_note` | 合法、原样保留 `split_note`；`rest` 不能接着做 |
| `state.yaml` | 字段不变；`seen` / `refusals` 等不再更新；`home_mode` 只写 `blank` / `task` | 合法 |
| `settings.yaml` | **新增** `insertBackPlace`、`taskMode` 两个键；去掉的设置项照写原值 | 合法，新键原样保留、旧项照旧起作用 |
| `timelog/` | 新组合「待机 / 插入」（插入的事停了还在等） | 合法，显示为临时活动「待机」，〔回来〕回到原来那张卡 |
| `history/` | 板子改动记成 `type: card / state`（第 11 条），新动作名 | 合法（`type` 不加枚举值，`action` 是任意字符串） |

`AUDITED_COMPATIBLE_STABLE_VERSIONS` 保留 0.3.0；0.2.5 在执行方案 G9 第 5 条实测后决定去留。

### 9. 新设置键（已定 34、6；审核 S8）

- `insertBackPlace: 'bottom' | 'top'`，默认 `bottom`，设置 06 外观。`taskMode: boolean`，默认 `true`，设置 02。
- 写法：`shared/settings.ts` 的条目加 `defaultWhenMissing: true`，`schemas.ts` 的 `settingShape` 对带这个标记的条目统一加 `.default()`（enum、boolean 两个分支都处理），`miniMode` 改成同样用标记，不再按键名判断。`shared/history.ts` 的 `SETTING_LABELS` 加这两个键。`CLAUDE.md`「settings.yaml 是当前配置来源」那条补：「新加的键可以在设置定义里标 `defaultWhenMissing`，读旧文件时用默认值（ADR 0021 第 9 条）」。
- 已定 15 后没人读的 `dueSoonHours`（设置 01）一并从界面去掉，文件照写。设置 03 回顾日的描述改成「这一天开始，顶栏『回顾』可以开始本周回顾」（不再提首页回顾卡）。

### 10. 任务模式开关（已定 6）

`taskMode = false`：底栏〔背包〕只剩想法池页；没有今日任务板、抽卡、做卡入口；首页只有自由计时；回顾里押注主线这一步跳过（`reviewService` 的步骤列表按开关过滤，已押注的数据不动）；MCP `start_task_item` 报新错误 `TASK_MODE_OFF`、`find_items` 照常返回任务和卡（只读，供 agent 了解）、`get_context.today_plan` 为 null。关掉时正在计的卡、插入中的原来那张照常可以回到 / 结束 / 完成；数据都不删。

### 11. 操作历史（ADR 0019；审核 S2）

- 新动作：`plan.add`、`plan.remove`、`plan.edit`（优先级 / 今天的量）、`plan.skip`（这次先不排）、`plan.skipCard`（〔换一张〕）、`plan.carry`、`system.carry`、`home.endOriginal`、`home.rest`、`card.split`、`card.keepGoing`。`home.draw` / `deal.draw` 不再产生（抽卡只读）。
- **change type 不加枚举值**（`historyRepo.ts:12` 是严格枚举，0.3.0 读到新值会把整条记成读不出）：板子上某张卡的变化记成 `type: 'card'`、`id = 卡 id`、`field` 用「今日任务板」（排进 / 移出，值是「今天 / 明天 / —」）、「今天的量」、「优先级」、「换一张」；`skip_until_planned` 记成 `type: 'state'`、`field: '今天先不排'`；带过去的确认记在每张卡上。`historyCapture` / `domain/history/compare.ts` 加一路 `plans` 的前后比较，只读打开抽屉不写盘。

### 12. MCP / CLI

- 不新增板子相关的写方法。`get_context` 输出加 `today_plan`（只读：项、优先级、今天的量、今天已计、是否达成、是否带过来待确认），`mcp/compatibility.test.ts` 加一条旧 SDK 客户端读带 `today_plan` 的结果（审核 N7）。
- 插入中的行为见第 3 条；任务模式关掉见第 10 条。附带需求 `update_time_entry` 见执行方案 G8。

## 影响

数据：`data/planRepo.ts`、`schemas.ts`（`planSchema`、卡的可选 `split_note`、设置 `defaultWhenMissing`）；规则（`domain/`）：`picker/pick.ts`、`card/shrink.ts`、新 `plan/`（达成、今天已计、候选、带过去、清理）、新 `timeline/insert.ts`（三种状态、入口判断表）；服务：`dealService`、`homeService`、`cardService`、`degradeService`（只剩启动一次性处理）、新 `planService`、`homeProjection`、新 `planProjection`、`historyCapture`、`historyService.maintain`、`tracking/api.ts`（`promoteInsertInTx`）、`applicationController`；启动：`bootstrap.ts` 的 `newDay()`；公共：`shared/settings.ts`、`shared/history.ts`、`shared/backpack.ts`（`TaskDraft.items` 带类型和时长，已定 46）、`CLAUDE.md`；界面见执行方案 G7。

## 验证

单测：`plans/` 读写、坏文件报错；`pickFromPlan` 全部分支（`plan` / `confirmCarry` / `blocked` / `done`、候选过滤、`seen` 新一轮、权重）；今天已计跨活动日；带过去（最近一份、只带一次、量取较小、正在计的直接加、插入中先结束原任务）；`insertState` 三种状态和入口判断表（每个入口一行）；`promoteInsertInTx`；停止插入进「停了还在等」；拆分（分钟约束、不在板子上的回落、总已计断言、结果卡、id 不变、`split_note`、超出主线上限）；接着做不新建卡；主动休息不计数；`state.rest` 与 `home_mode: 'review'` 的升级处理；设置 `defaultWhenMissing`（缺键、0.3.0 往返）；历史 change type 与比较。

**G1 兼容锁定**（不依赖 0.3.0 exe）：0.3.0 的 schema 就是当前 `schemas.ts` / `stateRepo.ts`（`src/` 与 tag 相同），在测试里用当前 schema 和照抄的 `restoreInTx` 判断（注明来源 `v0.3.0` `cardService.ts:22-27`）校验：拆分后的两张卡、带 `split_note` 的卡、「待机 / 插入」组合、带新设置键的设置文件。这一步在动 schema 之前做，之后 schema 改了也拿冻结副本校验（冻结副本放 `src/data/migrations/v030/`，同 v1 的冻结做法，eslint 已允许 `data/migrations` 依赖 `shared`）。

实测：隔离身份真窗口走一天（执行方案 G9）；0.3.0 隔离 exe 读 0.3.1 写过的数据目录、写一次、交回 0.3.1。

## 审核记录

### 第 1 轮（pro-b-4，`evidence/0.3.1-plan-review-round1.md`）

| 编号 | 处理 | 落在哪 |
|---|---|---|
| B1 插入暂停 / 停止表达不了 | 采纳。停止 = `待机 / 插入`；插入的事不支持暂停，待用户确认 | 第 3 条状态表；计划 v0.29 待确认 1 |
| B2 插入中开始另一张卡与已定 20 冲突 | 采纳，按现有文档：不允许，〔开始〕灰掉，MCP 报 `IN_AWAY_ACTIVITY` | 第 3 条 |
| B3 抽卡写 `current_card` | 采纳：抽卡只读，不写首页状态；〔换一张〕只写板子的 `seen` | 第 2 条第 6 点 |
| S1 移出板子的调用方向 | 采纳：派生过滤，不写盘移出 | 第 1 条 |
| S2 历史 change type | 采纳：不加枚举值，记成 `card` / `state` | 第 11 条 |
| S3 换日只挂调度器、昨天不一定有文件、确认前是否候选、`seen` 不清 | 采纳 | 第 6 条、第 2 条第 2、6 点 |
| S4 入口区分与遗漏、MCP 在插入中、判断放 InTx 内部、`leaveTo` | 采纳 | 第 3 条 |
| S5 改 `kind` 没有 tracking 接口 | 采纳：`promoteInsertInTx` | 第 3 条 |
| S6 主线上限、不在板子上的量、总已计、编辑走 `editContentInTx` | 采纳：拆分允许超出上限 | 第 4 条 |
| S7 漏掉的已定 23、49-3、46、13、6、4、附带 3 | 采纳，逐条补进执行方案；13、6、4 也写进本 ADR | 第 2 条第 8 点、第 10 条、第 6 条；执行方案 G3 / G5 / G7 / G8 |
| S8 死设置项、`.default()` 写法、表格不一致 | 采纳 | 第 9 条、第 8 条表 |
| S9 `CLAUDE.md` 方向表 | 采纳；S1 改成派生后新方向只剩 `deal → plan`（读）、`home / card → plan`（写：开始、缩小、接着做时改板子）、`newDay → plan` | 执行方案 G2 第 1 条 |
| N1 规则放 domain | 采纳 | 第 3 条 `domain/timeline/insert.ts` |
| N2 冻结夹具位置 | 采纳，放 `data/migrations/v030/` | 验证 |
| N3 `split_note` | 采纳（卡上唯一新字段，`passthrough` 保留） | 第 4 条 |
| N4 `skip_until_planned` 放 `plans/` | 确认 | 第 1 条 |
| N5 抽屉在其他页面怎么打开 | 采纳 | 执行方案 G7 |
| N6 〔换一张〕的跳过信号 | 采纳：去掉 | 第 2 条第 6 点、第 7 条 |
| N7 `today_plan` 兼容测试 | 采纳 | 第 12 条 |
