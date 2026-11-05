# ADR 0021：今日任务板、插入、缩小拆分、接着做的存法与规则

状态：Proposed · 2026-11-05 · 待 pro-b-4 审核。需求来源 `docs/stages/0.3.1.md` v0.27（已定 1–55），流程图 `docs/stages/0.3.1-flows.md` v0.10，界面 `../UI风格规范.md` §11.14、§11.15。路径相对 `app/`。

## 背景

0.3.1 把任务卡改成「前一晚 / 早上排进今天 → 犹豫时从今天的板子里抽一张」。现在的数据里没有「今天要做哪些」「今天做多少」「优先级」，抽卡从整个背包里抽；做卡途中开始别的事会把卡放回待做；缩小是「父卡已缩小 + 子卡」，有级数上限；「还要接着做」会新建一张卡、从 0 计时；抽卡次数会把人推进降级休息。

约束：

1. **退回兼容**：ADR 0016 要求从 Beta 退回稳定版不坏数据。0.3.1 的退回基线是 0.3.0（v0.2.5 仍在 `AUDITED_COMPATIBLE_STABLE_VERSIONS` 里，见第 7 条）。0.3.0 / 0.2.5 的 `cardSchema`、`recordSchema`、`taskSchema`、`stateSchema` 都是严格枚举；`stateSchema` 是 `z.object` 不带 `passthrough`，会**丢掉**未知字段，但不报错；卡、记录、任务带 `passthrough()`，未知字段原样保留。0.3.0 每次事务读全部卡（`commit.ts`），任何一张卡校验失败，所有写操作都失败。
2. **不改 `schemaVersion`**（流程文档第 2 节例外条款）：不写迁移。
3. 0.3.0 / 0.2.5 只列 `records/ cards/ tasks/ reviews/ timelog/ history/ .journal/`，不扫数据根目录（计划 v0.3 代码核对），新目录会被忽略；应用内更新前的备份会把整个数据目录带走。
4. 分层与事务按 `CLAUDE.md`：picker 只由 dealService 调用；所有改动走 `run` + journal；`plans/` 的写入和卡、计时在同一份 journal 里。

## 决定

### 1. 今日任务板：`plans/<活动日>.yaml`，一天一个文件

```yaml
schemaVersion: 1          # plans/ 自己的版本号，和数据根的 schemaVersion: 2 无关
day: 2026-11-05           # 活动日（按 dayBoundaryHour），同文件名
skip_until_planned: false # 已定 49 提议 1：选了「这次先不排」，到当天结束或排进第一项为止
carried_confirmed: true   # 已定 4：昨天没做完的是否已经确认过（确认前首页 / 抽屉先问）
items:
  - card_id: 2f1c…        # 卡 id（板子上只放卡，不放任务；已定 9）
    priority: 高           # 普通 | 高（已定 1，v0.4）
    today_minutes: 60     # 时间盒才有：今天做 N 分钟；结果卡为 null（已定 2，v0.4）
    added_at: 2026-11-04T22:10:00+08:00
    carried_from: null    # 从哪一天带过来（已定 4、49 提议 6、7）
```

- **为什么不写进卡**：板子是「某一天的计划」，同一张卡可以今天、明天各排一次，量不同；写进卡里要么只能存一天，要么卡文件越写越长。卡、记录、任务的 schema 一个字段都不加，退回 0.3.0 时这些文件和 0.3.0 自己写的一模一样。
- **只存今天和明天**：〔今天 | 明天〕两块板子（已定 8）就是 `plans/<今天>.yaml`、`plans/<明天>.yaml`。过了换日时间，明天的文件就是今天的。旧文件不删，也不读（只用于将来的回看，0.3.1 不做）；保留期同操作历史 180 天，在同一个维护任务里清（ADR 0019 第 7 条，`historyService` 的 `maintain`）。
- **派生、不存的东西**：今天已计（按计时条目的 `card_id` 和活动日现算）、今日达成（结果卡：卡已完成；时间盒：今天已计 ≥ `today_minutes`，或卡已完成）、候选（下一节）。这样计时改了、日历里拖了，板子自动对得上，不需要 align。
- **读写**：新增 `data/planRepo.ts`（`MdRepo` 只认 `<目录>/<id>.md`，所以照 `StateRepo` / `ReceiptRepo` 的写法另写：读 `plans/<day>.yaml`、`createWrite` 交给同一份 journal）；严格 schema，坏文件按 `settings.yaml` 的做法报错不静默覆盖。`Transaction` 多 `plans`（只载入今天和明天两份）和 `savePlan()`。启动和每次事务都只读这两份。
- **板子上的卡被删除、放弃、冷藏**：这一项从板子上去掉（同事务）；卡完成了，项留着显示「已完成」。
- **退回 0.3.0**：`plans/` 被忽略，板子没了，卡、计时都在；0.3.0 抽卡回到从整个背包抽。再升回 0.3.1，`plans/` 还在，读回来接着用（中间在 0.3.0 里完成的卡按卡状态显示已完成）。

### 2. 抽卡：候选只来自今天的板子，按权重抽

`domain/picker/pick.ts` 改成：

1. 首页在插入中（第 3 节）、在主动休息中：不抽（`guide` 提示）。
2. 今天的板子没有项，且 `skip_until_planned = false`：返回 `{ kind: 'plan' }`，界面弹「今天还没排」。选「这次先不排」写 `skip_until_planned: true`，然后按现在的规则从整个背包抽（去掉阻塞、回顾卡、快到期、每日底线四步，只剩加权随机）。排进第一项时清掉这个标记。
3. 候选 = 板子上的项 − 今日达成的 − 卡已不在背包的 − 正在计的那张 − 本轮跳过的（`state.seen`，沿用）。候选空了但有被跳过的：开新一轮（`resetRound`，沿用）。全部达成：`guide`（今天都做完了）。
4. 权重 = 优先级（普通 1、高 3）× 主线 1.5。`MAIN_CARD_WEIGHT` 常量保留，加 `PRIORITY_WEIGHT = { 普通: 1, 高: 3 }`。不做设置项。
5. 去掉：阻塞先出（已定 12）、回顾卡（13）、快到期先出（15）、每日底线（已定 2）。`baseline` 只剩回看 / 底栏统计在用的话保留函数，不再被 pick 调用。
6. 翻卡（已定 51、52）只是界面：dealService 抽出一张后，界面把候选列表（`PickResult.candidates`，新加，只给界面用）背面朝上摊开再翻出抽中的那张。〔换一张〕= 现在的「再抽一张」（`redraw`），这张进 `seen`，不再算拒绝（见第 6 节）。
7. 完成后不再自动抽（现在完成后 `drawInTx`），回到 `blank`；用户想抽就去板子上点〔抽一张〕（已定 41：抽卡只在今日任务板上）。

### 3. 插入：做卡时开始别的事，卡等你回来

沿用 0.2.5 的插入机制（`resume_entry_id` 指向原来那条计时、插入条目 `kind: '插入'`、原来那张卡停在「进行中」），把它扩大到所有入口：

- **入口规则**（已定 21、22、25）：做卡时，`startFreeInTx`、`startPresetInTx`（不管预设的 `mode`）、小窗的 `editOpen` 新事件 / `startFavorite` / `continueEntry`、计时框的「最近的记录」都改走 `insertInTx`；自由计时时只有快捷活动和临时活动走 `insertInTx`，其余照常切换。判断「在做卡」= 当前开着的条目 `card_id !== null` 且是 `普通`，或已经在插入中（插入中再换一件事：替换插入条目，`resume_entry_id` 不变）。
- **设置**：快捷活动和收藏每一项的 `mode`（切换 / 插入）在界面上去掉，0.3.1 不再读它；`settings.yaml` 里照写原值，退回 0.3.0 时它照旧起作用。
- **回到任务** = 现在的 `resumeInTx`（卡接着计，插入的时间不算进卡）。
- **结束原任务** = 新的 `endOriginalInTx`：`resume_entry_id = null`；原来那张卡 `releaseCard`（回到待做，仍在今天的板子上，进度不变，已定 19）；插入条目改成 `kind: '普通'`（变成普通自由记录，接着计，已定 26）。自由计时时同样处理，只是没有卡要放回。
- **插入中不能抽卡**（已定 20）；从抽屉直接〔开始〕另一张卡：先自动「结束原任务」再开始那张（同一事务，历史记一条「开始卡」带连带改动）。
- **换日时还在插入中**：原来那张自动「结束原任务」（已定 49 提议 6 只管「还在计的卡」，插入中不算在计）。
- 状态文件 **不加字段**：插入中 = 开着的条目 `kind === '插入'` 且 `resume_entry_id` 指向一条带 `card_id` 的普通条目，现算。`home_mode` 不加枚举值（0.3.0 的 `stateSchema` 是严格枚举，加值会让 0.3.0 读不了 `state.yaml`）。
- 首页右上角的临时活动抽屉 `AwayDrawer` 由插入卡取代（ADR 0006 改为 Superseded，本 ADR 第 3 节接替）。

### 4. 缩小 = 把一张卡拆成两张（已定 50、54）

`domain/card/shrink.ts` 的 `shrinkCard` 改成 `splitCard(card, input)`，返回 `{ today, rest }`：

- `today`：**原来那张卡**改内容和时长（`content = 今天做的`，时间盒 `timebox_minutes` 改成「原目标 − 原今天的量 + 今天做的分钟」），id 不变，所以它的计时条目、板子上的那一项、正在计的状态都不用动；`shrink_level + 1`，`shrunk_from` 不变。板子上这一项的 `today_minutes` 改成「今天做的分钟」。
- `rest`：**新卡**，`content = 剩下的`、同类型、时间盒 `timebox_minutes = 原今天的量 − 今天做的分钟`、同 `task_id / project / tags / due_at`、`order` 紧跟在原卡后面（同任务内重新编号）、`status: 待做`、`shrunk_from = 原卡 id`、`shrink_level = 原卡 shrink_level + 1`。不在板子上。
- 时间盒的约束：`今天做的分钟 ≥ 今天已计`（向上取到 5 分钟），`剩下的分钟 ≥ 5`。结果卡两张都是结果卡、不分时间。两句内容都不能为空。
- **没有「已缩小」状态了**：原卡不变成 `已缩小`，所以 0.3.0 的 `restoreParent`（子卡完成后把父卡变回待做）对新数据不会触发。旧数据里已有的 `已缩小` 父卡照旧按 0.3.0 规则处理。
- **不设上限**：`settings.shrinkMaxLevel` 不再读，设置 02 去掉这一项；文件里照写，`shrink_level` 照加（退回 0.3.0 时，超过 0.3.0 上限的卡在 0.3.0 里只是不能再缩小）。`no_shrink` 不再读（只有降级链用过）。
- 卡的进度条按同一任务里的卡现算，`rest` 是新的一段，不需要额外字段。「从哪一项缩小来的」= `shrunk_from` 指向的卡的原内容：原卡内容已被改掉，所以 `today` 的原内容记在**操作历史**这一条的改前值里；`rest` 的提示文字读 `shrunk_from` 卡的当前内容加「（缩小前：…）」取自历史。界面只在鼠标提示里用，读不到就不显示（不为此加字段）。
- 0.3.0 读这两张卡：都是合法的待做 / 进行中卡，`shrunk_from` 指向一张非 `已缩小` 的卡，0.3.0 的 `restoreParent` 只在子卡完成且父卡是 `已缩小` 时调用（核对 `cardService.complete` → `restoreInTx`），不会抛错。**这一点开工第一步写测试锁定**（用 0.3.0 冻结的 schema 和 `restoreInTx` 跑一遍）。

### 5. 接着做：同一张卡（已定 5）

完成对话框里「还没做完，下次接着做」开着时：不记完成，`progress_note` 写这次的「做到哪了」、`progress_noted_at = at`，卡 `releaseCard` 回待做，停计时。不再 `continueCard` 新建卡，`continued_from` 不再写。板子上的这一项留着（今天可以再抽到它，除非时间盒今天已经计够）。回看的「完成的卡」只算 `已完成`（recapService 不用改，因为不再产生假的完成）。

### 6. 降级：只剩主动休息和缩小（已定 48、55）

- 删除按次数自动进入降级休息：`registerRefusalInTx` 不再被缩小、再抽一张调用；`refusals`、`last_rest_ended_at`、`rest_answers` 不再写新值（`state.yaml` 照写原值，0.3.0 要求有这些字段）。设置 02 的拒绝次数 / 窗口 / 重置 / 输入提示 / 潜意识次数五项界面去掉，文件照写。
- **主动休息**：首页〔休息一下〕= 新的 `homeService.restInTx`：等同快捷活动插入一条「休息」（系统项目「休息」，`kind: '插入'`），做卡时卡等你回来；回来就是〔回到任务〕，不问「刚才干了什么」，不计数。不用 `state.rest` / `home_mode: 'rest'`（那一套留给退回 0.3.0 时 0.3.0 自己用）。降级休息的两个漏洞（已定 14）随这套逻辑一起消失，不再单独修。
- `RestCard`、`returnFromRest` 的 0.3.0 数据：升级时如果 `state.rest` 不为空（用户在 0.3.0 里正在降级休息时升级），启动时按 0.3.0 的〔回来〕处理一次（不问回答），然后清空。

### 7. 兼容与回退汇总

| 文件 | 0.3.1 写了什么 | 退回 0.3.0 | 退回 0.2.5 |
|---|---|---|---|
| `plans/*.yaml` | 新目录 | 忽略，板子消失 | 忽略 |
| `cards/*.md` | 字段不变；缩小的 `today` 卡改内容和时长、`rest` 卡 `shrunk_from` 指向非 `已缩小` 卡 | 合法；见第 4 条锁定测试 | 同 0.3.0（待隔离实测） |
| `state.yaml` | 字段不变；`refusals` 等不再更新 | 合法 | 合法 |
| `settings.yaml` | 不新增键（底边 / 顶边见第 8 条）；去掉的设置项照写原值 | 合法，原值照旧起作用 | 合法 |
| `timelog/` | 插入条目 `kind: 插入 / 普通` 沿用 | 合法；0.3.0 若遇到「插入中但原来那张已结束」按 0.3.0 的〔回来〕显示 | 同 |

`AUDITED_COMPATIBLE_STABLE_VERSIONS` 里保留 0.3.0；0.2.5 要在 E9 隔离实测第 4 条之后再决定去留。

### 8. 新设置项：回去区域的位置（已定 34）

`insertBackPlace: 'bottom' | 'top'`，默认 `bottom`，放设置 06 外观。**这是 `settings.yaml` 的新键**：0.3.0 的 `settingsSchema` 是 `z.object(...).passthrough()`，未知键保留、不报错；0.3.0 写设置时 `{ ...original, ...value }` 也会带上它。0.3.1 读旧文件缺这个键时用默认值——这和 `CLAUDE.md`「只有缺文件的新目录使用默认值」冲突，按 `miniMode` 的先例在 schema 里用 `.default()`（`schemas.ts` 现有写法），并在 `CLAUDE.md` 那一条后面补「新加的键可以在 schema 里给 default，见 ADR 0021」。

### 9. 任务模式开关（已定 6，v0.4）

`taskMode: boolean`，默认 `true`，同第 8 条加 `.default(true)`，放设置 02。关掉：底栏没有〔背包〕的任务页（抽屉只剩想法池）、没有今日任务板和抽卡、做卡的入口全隐藏，回顾里不显示押注主线；计时、日历、列表、回看、想法池、快速记录照常。关掉时正在计的卡、插入中的卡照常可以回到 / 结束；数据都不删。

### 10. 操作历史动作（ADR 0019）

新增：`plan.add`（排进今天 / 明天）、`plan.remove`、`plan.edit`（改优先级 / 今天的量）、`plan.skip`（这次先不排）、`plan.carry`（确认昨天带过来的）、`home.endOriginal`（结束原任务）、`home.rest`（主动休息）、`card.split`（缩小，取代 `card.shrink`；改前值里有原内容）、`system.carry`（换日时还在计的卡自动带到今天）。`deal.draw` / `home.draw` 保留。板子的变化是不是「改了数据」按 `plans/` 文件前后语义比较（同 ADR 0019 第 1 条），只读打开抽屉不写盘。

### 11. MCP / CLI

本版不新增板子相关的写方法（用户没要求），附带需求的 `update_time_entry` 见执行方案 G8。`get_context` 的输出加 `today_plan`（只读：板子上的项、优先级、今天的量、今天已计、是否达成），方便 agent 知道今天排了什么；这是输出约定的扩展。`start_task_item` 在插入中调用：先自动结束原任务（同第 3 节界面〔开始〕的处理），结果里写明。

## 影响

数据：新增 `data/planRepo.ts`、`schemas.ts` 加 `planSchema` 和两个设置键；规则：`domain/picker/pick.ts`、`domain/card/shrink.ts`、新 `domain/plan/`（达成、候选、带过去、清理）；服务：`dealService`、`homeService`、`cardService`、`degradeService`（删拒绝计数调用）、新 `planService`、`homeProjection` / 新 `planProjection`、`scheduler`（换日带过去）、`historyCapture` 与 `shared/history.ts`；界面：`pages/home/*`（插入卡、去掉 `AwayDrawer`、休息一下、缩小对话框）、`pages/backpack/*` 改成抽屉（`widgets/` 或 `pages/home/` 下的抽屉组件，见执行方案）、`ui/frame` 去掉顶栏背包、设置 02 / 05 / 06。

## 验证

单测：`plans/` 读写与严格校验、坏文件报错；候选与权重（含 `skip_until_planned`、本轮跳过、新一轮、全部达成、插入中不抽）；今日达成的现算；带到第二天（保留优先级、量取较小、正在计的自动带、插入中的自动结束原任务）；所有入口的插入 / 切换判断表；结束原任务；拆分（时间盒的分钟约束、结果卡、id 不变、板子量跟着改、`rest` 不在板子上、不限次数）；**0.3.0 冻结 schema + `restoreInTx` 读拆分后的卡不抛错**；接着做不新建卡；主动休息不计数；`state.rest` 升级时的一次性处理；两个新设置键缺省时的 default 与 0.3.0 往返；历史动作和比较。实测：隔离身份真窗口走一遍一天（排明天 → 换日 → 确认 → 抽 → 插入 → 回到 / 结束 → 缩小 → 完成 / 接着做）；0.3.0 隔离 exe 读 0.3.1 写过的数据目录、写一次、再交回 0.3.1。
