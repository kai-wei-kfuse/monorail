# ADR 0023：0.3.2 自动化能力补齐与查询边界

状态：Accepted（修订4，两侧定向复核通过） · 2026-11-07 · 用户已确认0.3.2 A–D全量补齐及第7条子任务完成/取消完成，见 [当前需求](../stages/0.3.2.md)。前序自动化侧 [S1–S5/N1–N4](../../evidence/0.3.2-plan-review-automation.md) 已通过；修订3–4同步更新 `complete_task_item`（支持待做子项直接完成）并新增 `reopen_task_item`（子项取消完成恢复待做）且吸收 [v1.6 技术审核 S1–S5](../../evidence/0.3.2-plan-review-v1.6-coder.md)，两侧定向复核通过。沿用ADR 0011/0014/0019；任务与子项完成规则见 [ADR 0022](0022-task-completion-and-reopen.md)。

## 约束与选择

不在MCP或CLI复制业务规则，不从适配器读写数据目录。保留现有17个应用方法的请求/成功输出语义；新增能力由shared/application.ts契约、ApplicationController、既有services/InTx实现，两适配器并列调用ApplicationClient。

否决“在controller里调用现有根动作”补丁：会嵌套队列或把业务与receipt分成两次提交。应抽出缺失InTx，GUI根动作与runOperation复用；抽卡/统计/历史使用串行只读，不以run伪装查询。

### 1. 方法与CLI映射

现有17方法保留，拟新增19个（14写、5读），合计36方法（26写、10读）。数量只是审核对照，运行契约仍以applicationContracts为单一类型来源。

| 方法 | 类型 | CLI | 关键输入 / 输出 |
|---|---|---|---|
| get_task_plan | 读 | plan show --day today\|tomorrow | 解析后的活动日、enabled、板子项/优先级/量/已计/达成/带入确认/候选；不建plan文件 |
| add_plan_item | 写 | plan add <card-id> --day <date> | day、card_id、priority、可选today_minutes；复用plan.addInTx |
| remove_plan_item | 写 | plan remove <card-id> --day <date> | 复用removeInTx，移除不存在项noop |
| update_plan_item | 写 | plan edit <card-id> --day <date> | 至少一个priority/today_minutes，不改无关字段 |
| confirm_plan_carry | 写 | plan carry --day <date> --keep <id>… / --keep-none | 明确保留ID集合，非带入项不受影响；不把省略误读成全部移除 |
| skip_today_plan | 写 | plan skip-today --day <date> | 今天先不排，按现有全背包抽卡规则 |
| draw_task_item | 读 | plan draw | 加权只读抽取；card/need_plan/confirm_carry/blocked/done/guide结构化结果，不写current_card |
| skip_task_item | 写 | plan skip <card-id> --day <date> | 写seen/开新轮，返回板子状态；再调用draw取下一张，不把随机结果塞进一次写调用后又重新抽 |
| complete_task_item | 写 | item done <card-id> [--note …] [--finish-early] | 完成当前计时卡或背包任务中的待做子项；当前计时时间盒未达量须 `--finish-early` 确认，待做子项直接完成且不影响其他计时，返回变更卡/所属任务状态与timer |
| reopen_task_item | 写 | item reopen <card-id> [--make-room …] | 取消单个子项的完成状态并恢复为待做（校验主线5项活跃上限；若父任务已完成则同事务恢复父任务并支持显式腾位），返回变更卡/所属任务状态与timer |
| keep_going_task_item | 写 | item keep <card-id> [--note …] | 留进度、回待做并停当前卡计时，不新建续卡 |
| split_task_item | 写 | item split <card-id> --today-content … --rest-content … [--rest-minutes N] | 当前卡拆分，返回原/剩余卡ID、今天的量与timer |
| end_original_task | 写 | break end-original | 插入中结束回到目标，当前插入转普通；原来可能是自由记录，不仅是Task实体 |
| get_task_details | 读 | task show <task-id> | 完整子项/完成信息、completion_id、reopen_mode、原类别与恢复前置；避免给旧find_items严格输出增加字段 |
| complete_task | 写 | task done <task-id> | 整张主/支线完成，返回completion_id、affected_card_ids、腾格与timer |
| reopen_task | 写 | task reopen <task-id> --completion-id <uuid> / --legacy [--make-room …] | ID与快照绑定；满格显式腾位；返回reopen_mode、实际恢复卡ID与task |
| reopen_idea | 写 | idea reopen <idea-id> | 复用idea.uncomplete领域规则，满想法池仍允许，见ADR0020 |
| get_recap | 读 | recap show --period … --dimension … | 现有7周期×4维度、custom起止、含待机/睡眠和bucket；完整分组/明细/对比 |
| list_operation_history | 读 | history list --from-day … --to-day … [筛选] | 记录、bad_count、实际日期范围和older_before_range；只读 |

`get_task_details`是必要的完成/撤销发现入口：已有find_items只返回任务摘要，未携带当前completion_id/子项信息；不把恢复快照原文暴露为另一个写入来源。

### 2. 公共写入协议

- 每个写方法必填operation_id，复用runOperation：业务、history、receipt一份journal；相同规范化请求重放不重算随机数/时长、不执行InTx、不发布投影；同ID改目标/正文/日期/状态令牌/腾位对象必须OPERATION_CONFLICT。
- 输入trim、枚举、真正有效日期/时区、正整数分钟、非空ID/UUID、重复ID校验放契约/边界；业务允许状态放共享InTx，不能各适配器再造一套权限表。
- 缺字段表示不修改；null仅用于契约明确允许的清空。结果卡不能填分钟；timebox拆分的rest_minutes整数下限与当前已计约束按现有split规则。
- keep_going_task_item / split_task_item / end_original_task 必填 expected_state，由事务内现有 timerStateToken 共用检查函数比较；它仅保护计时目标/待确认/插入状态，不声称是任务/任务板版本。任务撤销另用 completion_id 校验其自身身份。
- complete_task_item / reopen_task_item / complete_task / reopen_task 允许传 expected_state（`optional`）：只在本事务会停止当前卡（例如 complete_task_item 目标正是当前计时/暂停卡，或 complete_task 目标任务含当前卡，或 reopen_task / reopen_task_item 的 makeRoom 对象含当前卡）时要求并校验，否则（例如直接完成待做子项，或取消完成不触碰当前计时的子项）不因无关计时状态变化拒绝。缺少所需令牌明确返回 STATE_REQUIRED；相同事务内重算受影响引用，不能在 controller 入队前判断后假定不变。
- A写操作和reopen_idea不强制expected_state；每次在事务内验证目标、日期、taskMode和合法状态。CLI不在STATE_CHANGED后刷新并静默重做。
- CLI有显式operation-id时，从已存在receipt恢复原始技术字段，同时保留本次业务参数参与冲突检查；新的日期/确认ID同样不能从“现在”重建并替换原请求。
- `resolveWriteMeta`的二值needsExpectedState应区分none/required/optional三种编排方式。complete_task_item / reopen_task_item / complete_task / reopen_task 属于optional：命中同方法committed回执且用户未显式给令牌时，回执有expected_state就还原原字符串，没有就保持省略。**不能抛RECEIPT_INCOMPLETE或补当前令牌**；required旧方法的缺令牌错误仍保留。显式令牌与任何本次业务参数都必须交服务端进行冲突比较，不能被回执覆盖。初次请求/尚无回执的optional操作，CLI仍可获取当前令牌，以满足可能停止引用的情况。
- 新写方法normalized与共享输入契约使用相同字段名；缺省expected_state不变成空字符串、null或多余键。必须测试MCP首次不带令牌提交、后来计时状态已变、CLI同operation-id重放仍成功，以及反向跨入口重放/显式换令牌冲突。
- 成功结果统一committed envelope，返回实际改变对象、noop（有意义的幂等状态）、next_operation_id、warnings；同一ID重放优先于现状态检查。已完成再完成noop不重写日期；不把所有业务错误吞成noop。
- 界面与适配器复用完整领域转换；card.complete/reopen/split抽成InTx时保留现有父卡/拆分/plan更新/计时对齐规则。批量任务完成不循环单卡根动作，见ADR0022。

### 3. 日期、任务模式和抽卡

- get_task_plan只解析today/tomorrow，输出实际ISO活动日与边界设置。A写操作及CLI的--day只接受真实YYYY-MM-DD，不接受today/tomorrow；在tx.at现算它对应今天还是明天。已不在可修改两日内时PLAN_DAY_CHANGED，不悄悄写到另一份文件；CLI不在重试时按本地时区重新解析相对日期。
- get_task_plan在单层readSerial回调内取as_of=ctx.now()，解析活动日后plans.read(targetDay)，结合同一已提交snapshot实体与当前时间索引重新计算minutes_today/achieved/drawable。不能直接转发Snapshot.plan的上次提交时读数。缺文件只用PlanRepo现有emptyPlan内存值，不落盘建文件。
- skip/carry/skip-card只作用当前今天；明天不提供抽卡/带入确认。今天/明天的add/remove/edit可按实际day解析；给明天填的today_minutes表示“那天的量”，延续plans模型。
- taskMode关闭：plan查询返回enabled=false与plan=null，不能和enabled=true但空板子混淆；plan/card/task写操作拒绝TASK_MODE_OFF，查已有task详情仍可读。end_original_task和现有return_from_break保留收尾能力；不以开关阻断回到原来那张卡。
- draw_task_item复用dealService.drawFromPlan与pickFromPlan，在drawFromPlan共享入口内检查taskMode，关掉时抛TASK_MODE_OFF（get_task_plan仍用enabled=false返回）。返回可消费业务DTO，不泄漏React组件状态；可以带候选ID/权重和reset_round，不模拟翻卡动画。重读允许重新抽取，不承诺只读随机请求重试返回同一张。
- 抽出pickFromPlan同源的候选计算：插入/遗留休息或待确认carry时不可抽；有板子项时drawableOnPlan；空板且skip_until_planned时用全背包isCandidate减当前卡。pick、skipCardInTx和API共用，不能让skip只计算plan.items。skip_task_item只写当前合法候选的seen；未知/已结束项CARD_NOT_DRAWABLE，未确认带入CARRY_CONFIRMATION_REQUIRED。GUI同用共用InTx；至少三张全背包卡的测试锁定seen累积与重开一轮，不再每次重置成单项。
- 随后的start_task_item仍是独立明确动作，用现有expected_state；draw不会预约或自动开始。服务不能在readSerial内部再调用readSerial而互相等待。

### 4. 当前卡、子项与任务操作的前置

- keep/split传明确card_id并在事务内核当前卡，不允许工具通过名称猜卡。共享InTx统一校验taskMode、rest、`Boolean(tx.state.pending_id || tx.state.pending_at)`、当前卡与insertStateInTx；插入中/插入暂停中明确IN_AWAY_ACTIVITY，不能到stopRef才静默切成待机。**卡自身暂停中仍允许完成/接着做/拆分**，不要把所有非普通kind都当插入。
- complete_task_item（对应ADR0022 §3b，`cardService.completeTaskItemInTx`）严格按实体存在→冷藏/已放弃父任务拒绝（`TASK_NOT_ACTIVE`）→`已完成` 子项幂等 `noop`（即使父支线刚自动完成，新 `operation_id` 重调仍返回 `noop` 不重写日期）→父任务 `inBackpack` 校验→两类合法目标：
  1. **当前首页关联卡（`tx.state.current_card === card_id` 含运行与卡自身暂停 `open?.kind === '暂停'`，或插入原目标 `resume?.card_id === card_id`）**：要求校验expected_state、rest、`Boolean(tx.state.pending_id || tx.state.pending_at)` 与insertStateInTx（插入中拒绝 `IN_AWAY_ACTIVITY`）；若为时间盒卡且未达目标时长（无论是运行中还是卡暂停中），默认返回 `TIMEBOX_NOT_REACHED`、`remaining_minutes` 与后续提示，`finish_early=true` 时允许提前完成；完成后停该卡计时并清 `current_card/home_mode`。
  2. **背包进行中任务下的待做子项（`card.status === '待做'` 且非当前首页/插入关联卡）**：直接完成该子项，保留原有 `progress_note`（除非显式传 `note`），不要求先开始计时，不触碰正在运行的其他卡、自由计时或插入事件，也不弹时间盒未达量提示；所属支线若无剩余活跃子项则经 `afterItem` 自动完成，所属主线保持在背包进行中。
- reopen_task_item（对应ADR0022 §3b，`backpackService.reopenTaskItemInTx`）：严格按实体存在→父任务冷藏/已放弃拒绝（`TASK_NOT_REOPENABLE`，绝不自动恢复或藏入冷藏任务）→`待做` 子项 `noop`（若同时传了 `make_room` 则拒绝 `MAKE_ROOM_NOT_NEEDED` 防误腾位）→`已完成` 子项恢复为 `待做`（清 `completed_at/day/track`，保留 `progress_note` 与历史计时，不自动开计时）。父任务在背包进行中时若传 `make_room` 拒绝 `MAKE_ROOM_NOT_NEEDED`，主线校验剩余活跃名额 `itemCapacity(task, tx.cards, limits) <= 0`（第三参 `PoolLimits` 取动态 `tx.settings.mainItems`，超限报 `MAIN_TASK_ITEMS_FULL`）；若父任务处于 `已完成`，同一事务内先校验 `itemCapacity <= 0`，再恢复父任务回原槽位（满格无 `make_room` 报 `TASK_CAPACITY_FULL`；`make_room` 对象同样执行局部计时保护：含插入原卡报 `IN_AWAY_ACTIVITY`、含 `pending_id/pending_at` 关联卡报 `PENDING_START_CONFIRMATION`，即便令牌匹配也不截断插入；保留 `bet_ends_at`，清 `completed_at/completion`）并仅将该子项恢复为 `待做`。
- keep与split的笔记/内容依照现有规则；不启动另一张卡来绕过“当前卡”约束。end_original_task只在真实插入状态允许，不等于stop_timer，不把任务Task实体标已完成。
- complete_task的整张任务批量完成与reopen_task遵循ADR0022（含 `make_room` 局部计时保护与已恢复任务传 `make_room` 拒绝 `MAKE_ROOM_NOT_NEEDED`），包括未完成项、一批快照、满格、计时与冲突规则。
- reopen_idea提取现有uncompleteInTx；不是从冷库revive，不触发对决、不误把已转任务想法放回池子。

### 5. 只读查询

- 统一从同一提交队列串行读取：snapshot、当前索引、plans/history必须属于同一已提交视图。扩展readSerial支持可选signal：入队前和出队执行前检查aborted，在排到队首后用assertQueueHealthy同时检查queue.failure与snapshotFailure；依赖snapshot的读入口再校验已就绪，分别报APP_NOT_READY/SNAPSHOT_UNAVAILABLE。不要在入队时因上一事务尚未发布的瞬间提前拒绝本可排队成功的读；也不要将此检查加到独立readOperation上阻断查询持久回执。
- drawFromPlan/checkSplit/history.list本来已排队，不在controller再套readSerial。需要复用已串行根读的内部计算时，拆出不排队的内部函数或直接调用唯一串行入口；不通过套根读制造死锁。各只读请求都传递signal，状态健康检查在真正读取前执行。不得运行newDay、reconcile、maintain/cleanup或写state。
- get_recap复用recapService/query与computeRecap，period/dimension只接受shared/recap已有值。日期使用z.iso.date等真实日期验证，拒绝2026-02-31；custom必须同时提供from/to，非custom禁止from/to。请求bucket必须确实存在于解析周期的result.buckets，否则INVALID_BUCKET；不能让computeRecap现有“未知桶→null全周期”或resolvePeriod现有“缺日期→今天”的行为吞掉错误。沿用宽松模式、系统项、并行和previous统计，不另写聚合算法。
- 现有回看缓存以分钟复用。RecapResult增加asOf，由computeRecap记录传入的原计算时刻；API computed_at=result.asOf，不能用历史周期的range.effectiveTo冒充计算时刻。命中缓存不得改成当前请求时间；序列化输出不就地修改共享缓存对象。
- 统计输出在API边界定义zod结构，不直接把未验证unknown当成功；时长整数毫秒、份额整数千分数，保留所有分组/rows。包括RecapBucket.byKey在内的动态名字→时长字典复用createDurationMapSchema，保护__proto__等合法名字。图表series既有Top8+其他是展示口径，不是把API明细截掉。
- list_operation_history用from_day/to_day（含端点，记录原有day），可按source.kind、agent.name、method、subject或operation_id筛选。source枚举manual/system/mcp/cli/automation，加all_automation时复用isAutomation匹配后三类。省略to_day在readSerial真正执行时按ctx.now()求当天；省略from_day取最终to_day之前6天，显式日期必须from_day≤to_day。延续GUI最近7日惯例，调用者可显式扩大，不增加隐藏行数上限。
- 复用HistoryRepo.readDays；过滤后返回全范围匹配项。bad_count表示该日期范围无法读取的记录数，不能把坏记录当成“没有历史”；older_before_range只表示范围前仍有历史，不伪装分页游标。不得改历史180天既有保留期或查询时触发清理。

### 6. 同步点与兼容

- shared/application.ts：input/output、contracts、request union、错误与DTO；client仍通用派生，不复制method switch。
- app/ApplicationController：分派、统一错误映射、checked InTx、只读查询与history intent；适当按A/B/C/D拆组装模块，禁止复制公共校验。
- buildTimerContext.allowed_actions补三项当前卡动作与away中的end_original_task，并与taskMode和实际前置保持一致；该字段原本是string[]，不新增旧输出字段。historyActions补14个auto动作（含 `auto.reopen_task_item`），end_original_task只有原目标带card_id时才指定card subject；原自由记录时使用正确entry主体或无单一card主体，不能伪造卡ID。
- Rust mcp_bridge.rs的is_write_method目前是只读名单。新增5读方法须一起更新及测试，否则会被当写操作占更新写锁。只读分类与contracts、MCP annotations作跨层一致性核验，未知方法维持现有拒绝路径。
- Rust名单的十个只读方法与applicationContracts.readOnly作跨层对齐检查，再用实际桥调用验证读不占更新写锁/写操作仍受屏障；不只做导出列表或工具数量断言。
- MCP registerTool、annotations、描述/错误后续指引；CLI parser/ParsedCommand/execute/help/output/JSON及重试字段；设置09能力列表、两份README、共享接口指南（当前开头旧称15方法须修正）、示例。
- 不修改已有17方法的必需字段、结果枚举或语义。新增方法不意味着旧客户端具备它们；旧客户端对新方法明确不支持，更新后重启AI客户端。现有find/context输出保持既有契约，避免旧ApplicationClient严格schema拒绝额外字段。
- 不新增生成超时、响应截断、隐式重试/降级或成功空列表。遇真实平台响应限制，先用证据证明并另作显式可分页契约，不在实现时暗加cap。

## 验收

每个新方法真实经过ApplicationClient校验→controller→服务，并在MCP双SDK/stdio/HTTP与CLI中有代表性语义场景；跨入口同operation_id重放/参数冲突，计时/日界/任务完成ID变化，待做子项完成与已完成子项取消完成（含主线5项上限、已完成父任务原子恢复与满格makeRoom），journal失败恢复、投影后置warnings；查询前后业务文件/receipt/history/revision不变；统计与GUI共享算法对照、多标签/并行/跨日/宽松模式、history坏文件计数与完整过滤；冷启动、分发包脱离源码路径、旧客户端既有17方法回归、版本改变后客户端重启说明。不得仅用工具数量/导出列表测试代替业务验证。

## Revision History

| 修订 | 日期 | 变更 |
|---|---|---|
| 草案 | 2026-11-07 | A–D全量覆盖、18新方法及共享事务/只读边界，Proposed |
| 1 | 2026-11-07 | 按自动化侧S1–S5/N1–N4明确可选令牌回执重放、插入/卡暂停区分、全背包候选共源、只读故障/取消/当前读数、统计参数拒绝静默回退与字典安全、日期/历史/动作/Rust分类联动；范围不变 |
| 2 | 2026-11-07 | 自动化侧定向复核通过，技术方案标Accepted；接口与功能范围不变，尚未实现 |
| 3 | 2026-11-07 | 联动需求第7条与ADR0022修订3：`complete_task_item` 扩展支持直接完成背包进行中任务的待做子项（`expected_state` 归入 `optional`），新增 `reopen_task_item`（`item reopen`，取消子项完成恢复待做，支持主线容量校验与已完成父任务原子恢复，共19新方法/36总方法） |
| 4 | 2026-11-07 | 吸收 @coder S1–S5 与 @coder-5 N1–N5：明确 `cardService.completeTaskItemInTx` 与 `backpackService.reopenTaskItemInTx` 职责归属；`make_room` 对象局部计时保护拦截插入原卡/pending；明确父任务状态与 `noop` 校验顺序（支线尾项重复完成 `noop`、已恢复状态传 `make_room` 拒绝 `MAKE_ROOM_NOT_NEEDED`）；暂停时间盒同须 `finish_early`、使用真实 `pending_id/pending_at` 字段、主线容量取动态 `settings.mainItems` |
