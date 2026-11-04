# 0.3.0-beta.3 开发方案：第三轮独立审核

结论：**不通过**。日期：2026-11-04。审核人：**GPT**。

审核基线：执行方案 v1.3、ADR 0019（Accepted）、需求计划 v1.18；仓库 HEAD 为 `d5aa28d4b59f0a7402d7695aafd00d0d647e10a7`，并保留现有未提交改动。前两轮结论仅供对照，不作为本轮证据。

发现 **3 项阻塞、10 项应改**。主要设计方向可以保留，但目前不能认定已经具备可靠的实施合同。阻塞集中在历史清理的冻结边界、快速记录补记的竞争和会话新旧判定。这里审核的是方案如何落地，不把 E3–E8 尚未实现本身当成缺陷，不要求改变已确认的产品规则或原型。

## 逐条发现

### G1：不经 journal 的历史清理没有加入提交、读取及更新备份的共同冻结边界

- **严重程度：阻塞**
- **涉及章节：** E8a.2、E8d.1/3、E9；ADR 0019 §7、§8。
- **代码证据：** `src/services/commit.ts:88` 的 `pauseCommits` 只排空 `queue.tail`；`src/services/updateService.ts:7` 在该屏障后启动原生安装；`src-tauri/src/update_backup.rs:240` 先递归枚举文件，`:265` 随后逐个读取；`src/data/journal.ts:22`、`:34` 分别校验恢复与提交前的原文；`src/services/commit.ts:202` 提交异常会封锁后续写入。
- **问题：** “不经 journal”不等于“可在任何时刻删除”。方案只说启动恢复之后和 newDay 时清理，没有规定清理任务是否属于同一队列尾部、更新冻结是否等待它、队列已有失败时是否禁止它、查询如何与删除互斥。明确反例：清理枚举旧历史后开始异步删除，同时用户安装更新；`pauseCommits` 没有等待这个队列外任务，备份已列出某文件，读取前文件被清理删除，安装前备份失败。查询的“经队列读取”也挡不住队列外删除。
  同样，历史并非绝对只追加，设置会 rewrite；不能以“只追加、不被业务引用”证明与 journal 无冲突。只读内存复现已证明：业务文件先写成功、历史 rewrite 失败留下 journal，此后若清理删除该历史原文，`recover()` 会报 `Recovery conflict`。这项复现证明互斥必要，不声称普通日期下清理必然选中最近的设置文件；还须覆盖系统时钟改变、延迟补写和故障恢复的边界。
- **建议改法：** 保持清理不经 journal，但把它作为同一个 Ctx 串行维护任务，登记进更新屏障会等待的任务链；恢复完成且队列健康才可启动，更新冻结后不再接纳，切目录/销毁时等待或停止旧任务。查询也使用同一串行读取边界，不能用会写 state 的 `run()` 冒充只读排队。以可控暂停点验证“枚举后删除/备份”“rewrite 部分提交后清理”“读取中清理”，而非仅验证单独删除成功。

### G2：快速记录的持久化标记没有解决“补记之前被其他根事务消费”的生命周期竞争

- **严重程度：阻塞**
- **涉及章节：** E8a.4、E8b.1；ADR 0019 §5。
- **代码证据：** `src/app/QuickBarApp.tsx:20` 先持久化记录，`:21` 还要等待 evidence 调用，`:22` 才发通知；`src-tauri/src/lib.rs:90` 以 create_new 写 records，不进入主队列；`src/services/commit.ts:166` 每个根事务都会扫描 records，`:220` 发布这些记录；`src/app/bootstrap.ts:66`、`:71` 从多个事件触发 reconcile；`src/services/ideaService.ts:54` 可删除想法，`:58` 可改正文；`src/services/recordService.ts:111` 是现有批量入口。
- **问题：** 标记在记录上，只能在记录仍存在时补记，不能保证保存动作的原始内容仍可恢复。允许的时序是：快速记录 R 已落盘、通知尚未处理（甚至 evidence 调用失败而没有 emit）→ 主窗口/MCP 的另一事务读取并发布 R → 手动编辑或删除 R → reconcile 才执行。删除时创建历史的唯一载体已消失；编辑后再补“新记录”则可能保存成编辑后的内容，无法满足“显示文字按当时生成”。简单的串行根事务不保护队列外先落盘的 R。
  此外，改成“先扫描候选、再每条入队”后，两个 data-changed/main-visible 的 reconcile 可同时扫描到同一 R。是否仍需补记，必须在**实际执行的那一条事务内**按最新记录重新判断；不能只依据入队前的候选对象。
- **建议改法：** 在方案中规定待补记录何时对其他业务入口可见/可修改，并提供同一队列内的先补记后消费机制，或能在记录删除后仍恢复原始保存事件的持久待办机制；不是改为 journal 外写历史。单条事务中重新取当前记录，原子检查 created_via/标记并更新，两个 reconcile 不能各补一次。测试加入“快速保存与 MCP 提交交错”“通知延迟/失败后编辑、删除”“两个 reconcile 同时处理同一 ID”“单条 journal 部分落盘后恢复”，不能只有顺序执行两次 reconcile。

### G3：把任意未见过的 UUID 当成新会话，无法判断连续重载后的迟到快照

- **严重程度：阻塞**
- **涉及章节：** E5.1、E5.4、E5 测试；需求 §1.3。
- **代码证据：** `src/platform/windowBus.ts:62` 是接收快照并维护本地修订的唯一入口；`src/services/miniController.ts:13`、`:35`、`:36` 分别从主动推送、提交和心跳发送；`src/services/miniProjection.ts:7` 目前只有修订号；执行方案 `:112` 生成随机 session，`:115` 只维护“当前会话 + 已退役集合”。现有接收代码的注释也明确承认事件可能交错。
- **问题：** 指定算法能处理“已看见 A → B → A 迟到”，不能处理“看见 A → 主窗口重载 B → 再重载 C → C 的快照先到 → 从未见过的 B 最后到”。此时 B 不在退役集合，会被当成新会话接纳，C 反被退役；之后 C 的正常心跳全部被丢弃，又造成持续假报。随机 UUID 无新旧次序，退役集合只记见过的会话，不能解决这一反例。
- **建议改法：** 在主窗口权威会话来源增加可比较世代（生命周期跨前端重载），或通过与当前主窗口关联的握手确认新会话；未知 session 不能仅凭“不同”即淘汰当前会话。明确订阅重建后的状态生命周期，不靠任意裁剪退役集合解决。增加 A→C→迟到 B、首次订阅乱序、连续 F5 与切目录交错的自动测试，再做真窗口验收。

### G4：小窗的读数编辑有独立状态，当前“清掉编辑”的落点不足以证明跨会话安全

- **严重程度：应改**
- **涉及章节：** E5.5–6、E9 D4。
- **代码证据：** `src/app/MiniApp.tsx:27` 的 edit 仅管理名称编辑；`src/pages/home/TimeField.tsx:34`、`:40` 另存读数 draft/target，`:46` 还生成异步确认回调；`src/app/MiniApp.tsx:145`–`:148` 提交读数时取最新 revision；`:166` 的 TimeField 没有会话 key。当前 `MiniReply` 以 requestId 匹配，见 `src/platform/windowBus.ts:36`、`src/app/MiniApp.tsx:36`。
- **问题：** 同目录 F5 后 entry ID 通常不变。若只重置 MiniApp.edit/note/error，TimeField 仍持有旧会话读数草稿；提交时却可能被最新 revision 和新的 session 重新盖章，旧编辑变成合法的新会话操作。还有“结束旧 waiting Promise → 旧 .then/onNote 稍后写回错误/确认”的异步竞态。仅测试 windowBus 的修订过滤不能覆盖这些。
- **建议改法：** 明确按 session 重建读数编辑组件或把编辑基准会话传入请求；所有异步完成回调先核对发起会话再改 UI。测试旧草稿、新旧 entry ID 相同、旧确认回调、会话切换后旧回复/拒绝晚到。**不把‘回复缺少 session’单独判为错误**：唯一 requestId 和清空等待表已能挡住一部分旧回复，真正要验证的是完整异步状态链。

### G5：小窗“完成卡片”的最终写入不发生在 dispatchMiniCommand，来源会丢在主窗口交接处

- **严重程度：应改**
- **涉及章节：** E8b.1 小窗来源、E8a 动作目录与参数化测试。
- **代码证据：** `src/services/homeService.ts:167`–`:171` 的 complete 分支只返回完成意图；`src/services/miniController.ts:23` 转交 effects.complete；`src/app/MainApp.tsx:154` 只保存 at 并跳首页，忽略参数 cardId；`src/app/actions.ts:25` 最终调用普通 `card.complete`；真正保存卡和计时变化在 `src/services/cardService.ts:80`–`:90`。
- **问题：** E8b 只要求给 dispatchMiniCommand 标 `{via:'mini'}`。这个事务可能无实质改动而不记，后续确认完成的根事务默认来源却是 main。用户从小窗完成的卡就会错误显示为主窗口操作，单给 run 必填动作名不能修复。类似两段式动作也需要追踪来源，而不能借全局一次性标记。
- **建议改法：** 把 `{session, source, subjectId, at}` 随完成流程显式传到最终的根事务，并验证交接时目标仍相符。测试必须从小窗命令起步、经历主窗口完成对话框，最后检查那条真正改数据的历史；不是断言中间 dispatch 带了 source。

### G6：E6 准备直接复用的 splitAtDays 有可复现的 DST 分桶错误

- **严重程度：应改**
- **涉及章节：** E6.1 周期裁切/分日、E6 测试；需求 §1.6。
- **代码证据：** `src/domain/timeline/day.ts:13`–`:17` 先 setHours 再在同一个 Date 上 setDate；`src/shared/time.ts:7`–`:18` 规定本地日界与日历日推进；`src/shared/settings.ts` 的 dayBoundaryHour 允许 2；`src/domain/timeline/stats.ts:165`–`:167` 的裁切结果在独立字段中。
- **问题：** 已在仅内存的 Node 子进程中执行实际 day.ts 代码：`TZ=America/New_York`、日界 2，切分 `2026-03-08T01:00:00-05:00` 到 `2026-03-09T03:00:00-04:00`。3 月 8 日不存在 02:00，setHours 被规范化成 03:00，随后 setDate(+1) 把**次日**也保留成 03:00。结果把 `2026-03-09 02:00–03:00` 仍归到活动日 3 月 8 日，错一小时。不能因一般跨日测试通过就认定可直接复用。
  改 dayBoundaryHour 后，回看按当前设置重算，历史记录的 day 则是写入时已保存的分组键；二者不能混用。周期/上一期按日历日计算，不能用固定 24 小时模拟 DST 日。
- **建议改法：** 按目标日历日期分别构造该日的日界，不能把跳时日被规范化的小时带到下一天；统一“当前本地时区 + 当前 dayBoundaryHour”的现有口径并记录验证条件。测试春季跳时、秋季重复小时、23/25 小时日、月/周桶边界、运行中改日界及重启；这些是纯计算测试，不必等真窗口。消费 clipEntriesInRange 时必须用 clipped_start/clipped_end，原 started_at/ended_at 并未被它替换。

### G7：平均分摊没有规定毫秒精度与余数归属，严格合计不变量尚不能验收

- **严重程度：应改**
- **涉及章节：** E6.1 原子区间与多标签分配、E6 完成标准。
- **代码证据：** `src/shared/time.ts:22`–`:26` 的 unionLength 以毫秒合并，`src/domain/timeline/stats.ts:150`–`:167` 产出整数毫秒裁切；执行方案 `:136`–`:139` 指定 Δt/k 后再按标签 1/n，且要求各组合计严格等于覆盖时长。
- **问题：** 1000ms 三条并行，每条若取整为 333ms，合计只有 999ms；每段独立取整后跨桶、多标签再取整会累积差额。即使内部保留浮点，逐组格式化 HH:MM 或百分比时也可能出现“图例合计”和总数不一致。当前只列三条重叠/多标签案例，没有精度和误差标准。
- **建议改法：** 明确保留精确份额到聚合末端，或使用有确定次序的余数分配；不得每条、每段各自四舍五入后直接相加。相同基础分配供图表/列表/主线卡共用；定义内部毫秒与显示舍入的各自不变量。覆盖 1ms、1000ms/3、多标签、跨日跨桶及不同输入排序，检查不丢时间、不随遍历顺序漂移，不改变平均分摊的产品规则。

### G8：保留快照与“只比较改动对象”尚无具体接口，逐条补记的开销被明显低估

- **严重程度：应改**
- **涉及章节：** E8a.3–4、E8b.1；ADR 0019 §4；E6 性能与 E9。
- **代码证据：** `src/services/commit.ts:164`–`:186` 载入整套实体与设置；`src/services/entityChanges.ts:5`–`:18` 的 changed Map 是私有闭包，未公开变更 ID；`src/data/timelogV2Repo.ts:16` 只摊平数组、不克隆条目，`:38`–`:50` 对全部条目校验/分组/比较；`src/services/homeService.ts:46`、`:51` 直接改 tx.state；`src/services/commit.ts:217`–`:225` 每次发布又克隆实体。
- **问题：** “保存 before 引用”会与可变 state 共享对象，保存整个 Transaction 又不能 structuredClone 函数/repo；完整深克隆和全量比较则不满足 ADR 所称“耗时与改动量成正比”。方案没有指定快照隔离及 dirty ID 的获取方式。
  N 条快速记录各自完整 execute，会执行 N 次 cards/tasks/reviews/records 列举读取、全量计时校验和投影发布；MdRepo 的 cache 仍在 get 中先读文件，不是零 IO。现有 reconcile 一次完成整个循环，故改动不是仅多写 N 个小历史文件。只测“一年 1 万条的一次回看 <50ms”覆盖不了此成本。
- **建议改法：** 定义小型可变 state/settings 的隔离 before、实体不可变引用约束，以及通过既有变更收集器提供变更实体集合的接口；不要让 services 解包 Write 的 path/text。对逐条补记明确排队、候选重新校验与发布策略，保留每条事件原子性。增加长期数据 + 多条待补记录 + 并发到达的整段耗时、读次数、峰值内存与队列等待证据；不得用条数截断或静默漏记降低开销。

### G9：跨对象主体与设置合并只定义了标题合同，没有定义完整 changes/effects 的合并规则

- **严重程度：应改**
- **涉及章节：** E8a.1/3/4/5；ADR 0019 §3–4。
- **代码证据：** `src/services/settingsService.ts:29`–`:30` 改 ideaExpireDays 会同时改 records 并 refresh；`src/services/cardService.ts:94`–`:103` 缩小同时改父卡、新卡、计时和状态；`src/app/applicationController.ts:475` 创建待办时同时产生 record/card/task，`:626` 新增时间条的主体 ID 在 work 内才生成；`src/services/recordService.ts:54` 还可能复用并改写已有占位卡。
- **问题：** ADR 说没有 subject 时“按动作目录主体类型”，但 E8a 只列 action 联合与中文名，没有规定实体类型/ID、创建后怎样回传主体、批量操作和父子卡的归属。设置合并只说更新改后值和 merged；若第一次设置让 10 条想法入冷库、第二次设置又有不同连带变化，简单覆盖上一条 effects 会丢第一次改动，简单保留又可能留下错误终态。
- **建议改法：** 动作目录明确主体类型和定位键，允许由 work 结果/生成 ID 确定主体；每类跨对象动作提供实际期望 changes/effects，不仅断言 action ID。设置合并以实体/字段身份累计首次 before、末次 after，保留只在某次发生的连带改动并定义往返修改展示；保留 ≤60 秒同项合并规则，不丢业务改动。

### G10：系统设置副作用在 journal 之前执行，新增历史不能自动给它提供事务保证

- **严重程度：应改**
- **涉及章节：** E8a.4、E8b 手动设置、ADR 0019 记录口径与失败测试。
- **代码证据：** `src/services/settingsService.ts:27` 在 work 内先生成 settings Write，再 await apply；`:18`–`:20` 涉及快捷键/开机自启/置顶；`src/platform/settings.ts:13`–`:15` 真正改变系统；`src/services/commit.ts:202` 的 journal 在这之后才执行；`src/services/settingsService.ts:43`–`:48` 仅在启动/恢复重新应用持久配置。
- **问题：** 系统调用成功后，后续领域逻辑或 journal 失败时，OS 已变，settings/history 却没有成功提交。语义比较只能观察事务实体，不能把外部副作用回滚；把这种情况都描述为“失败没有改动所以不记”不属实。这是已有边界，本轮扩大“所有设置改动可追踪”的承诺后必须正面处理。
- **建议改法：** 明确持久设置提交点、平台应用阶段、失败补偿/重启重放规则与用户可见结果。可在提交后按持久配置应用并把应用失败作为显式后续处理错误，或设计有证据的补偿；不要声称 JS journal 与 OS 操作天然原子。补平台拒绝、平台已成功但持久化失败、恢复后重放三类验证，历史依据真实持久业务提交判断。

### G11：保留算法实际留下 181 个活动日，且延迟补记可能重新制造过期文件

- **严重程度：应改**
- **涉及章节：** E8d.1；ADR 0019 §5、§7。
- **代码证据：** `src/shared/time.ts:15`–`:18` 提供日历日推进；`src/domain/timeline/day.ts:1`–`:5` 生成活动日；执行方案 `:228` 和 ADR `:84` 删除 day < 今天活动日−180；快速记录历史按创建时刻落入旧 day，执行方案 `:203`。
- **问题：** 按该比较式，今天算第 0 天，保留 −180…0，共 181 个日期桶，不是包含今天的最近 180 个活动日。若主窗口很久没有补记，启动清理先完成、随后才把很早的快速记录补入旧 day，这份过期历史还会留下直到下一次清理。当前测试只写“跨 180 天被删、当天不删”，容易漏掉边界与补记顺序。
- **建议改法：** 明确 180 天对应的半开边界，按已定保留规则精确落实现有日历日函数，测试 cutoff 前/恰等于/后一日。补记和保留在同一串行维护流程协调：过期事件如何完成标记而不反复补造历史，应有确定规则和证据；不能通过清理 records/receipts 解决。

### G12：回看缓存未包含 asOf/时钟，开放计时条目会使总数与相对周期过时

- **严重程度：应改**
- **涉及章节：** E6.3/6、E7 查询与恢复选择。
- **代码证据：** `src/domain/timeline/stats.ts:134` 的裁切需要显式 asOf，`:150` 以 asOf 作为未结束条目的终点；`src/services/commit.ts:213` 的 dataVersion 只在提交后增加；`src/services/reviewProjection.ts:31`–`:34` 当前以 at 裁切；执行方案 `:149` 只列 dataVersion + 查询参数记忆。
- **问题：** 一条活动持续计时而没有事务时，dataVersion 不变，但有效投入和分摊结果随时间变化；按指定 cache key 会一直显示首次查询的值。跨相对周期边界、系统时区改变也不只是参数变化。仅说明“下次打开按当天重算”不足以保证页面持续打开时正确。
- **建议改法：** 让查询接收一致的 asOf，把活动计时/周期边界的刷新纳入缓存失效规则，并区分静态历史区间和包含当前时刻的区间，避免每帧聚合全历史。测试不提交业务的情况下推进时钟、跨月/周/活动日、改变日界后重查；缓存不得复用不同 ctx/数据目录的相同修订号结果。

### G13：实施依赖与验收证据仍有空档，不能按当前完成标准直接关项

- **严重程度：应改**
- **涉及章节：** §2 阶段表、§6 接口约定、E8/E9；ADR 0019 验证与兼容。
- **代码证据：** E5 在 `src/services/commit.ts:57` 增 session，E6 在 `:25` 增 Snapshot.reviews，E8 又修改 `:112`/`:120`/`:146` 全套执行签名；`src/data/journal.ts:36`–`:39` 是先持久计划再顺序写文件，不是失败即回滚；`src/services/commit.ts:114` 允许数据已提交后向 UI 抛后处理错误。旧标签 `v0.2.5:src/data/journal.ts:19`–`:48` 同为 roll-forward；`v0.2.5:src/data/mdRepo.ts:45` 和 schemas 的 passthrough 支持新增字段保留，但不等于全部回退组合已验。
- **问题：**
  1. E5/E6/E8 共改 Ctx/commit，§6 的关键接口却留到“开工时填写”；E8a 还一次覆盖根事务、十个自动化写入口和大量测试。功能可并行不等于共享合同可各自修改，应先定公共接口与改动所有者，拆出集成依赖。
  2. ADR 验证要求“journal 写入失败时两者都不落盘”，对 apply 中途失败并不成立。本轮实际内存复现中业务文件已落盘、历史 rewrite 仍是旧值、journal 留存；正确标准应是阻塞读取/后续写并在恢复后两者一致。响应丢失、post-commit warning、未提交拒绝也不能混成一种失败。
  3. v0.2.5 的既有实测清单方向正确，但还应包含“设置历史 rewrite 的 before 非 null 且业务已部分写入”“补记 record 标记/卡片/历史的不同中断点”，完成恢复后再回到 beta.3 核对不重记、不丢记录。新旧客户端与新旧桌面的 wire 兼容是另一项，不能由数据目录兼容替代；已有常驻 beta.3 MCP 进程遇到回退 beta.2 桌面的严格旧 schema 时，新增 origin 可能被拒绝，应实测并明确客户端重启要求，不能静默伪成功。v0.2.5 的数据兼容也不等于它具备 beta 版的自动化服务。
  4. `walk()`/vi.mock(react) 不验证浏览器真实焦点、键盘组合输入、CSS 命中、主窗口重载/小窗异步时序或原生文件持久化；“旧版纯源码审计”和“真安装版回退实测”也必须分开签字。
- **建议改法：** 先冻结 E5/E6/E8 的共享合同、来源传递和串行维护接口，再允许 UI 与独立算法并行；把 E8a 分为队列/语义采集/来源/兼容的可独立核查增量。E9 为每项附证据类型、环境、操作、断言、结果及未测项；下列真窗口矩阵不得由单测或原型截图代签。无构建、安装与实测时只能写“方案要求”，不能写“已通过”。

## 与前两轮意见不同之处

1. **不同意第二轮“全部关闭、无剩余阻塞项”的总判断。** G1/G2/G3 尚无完整保证；这不否认前两轮已改正的路径/参数问题。
2. P1 的 created_via/history_logged_at 区分方向正确，但第二轮只证明字段可保留和顺序重复 reconcile 的幂等，没有证明记录在补记之前被发布、编辑、删除的生命周期安全（G2）。
3. P7 把目录删除改为逐文件删除，解决 FileSystem 能力契约，却没有解决清理与提交/备份/读取的协调；第二轮对“不经 journal 不会冲突”的接受过宽（G1）。
4. E5 对一次 A→B 重载有效，不足以证明连续重载的新旧权威性和独立读数编辑状态安全（G3/G4）。
5. P5 的“先过滤、再并行分摊”顺序正确；但不能据此推断毫秒保和、DST 分桶和时钟缓存已完整（G6/G7/G12）。
6. **仍认可** P2 沿用原路径和原落盘文本、P3 MCP 按次读取握手信息且无状态 HTTP 不缓存别人的 clientInfo、P4 显式传来源、P6 Snapshot 增 reviews、P8 复用全局错误通道、P9 保留 homeService.sleep 的修订方向。

## 核验记录

### 至少 10 处现状描述抽查（本轮主审核亲自点验）

| # | 方案声称 | 实际代码与核对结果 |
|---|---|---|
| 1 | 快捷活动硬编码睡觉 | `src/app/shell/QuickActs.tsx:48` 属实；数字键在 `:32`–`:33` 按 acts 索引，删除磁贴不需要重排索引。 |
| 2 | 保留 homeService.sleep | `src/app/actions.ts:70` 当前仍有 UI 接线；本轮核对源码与前轮说明，未建议删除服务函数。 |
| 3 | 小窗修订号会重置 | `src/services/commit.ts:75` 初始化 0，`:213` 提交递增；`src/platform/windowBus.ts:66` 直接丢较小号，根因属实。 |
| 4 | 小窗命令严格 schema | `src/platform/windowBus.ts` 的 base/命令为 strict，现有快照和回复没有 session；E5 的 DTO 改动确实需要同步。 |
| 5 | 当前回顾完成后没回看 | `src/services/reviewProjection.ts:55` 返回 null；`src/app/ReviewScreen.tsx:39`–`:44` 只显示完成块，属实。 |
| 6 | Snapshot 没有 reviews | `src/services/commit.ts:25`–`:28` 属实；事务 tx.reviews 已存在，不等于 Snapshot 已公开。 |
| 7 | 上次回顾结束时刻 | `src/services/reviewProjection.ts:21`–`:25` 取最近 completed_at，否则首用日边界，属实。 |
| 8 | clipEntriesInRange 可复用 | 函数在 `src/domain/timeline/stats.ts:134` 起，方案“132–175”略偏；它保留原时间，另给 clipped_start/end，不能直接按原字段分桶。 |
| 9 | 计时索引在内存 | `src/data/timelogV2Repo.ts:21`–`:32` scan 填充，`:16` 返回引用组成的新数组；不是深克隆、也不是只读类型保证。 |
| 10 | 语义比较不能按文件数判断 | `src/services/commit.ts:196` 每次写 state；`entityChanges.ts:9` 保存即登记，即便值相同也可能产生 Write，属实。 |
| 11 | 回执与业务同 journal | `src/services/commit.ts:198`–`:202` 属实；重放在 `:157`–`:162` 直接返回，不执行 work。receipt 按 ID 读取见 `src/data/receiptRepo.ts:11`。 |
| 12 | 快速记录原生直写 | `src-tauri/src/lib.rs:78`–`:97` 属实，且 create_new 不覆盖同名文件；通知在 `QuickBarApp.tsx:22`。 |
| 13 | reconcile 跳过想法 | `src/services/recordService.ts:115` 属实；当前是一整个 run 包循环，改逐条事务会改变调用次数与投影行为。 |
| 14 | 启动先恢复后迁移 | `src/app/bootstrap.ts:25`–`:28` 属实；native 快速保存迁移闸门见 `quick_save.rs:15`–`:24`，因此不能把迁移竞争一概当成无锁。 |
| 15 | 日历可复用列表编辑格/服务 | `src/pages/list/EntryRow.tsx:36`–`:49` 有失焦提交、Esc、输入法组合判断；`src/services/tracking/timeEditService.ts:45`–`:62` 有开始/结束/时长解析与正在计时限制，属实。 |
| 16 | 旧版保留新增 record 字段 | `git show v0.2.5:src/data/schemas.ts` 的 record passthrough、`mdRepo.ts:45` 合并 meta 属实；这只证明指定读写路径，不是全部回退场景验收。 |
| 17 | 备份会包含 history | `src-tauri/src/update_backup.rs:162`–`:198` 递归枚举、只排除顶层 journal/指定备份目标，属实；必须另有 G1 的冻结。 |
| 18 | 不改 15 个工具参数可传 origin | `client/applicationClient.ts:57`–`:59` 是独立 wire 请求对象；`src-tauri/src/mcp_bridge.rs:449`–`:483` 解析 method 后透传整体 request，方案位置可行。 |

补充文档一致性：执行方案首行仍引用需求 v1.16 和 ADR Proposed；需求 Current Plan 仍有 v1.2/Proposed 链接，而实际是执行方案 v1.3、需求 v1.18、ADR Accepted。属过时引用，本轮未修改，不能据此把 Accepted 的产品决定重新解释为待决定。E8 中已有“实际参数 8KB 截断”的要求，也不能在实施时再默默增加其他限制。

### 实际读取范围

- 约定和对象：`../AGENTS.md`、`CLAUDE.md`、`docs/版本开发流程.md`；执行方案全文、ADR 0019 全文、需求计划 v1.18；前两轮审核记录（第二轮全文，第一轮问题与核验段）；架构设计的分层、domain DAG、事务和窗口机制相关章节。
- 主审核点验代码：`src/services/{commit,entityChanges,recordService,settingsService,ideaService,homeService,cardService,miniController,miniProjection,reviewProjection,reviewService,updateService,updateController,serviceFixture,scheduler}.ts`；`src/data/{repos,mdRepo,journal,timelogV2Repo,stateRepo,receiptRepo,memoryFs,fs,schemas}.ts` 及 migrations/v2 相关入口；`src/domain/timeline/{day,stats}.ts`、`src/domain/review/schedule.ts`、`src/shared/{time,settings}.ts`。
- 界面/边界点验：`src/platform/{windowBus,settings}.ts`；`src/app/{bootstrap,QuickBarApp,MiniApp,MainApp,ReviewScreen,actions,applicationController}.tsx/ts` 的相关实现；`src/pages/home/TimeField.tsx`、`src/pages/list/EntryRow.tsx`、`src/pages/calendar/EntryPopover.tsx`；`src/app/shell/QuickActs.tsx`、shell.css；eslint.config.mjs、test-runner.mjs；`client/applicationClient.ts`、`mcp/{server,http}.ts`；Rust `lib.rs`、`quick_save.rs`、`update_backup.rs`、`mcp_bridge.rs` 的上述行段。
- 两个原型仅确认文件存在与路径，本轮不审核其已确认的设计。另有三个只读探索子任务提供竞争、会话/回看、平台/调用边界线索；报告采纳项均由主审核回到所引代码点验，没有把“方案未实施”当作发现。

### 实际命令与复现

1. `Get-Content`（全文/带行号行段）、`rg -n`、`rg --files`、`Get-Item`；`git status --short --untracked-files=no`、`git diff --stat`、`git log -3 --oneline`、`git rev-parse HEAD`。未暂存、提交、回退、推送。
2. `git show v0.2.5:src/data/{journal,schemas,mdRepo,repos}.ts`、`git show v0.2.5:src/app/bootstrap.ts`，只读审计旧版本路径。
3. 只读 Node 内联脚本：读取真实 day.ts/shared/time.ts，以 `node:module.stripTypeScriptTypes` 转成内存代码，在子进程设 `TZ=America/New_York`，得到 G6 的分桶错误；未生成 JS 文件、未修改系统时区。
4. 只读 Node 内联脚本：把真实 Journal/MemoryFs 转成内存代码，注入一次历史写失败，再在内存中删除历史并 recover；输出 `Recovery conflict: history/2026-01-01/setting.json`。全部文件操作仅作用于 MemoryFs；为了聚焦恢复时序，测试装配的 safeRelative 为恒等函数，使用的都是合法相对路径，不据此验证路径安全。另在内存计算 `round(1000/3)×3=999` 和 −180…0 共 181 桶。均不是方案通过证据。
5. 保护对象只读 SHA-256 核对：三份审核对象原文与 `evidence/journal-real.json` 在报告写入前后应保持相同。仅新建本文件；无 HTML 或其他新产物。
6. 命令中的只读定位失败：一个 PowerShell foreach 管道写法先报解析错误，改为数组收集后读取成功；若干可选搜索路径不存在（单独 day.test.ts、两个猜测的 SDK dist 路径），未把这些失败当成核验成功，SDK 内部实现未据此背书。

**本轮未运行 Vitest、npm check、构建、安装、发布或真实窗口。** 没有以已有 483 项测试结果证明未来方案正确，也没有执行会写 journal-real.json 的验证入口。

### 仍需实施后完成的证据（均未验证）

| 类型 | 必须保留的实测/断言 |
|---|---|
| 真窗口 | D2 实际像素命中与一分钟拖动；D3 焦点、IME、失焦/回车/Esc、失败后回显；D4 连续 F5、切目录、旧名称/读数编辑与回复交错；D5 Windows 小窗/mini 切角。 |
| 持久偏好 | recap-view.json 写入防抖未到期即关闭、读取未完成就切选项、快速连改/并发原子写、重启、损坏恢复提示；纯函数测试不能代替原生落盘。 |
| 历史全链路 | 每类入口最终业务提交的来源与主体，尤其小窗完成的二段链路；快速记录待办/想法/附件、多个通知及 MCP 交错；真实 clientInfo/CLI 环境识别与 origin 全程透传。 |
| 竞争与恢复 | 清理/队列/备份冻结、非空 before 的设置合并恢复、补记不同中断点、提交已成功但响应丢失/后处理失败；部分失败不能伪称“完全没落盘”。 |
| 旧版兼容 | 隔离 v0.2.5 读取/改写新增字段、恢复 history create/rewrite 和快速记录标记的未完成 journal，再升级 beta.3 核对；常驻新旧客户端协议矩阵。 |
| 性能 | 一年条目聚合；长期实体下 N 条待补记录的整段 IO/内存/延迟；180 天历史列表、最近调用查询与维护互斥。未测不得填“<50ms”或“性能合理”。 |

隔离实机应沿用既定 autostart=false、独立快捷键与测试前后 Run 项核对，不改变日常版和系统时间；后台触发尽量使用注入时钟/隔离机制，不能把改变全机系统时间当无副作用的普通测试。

## 需要用户决定

**无。** 以上均为已确定产品规则的实现与验证缺口；不要求重选并行统计口径、180 天期限、调用方识别方式、F5、睡觉入口或原型。方案作者应先补齐 G1–G3 的保证及其他应改项，再提交复核。本轮按要求不修改方案原文。
