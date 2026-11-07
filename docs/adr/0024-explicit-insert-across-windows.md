# ADR 0024：跨主窗、小窗的显式插入入口与内存草稿

状态：Accepted（v1.2，仅技术决定；GUI待用户确认） · 2026-11-07 · 对应 [0.3.2](../stages/0.3.2.md) 第3–4条。中等范围变更：扩展页面入口与跨窗数据流，用户已授权需求，技术复核已通过、GUI待看图确认；未实现。

## 问题、选择与边界

0.3.1 的 HomePage 局部草稿只覆盖卡。小窗普通输入的失焦提交与 beginPending 都会写盘，不能拿来承载“点按钮先落空插入卡、写好再提交”。自由记录普通 `mini` / `timerBox` 来源走切换，也不能把所有来源改成插入。

选择一个主窗所有的内存草稿协调器，三个入口共用；小窗保持只发命令、不访问业务目录。单加按钮并调用 `editOpen` 的补丁会提前写 pending、失焦提交并在自由记录下切错语义，因此不采用。无需新持久化模型、提交队列或MCP工具；ADR0023的35方法总量不变。

基础文档使用本项目的 `CLAUDE.md` 与 `../架构设计.md`（不存在通用模板中的 `docs/01-initial-project-structure.md`）。本决定沿用主窗单写者、同一commit/journal和小窗窗口权限，不反转架构决策。

## 1. 入口与可用状态

| 状态 | 显式插入入口 |
|---|---|
| 普通卡正在计时；卡暂停且有有效回到目标 | 显示 |
| 普通自由记录正在计时；自由记录暂停且有有效回到目标 | 显示，taskMode关闭也可用 |
| 已插入 / 插入暂停 | 隐藏，保留回到原事与插入暂停/继续 |
| 待确认、待机、未开始卡、休息态、无有效原事 | 隐藏，不建立无目标草稿 |
| 已有草稿 | 不再显示第二入口；其他窗口只显示草稿镜像与撤回 |

可用性由服务侧同一个纯判定投影给主窗和小窗，提交时在事务内重查，不靠各组件猜状态。现有卡头“待确认时仍可点插入”的边角统一为先完成/取消待确认；这是对现有做卡卡头的一并收紧，而非只限制新增入口。普通待确认输入及其起点不改。卡暂停仍可插入，不隐式恢复原计时。不可用时不渲染按钮，删除FusedCard的 `onInsertEvent ?? writeOther` 缺省动作，防止漏传回调仍露出同名按钮。

- 主窗融合布局：自由记录卡头右侧，与做卡同款30px高 `c-rest`〔＋ 插入事件〕。分开布局：自由卡/任务卡卡头同位置，不在计时条重复放一个按钮。
- 520×88小窗口、320×46 mini：黑色计时块中读数后、暂停/继续前，22×26px直角窄按钮，12px加号；无文字、title与aria-label均为“插入事件”。原暂停/完成尺寸和普通窗关闭按钮保持原规格。标题空间不足按原规则省略号，title可读全名。
- 草稿：主窗落下现有InsertCard；小窗名称原地变空输入框，读数从点击时刻走；正常动作替换为确认✓/撤回↩，小窗关闭仍可用。分类用现有控件，缺省未分类；名字沿用同一行内项目/标签解析。无收藏/最近/抽卡建议，避免从显式插入切到另一动作。
- 小窗草稿期间允许临时说明条“插在「原事」中间 · Enter记下 · Esc撤回”，使用现有fitMiniWindow适配屏幕可用区；不为输入唤出主窗。

## 2. 一个草稿、一个输入所有者

新增主窗内存协调器（组装于MainApp，生命周期同Ctx；不放入持久state或业务Snapshot）：

```ts
type InsertDraft = {
  id: string; epoch: number; owner: 'main' | 'mini'; ownerSession: string;
  at: string; expectedTimer: string; phase: 'editing' | 'committing';
  original: { entryId: string; cardId: string | null; title: string };
};
```

主窗分配UUID，保存草稿的身份/起点/原事信息；文本和项目只由owner的输入会话持有（main owner的表单状态提升到MainApp会话，mini owner留MiniApp）。非owner只显示“正在主窗口/小窗写插入事件”与撤回，不能另写一份文本。主窗拥有元数据权威，小窗拥有临时输入，不形成第二业务写者。草稿不需要随输入每字广播，也不复制原HomePage草稿逻辑；移除局部Draft状态，改用这一个协调器。

begin通过现有 `readSerial` 队列在队首核对epoch、输入会话、所见计时令牌和可用状态，再建立内存草稿；没有run、pending写入、history、receipt或revision变化。两个窗口同时begin先到者成功，后者明确提示“另一窗口正在写插入事件”，收到已有镜像，不能覆盖。readSerial不嵌套run。

小窗命令新增 `beginInsertDraft / commitInsertDraft / cancelInsertDraft`；begin携带按钮点击的at、epoch、ownerSession、expectedTimer和所见entry/card身份，commit/cancel绑定主窗发回的draftId。小窗挂载时生成ownerSession，ready携带它；主窗收到新的mini会话时撤销旧mini所有者草稿。保留旧命令身份字段，不把业务revision当草稿版本。

主窗本地也经协调器走相同流程。托盘隐藏、最小化、失焦、被遮挡以及主窗切日历/列表都保留草稿，回到owner窗口可接着写；MainApp持有main表单状态，不随HomePage卸载丢字。mini普通隐藏保留，点原型中明确的关闭×则撤回mini owner草稿（按键Esc/返回同样撤回），关闭非owner不影响草稿。主窗隐藏不影响mini owner。mini断联时现有3秒“主窗口未响应”照常显示，禁止提交；不添加草稿自动过期时间。

主窗重载/更换目录后epoch变化，内存草稿自然消失，所有旧命令拒绝；小窗已按epoch清理输入。mini崩溃未发cancel时，不靠超时猜测：下次ready的新ownerSession回收，或从主窗镜像撤回。主窗窗口内切页不终止mini草稿。

关闭语义补充：两种小窗经底栏〔关闭小窗口〕、M、托盘开关及520窗口×关闭都属于用户显式关闭，撤回当前mini owner草稿；320窗口本身不增加×。将这些路径统一接已有窗口开关，并把关闭原因传给草稿协调器（原生托盘路径同样必须通知），不能只在520的×处理。系统失焦/最小化/遮挡及主窗托盘隐藏不算小窗关闭，均保留；仅visible=false不足以猜原因，窗口事件需区分用户close与系统visibility。mini非owner关闭不撤main草稿。原型×的title明确“关闭小窗口并撤回草稿”；320的关闭路径按规范由底栏/M/托盘提供。

补充协议（v1.2）：MiniSnapshot增加 `viewSeq, timerStateToken, canInsert, insertDraft`，draft镜像含id/owner/ownerSession/at/phase/originalTitle/isCard，不包含另一窗口表单文本。begin/cancel在miniController分流到注入协调器，不落入dispatchMiniCommand的写事务；commit不带全局revision，只查epoch/draft/session/timer与目标。协调器 `onChange` 同步驱动主窗重绘及小窗push，不能只等业务publish。生命周期回收 `cancelDraftByOwner` 与用户显式 `cancelDraft(id)` 分开，前者仅作用相同owner/session且editing；通用visibility事件不调用MiniApp现有leaveEdit自动保存。新的ready仅回收旧mini editing草稿，不能取消committing。

暂停态 `original.entryId/title/over` 从resume_entry_id目标取（卡标题取card.content），另保存当前open身份供校验；不能把待机当原事。原事时长复用homeProjection对over的计算。镜像与owner草稿都禁用TimeField、普通名称编辑、Suggest和未落盘的暂停/结束原事；mini镜像分类不可点，主窗InsertCard显式mirror模式，不以draft缺省冒充已持久插入。分类选择后回输入，Esc先关分类层，再次Esc才撤回。

## 3. 状态消息排序与竞争

纯草稿变化不推进业务revision，现有 `(epoch, revision)` 不能排序它。给每次主窗push分配单调 `viewSeq`（仅内存、每个epoch从0起），MiniSnapshot带该字段；接收按 `(epoch, viewSeq)` 排序，revision继续仅用于原有编辑校验。发布/回执后的push/心跳共用同一push函数，必须在捕获对应视图时分配序号；不得旧草稿晚到复活。没有兼容旧二进制进程间混装的需求；主窗/mini来自同一程序。

每次同步捕获 `(ctx.snapshot(), coordinator.current())` 的同一刻 `++viewSeq`，然后才await emit；同epoch严格接收 `next.viewSeq > seen.viewSeq`，重复序号丢弃。心跳每次分配新序号而非重用。纯草稿onChange与提交publish若发生在同一提交，先协调元数据再发一个完整视图，避免半新业务/半旧草稿。

草稿包含 `timerStateToken`；begin及提交均用同一令牌算法。任何提交后投影若发现令牌变化（暂停、换事、改起点、插入、pending等）或原目标无效，则清草稿并推明确“原来的事已变化，插入未记下”。无关任务/历史写入和心跳revision变化不取消草稿；不要求全局revision相等。单纯改原事名称可刷新镜像标题，不覆盖owner输入。

cancel同样排入readSerial，先核对epoch/draftId；旧cancel不能清新草稿。commit在同一个run队列头校验草稿、ownerSession、timer token和有效目标，标为committing；其间重复Enter/迟到cancel/begin明确拒绝，不能产生第二次插入。成功后消费草稿；提交前失败保留文本、恢复editing或在原事已变时标明失效。

必须区分“事务未提交”与 `run` 的“已提交但后续投影/通知失败”：以实际commit结果与当前目标判断，不在持久化已成功后把草稿恢复为可重试。沿用现有提交阶段结果，不吞错误、不另造成功路径；回执丢失后从新快照确认，不自动重发写操作。

提交时序（v1.2）：共享commit执行器在transact成功后、任何projection/publish监听器之前调用注入的 `onCommitted`（或同义的结构化完成通知），以当前草稿id消费committing草稿；该消费暂不单独push，随后publish的同步取样看到“新插入 + 无草稿”。onCommitted是提交阶段通知，不承担业务写入；回调异常作为postCommit告警，不能伪装transact失败。projection本身失败时仍消费草稿并推“已提交但视图更新失败”的明确状态，禁止恢复editing。

为此把run的提交后告警封装成可识别的 `PostCommitError`（含committed=true、warnings及原结果），保持原错误文案与现有调用方抛错行为，不解析中文消息。transact失败可能已部分落盘、journal待恢复，不能直接允许重试：队列保持阻塞、输入保留但禁提交，重启按现有journal恢复。只有确认尚未提交且队列健康、原timer未变才恢复editing。不得新增第二套落盘判据。ADR0025复用同一结果语义。

提交结果契约补全（S6）：`PostCommitError<T>` 导出 `committed:true, data:T, committed_at:string, warnings:readonly CommitWarning[], projectionFailed:boolean` 与 `isPostCommitError` 类型守卫；projectionFailed由原warnings的phase派生。保留现有错误文案和throw行为，旧调用方不受契约扩大影响，新UI拿结构化字段判定。onCommitted阶段也纳入可观察的postCommit告警，不吞回调异常。

## 4. 唯一持久化入口与时刻

新增 `EntrySource = explicitInsert`，仅显式入口使用；纳入ALWAYS_INSERT，但服务先要求有有效原事且没有pending/insert/rest。保持普通mini、timerBox、favorite、recent、continue的现有规则，自由记录下仍切换。显式入口不是“允许在待机直接开始”的新能力。

新增homeService共享 `commitInsertDraftInTx`：校验后调用现有 `startOtherInTx(..., 'explicitInsert')`，同一根事务末尾align。main/mini都调用这一条，不在各适配器复制tracking逻辑。source不是让mini任意传入的开放字符串，由专用命令路由固定指定。

起点始终是按钮点击时捕获的 `draft.at`，不是Enter/回执时刻。新入口不接纳pending，故没有待确认起点优先级。草稿期间原条目在盘上继续开着；Enter成功后place把它截在draft.at，插入从draft.at起，resume保留原目标。取消则什么都不记、原计时连续。暂停原事插入时仅记录新插入段，点击之前的待机仍为待机。

时间边界（v1.2）：运行中普通原条目要求 `draft.at > open.started_at`；暂停原事要求 `draft.at >= open.started_at` 且有效resume存在；两者均不得晚于主窗当前时刻。begin在readSerial队首检查，commit在run队首重查。等毫秒/时钟倒退时明确报“原计时刚开始或时刻已变化，请重新点插入事件”，不建草稿、不静默+1ms、不静默把起点改成Enter。依据现有startInTx/place会删除0ms原段导致resume悬空的实证边界；仅约束新入口，不改旧source。run的at使用draft.at，避免claim把相同起点推迟到提交时刻。

字段校验沿用现有description/project/tags校验与行内解析，空名字不能提交；IME选字Enter不提交。不要复用会blur提交的InlineInput，不为本功能改变其他输入组件行为。草稿未提交时不提供暂停/结束原事，避免把未存在的条目当成已落账。

行内解析统一在 `commitInsertDraftInTx(tx,{text,project})` 使用parseEntryText，@项目优先，校验解析后有效正文，空正文明确拒绝，不两端复制解析。该事务返回新插入条目id，historyActions登记 `home.insertExplicit`、subject=entry/locate=result；begin/cancel不记历史。不要把被截断原条目误当主体。

## 5. 验证与交付

- 原型和截图：`../../../原型/页面/explicit-insert-prototype.html`、`../../../UI参考截图/0.3.2-explicit-insert/`；均是样例状态，不访问业务数据。看图同意后才实现。
- 领域/服务：卡/自由计时及其暂停、taskMode off、tight/loose；新source插入，旧source仍切换；Enter按click时刻截断、取消零写、返回接着原事；pending/idle/insert/休息拒绝。
- 协调器/总线：同时begin、旧cancel/旧session/epoch、同revision乱序push、无关写入不误取消、目标变化拒绝、连续Enter只写一次、提交失败与提交后投影失败、mini隐藏/重载、主窗隐藏与切页。
- GUI：两种主布局、520×88/320×46真实尺寸、长名称/分类/小时读数、分类点击不blur提交、IME/键盘/Esc、焦点与提示、屏幕上下弹层、断联重连。原生主窗隐藏时从mini完成整条流程，不唤出主窗。
- 生产实现与原生实测未开始；原型通过不等于以上服务和原生矩阵通过。不得新增未经证明的超时、截断或重试。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-11-07 | 依据需求第3–4条提出跨窗显式入口、唯一内存草稿与专用source；技术与GUI均待复核，未实现 |
| v1.1 | 2026-11-07 | 吸收需求侧S1–S3：不可用即不渲染；明确现有卡pending入口也收紧；托盘/最小化/切页保留表单、显式关闭mini才撤回，避免隐式丢字 |
| v1.2 | 2026-11-07 | 吸收自动化侧S1–S5/N1–N3：提交前publish消费时序、结构化已提交错误、journal失败阻塞、真实点击时间边界、暂停原目标/协议字段/history、镜像禁编辑、viewSeq严格排序与onChange；同毫秒明确拒绝而非改时间 |

技术审核依据：需求侧 `evidence/0.3.2-plan-review-insert.md`、技术侧 `evidence/0.3.2-plan-review-insert-automation.md` 定向复核；S6–S8已明写入方案。接受技术决定不代表用户GUI已确认或代码已实现。
