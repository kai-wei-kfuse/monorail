# ADR 0019：操作历史的记录口径、存储与调用方识别

状态：**Accepted（修订 2）** · 2026-11-04。前两轮审核通过后（[round1](../../evidence/beta3-plan-review-round1.md)、[round2](../../evidence/beta3-plan-review-round2.md)）曾标为 Accepted；第三轮独立审核结论为不通过（[round3](../../evidence/beta3-plan-review-round3.md)，阻塞 G1–G3、应改 G4–G13），本修订处理其中与操作历史有关的 G1、G2、G5、G8–G11、G13；第四轮由方案作者经用户授权自审通过（执行方案第 9 节），重新 Accepted。对应 [0.3.0-beta.3 计划](../stages/0.3.0-beta.3.md) §1.7 与 [执行方案](../stages/0.3.0-beta.3-execution-plan.md) E8。界面以 `../原型/页面/history-prototype.html` 与 `../UI参考截图/v0.3.0-beta.3-history-01..11` 为准（用户已确认）。

## 背景

用户要求能看到「数据被谁、在什么时候、怎么改了」：桌面端手动操作（主窗口、小窗、快速记录条）、MCP / CLI 的写调用，以及软件按规则自己做的后台改动，都要能查到；自动化调用要知道是哪个 agent。

现状（代码核对）：

- 所有业务写入经 `src/services/commit.ts` 的 `execute()`：载入实体（每个根事务都会列出 records / cards / tasks / reviews，`:164-171`）→ `work(tx)` → 收集 `tx.writes` → `repos.transact`（journal）→ 投影发布。`run()` 与 `runOperation()` 共用这条路径，调用时**不带动作名或来源**；后台事务（启动 `reconcile`、`newDay`、`scheduler.settle`、`data-changed` / `main-visible` 触发的 `reconcile`）同样走 `run(ctx, …)`。
- 每个 `Write` 带完整的改前与改后文本（`src/data/journal.ts`）。journal 是**先写计划、再逐个写文件**的前滚恢复（`:36-39`），中途失败会留下计划文件并封锁提交队列，重启后由 `recover()` 补完；它不是「失败即回滚」。`state.yaml` 每次事务都写（`commit.ts` 约 196 行），写了几个文件不能说明有没有实际改动。
- MCP / CLI 写操作在同一份 journal 里写 `receipts/<operation_id>.json`（ADR 0011，`version: 1` 严格格式，只按 ID 读，不扫描、不按天数删），没有调用方信息。
- MCP / CLI 请求经 `client/applicationClient.ts` → 命名管道 → Rust `mcp_bridge.rs`（只读 `method`，整体透传）→ `src/app/applicationBridge.ts` → `applicationController.handleApplicationRequest`，用 `applicationRequest`（`discriminatedUnion` + `strictObject`）解析，多出的顶层字段会被拒绝。
- 小窗命令都经 `connectMini` → `homeService.dispatchMiniCommand`。其中「完成卡片」只返回意图（`homeService.ts:167-171`），由主窗口打开完成对话框，最终在 `cardService.complete` 里提交（`MainApp.tsx:154` 目前丢弃了 `cardId`）。
- 快速记录条**不走 journal**：Rust `save_quick_record` 用 `create_new` 直接写 `records/<uuid>.md`（`lib.rs:78-97`），再发 `data-changed {recordId}`；通知可能延迟或因前一步失败而没有发出。
- 设置的系统副作用（快捷键、开机自启、置顶）目前在事务中途、journal 之前调用（`settingsService.ts:27`），之后还可能改记录、重新出卡。
- 应用内更新前 `pauseCommits` 只等提交队列尾部（`commit.ts:88`），随后 Rust 递归枚举并逐个读取数据目录做备份（`update_backup.rs:240`、`:265`）。
- 数据目录里各仓库只列自己的目录，未知顶层目录被忽略。ADR 0016 要求退回 v0.2.5 的兼容性经源码审计和实测，不能默认。

## 决定

### 1. 记录口径

- **改动了数据就记**：一次根事务**持久提交**后，业务数据（计时条目、卡片、任务、回顾、记录 / 想法、设置、计时状态）有实际差异，就写一条操作历史。来源三类：手动、自动化（MCP / CLI）、系统（软件按规则自己做的后台改动）。
- **不记**：只读请求（不论成败）；被拒绝、被取消、未进入提交的调用；命中回执的重放；MCP 计时方法 `noop: true` 的提交（只写 receipt）；没有实际差异的后台事务。
- 「实际差异」由第 4 条的语义比较判断。不算实质改动的簿记字段：`state.yaml` 的 `open_entry_day` 等运行簿记、待确认（pending）相关字段、记录上的 `history_logged_at`（第 5 条）。计时状态（开始 / 暂停 / 离开 / 待机、`resume_entry_id`、`current_card`）算。完整清单写进 `src/domain/history` 的单测。
- 一个用户动作一条：日历拖动在松手时提交一次；行内编辑在离开输入框时提交一次。设置合并见第 3 条。
- 「失败」的含义要分开（审核 G13）：未进入 journal 的拒绝 → 不记；journal 写到一半失败 → 业务和历史处于同一份未完成计划中，队列封锁，重启 `recover()` 后两者一起补完、一致；已提交但后续处理（投影、提醒、日志）失败或响应丢失 → 数据和历史都已持久化，照常显示。
- 只看不撤销。

### 2. 存储

- 新目录 `history/`，一次操作一个文件：`history/<活动日 YYYY-MM-DD>/<HHmmssSSS>-<id>.json`。活动日按写入时的设置计算并写进记录的 `day` 字段；之后改了 `dayBoundaryHour`，已写的历史不迁移，列表按记录里的 `day` 分组（审核 G6）。
- 不采用「每天一个文件追加」：journal 需要整份改前改后文本，按天追加会让每次提交重写并复制当天全部历史。
- 记录格式 `version: 1`，严格 schema（`shared/history.ts`）：`id`、`at`、`day`、`action`、`source`、`subject`（主体类型、ID、显示文字与小字）、`changes[]` 与 `effects[]`（每项：对象类型与 ID、显示名、字段、改前显示值、改后显示值；新建改前为 null，删除改后为 null）、可选 `merged`、自动化另有 `operation_id`、`method` 与截断后的规范化参数（上限 8 KB，超出标记截断；不另加其他限制）。
- 显示文字在写入时生成并保存。
- 坏文件：列表跳过并提示「有 N 条记录无法读取」，不中断整页、不自动删除。

### 3. 与业务写入同一份 journal；设置合并

- 在 `execute()` 收集完业务 writes、调用 `transact` 之前，把历史作为新文件 write 追加进 `tx.writes`，与业务写入同属一份 journal 计划。
- 不改 receipt：调用方等新信息只写进历史，`receipts/` 保持 ADR 0011。
- 设置合并（60 秒内同项）：
  - 沿用上一条的原路径，`before` 传上一条实际落盘的原文（`Journal.run` 逐字节核对，`journal.ts:24,34`）。Ctx 内存保存上一条的 `{ path, rawText, record, committedAtMs, settingKey, sourceKey, day }`，只在 `transact` 成功后更新；提交失败或重载后清空。
  - 同时满足才合并，否则写新文件：同一设置项、同一来源、活动日未变、本次改的不是 `dayBoundaryHour`、距上一条 ≤ 60 秒。
  - 合并规则（审核 G9）：`changes` 与 `effects` 都按「对象类型 + 对象 ID + 字段」累计，保留首次的改前、末次的改后；只在某一次出现的连带改动照样保留；累计后改前等于改后的项（来回改）从列表中去掉；如果全部来回、没有净改动，这一条仍保留，标「改回原值 ×N」。

### 4. 改前改后与连带改动

- 纯函数单元 `src/domain/history`：输入「本次改动前后」的数据和动作描述，输出 `changes` / `effects` 与「是否有实质改动」。只处理本次改动过的对象，耗时与改动量成正比。
- 改动前的数据怎么来（审核 G8），服务层不解包 `Write`：
  - 卡片、任务、回顾、记录：`entityChanges` 增加 `changed(): { id, before, after }[]`，`before` 由事务开始时载入的实体原文（`Entity.text`）解码得到，不依赖服务没有就地修改对象；只解码改动过的那几个。
  - 计时条目：`TimelogV2Repo` 增加数据层接口 `changedDays(entries)`，返回改动的活动日及其前后条目（数据层自己解析自己的文件），供 `commit.ts` 使用。
  - `state`、`settings`：事务开始时 `structuredClone`（对象小）。
- 主体与连带（审核 G9）：动作目录（`shared/history.ts`）为每个动作声明主体类型和定位方式：取参数里的 ID，或取 `work` 的返回值（如新建条目、捕获待办生成的 ID，`applicationController.ts:626` 这类在 `work` 内才生成 ID 的情况），或固定为某个对象（如设置项名）。主体的变化进 `changes`，其余进 `effects`。父子对象（缩小卡片的父卡与新卡、捕获待办的记录 / 卡片 / 任务）在目录里写明归属。
- `src/domain/history` 可以引用 timeline / card / task / review / idea / record，其他 domain 单元不得引用它（eslint）。

### 5. 动作 ID 与来源

- `run()` / `runOperation()` 必填 `intent = { action, subject?, source? }`。测试经 `serviceFixture` 辅助函数固定传 `test.direct`；开发预览与验证入口用 `dev.*`、`verification.*`。
- **系统**：`source = { kind: 'system', trigger }`，另存一句「为什么会改」。已核对的后台写入：
  - `system.dayChange`（`bootstrap.ts` 的 `newDay`）：想法超过天数自动进冷库；到回顾日生成本周回顾；首页重新出卡、释放失效的当前卡。
  - `system.resume`（`scheduler.settle`）：补记离线时段、截断休眠时正在计的那条，可能释放进行中的卡。
  - `system.reconcile`：有实质改动才记。
  - 事务开始时没有进行中的条目会自动开始「待机」：在用户动作里是连带，在后台事务里随该事务一起记。
- **手动** `source = { kind: 'manual', via: 'main' | 'mini' | 'quickbar', page? }`，随 `intent` 显式传入，不使用全局一次性标记：
  - `main`：缺省；`page` 按 `action` 前缀推导，日历 / 列表共用的服务入口加可选 `page` 参数由调用页面传入。一次用户动作触发两次提交时（如 `tempActivity`），两次各带各的 `intent`，记成两条。
  - `mini`：`dispatchMiniCommand` 显式传入。**两段式动作**（审核 G5）：小窗「完成卡片」只在小窗命令里返回意图，真正改数据的是主窗口完成对话框之后的 `card.complete`。因此把 `{ source: mini, cardId, at, session }` 随 `effects.complete` 传给主窗口（`MainApp.tsx:154` 改为保存 `cardId` 与来源），完成对话框确认时作为 `intent.source` 传给 `card.complete`；确认时核对卡片仍是当前卡、会话未变，不符则按主窗口操作处理并提示。其他两段式动作在动作目录登记，同样处理。
  - `quickbar`（审核 G2）：见下一小节。

#### 快速记录条：先补记、再消费

- 问题：记录文件由 Rust 在队列外先落盘，通知（`data-changed`）可能延迟或丢失；在 `reconcile` 补记之前，这条记录可能已经被别的根事务读到、被用户编辑或删除，补记时原始内容已不在。
- 做法：快速记录条保存时在记录上写 `created_via: 'quickbar'`（`recordSchema` 为 `.passthrough()`）。**每一个根事务**在 `execute()` 载入实体之后、执行 `work(tx)` 之前，先做一步「吸收」：
  1. 在本事务载入的 `tx.records` 里找 `created_via === 'quickbar'` 且没有 `history_logged_at` 的记录（只看本事务内的最新数据，不依赖入队前的候选，两个 `reconcile` 不会各补一次）。
  2. 对每一条：待办调用现有的 `materializeTodoRecordInTx` 生成卡片和任务；写一条来源为「快速记录条」的历史（动作「捕获待办 / 保存想法」，`at` 与活动日取 `record.created_at`，主体为这条记录、改动为「新记录」，生成的卡片和任务作为连带）；给记录写上 `history_logged_at`。
  3. 记录的创建时刻已在保留期外（第 7 条）：只写 `history_logged_at`，不写历史。
  4. 吸收完成后再取「改动前」快照，执行 `work(tx)`；本次用户动作的历史只比较吸收之后的数据，不会把吸收的改动算到用户动作头上。
- 为什么成立：应用内任何对记录的编辑或删除都要经过某个根事务，而该事务在执行用户动作之前已经先吸收了待补记录，所以补记总是基于保存时的原始内容；吸收与用户动作在同一份 journal 里，要么都提交、要么都不提交。通知是否到达不再影响正确性，只影响多快吸收（任何下一个事务都会吸收，包括 `newDay`、用户下一次操作）。
- 开销：每个事务本来就载入全部记录，吸收只是多一次按字段过滤，没有待补记录时不产生任何写入。`reconcile` 保持现在的单个批量事务，不改成每条一个事务。
- 不会误判：升级前的老记录、主窗口 / MCP / CLI 新建的记录没有 `created_via`；180 天后历史被清理，记录上的 `history_logged_at` 仍在，不会重复补写。
- 不在范围：用户在应用之外（如 Obsidian）直接修改或删除记录文件，由现有的外部编辑检查处理，不保证补记。
- 快速记录条的历史由吸收这一步**直接生成**（主体为该记录、改动「新记录」），不依赖语义比较；这样只存一条想法、不产生卡片时也不会漏记（第二轮复核提醒）。`history_logged_at` 在语义比较里一律按簿记字段忽略。
- `execute()` 的顺序：载入 → 吸收 → 取「改动前」快照 → 没有进行中条目时自动开始待机 → `work(tx)` → 比较。吸收的改动不算进用户动作；自动开始待机在用户动作里作为连带出现。
- `RecordEntry` / `RecordInput` 增加这两个可选字段，`createRecord` 原样带下去（它会重建对象）。
- 吸收**不得改变** MCP / CLI 写操作 `expected_state` 所依据的数据，也不调用 `refreshInTx`，否则会让一次正常的自动化调用被误判为「状态已变」。已核对：`timerStateToken`（`homeService.ts:12-18`）只依赖进行中条目、`current_card` 及其状态、`pending_id` / `pending_at`、`resume_entry_id`、休息开始时刻；`materializeTodoRecordInTx`（`recordService.ts` 约 40–76 行）只新建卡片 / 任务或改写占位卡的内容，不改这些字段。实现时加测试锁定「吸收前后 token 不变」；若测试不成立，对带 `expected_state` 的 `runOperation` 改为先排一个只做吸收的系统事务，再执行该操作（Q6）。

### 6. 自动化来源与调用方

- `source = { kind: 'mcp' | 'cli' | 'automation', agent: { name, raw?, version?, detected_by, evidence? } }`。`automation` 用于没有 `origin` 的旧客户端。
- 不改 15 个工具的参数，不让模型自报：
  - **MCP**：在每次工具调用时（`mcp/server.ts` 的 `call()`）读 `server.server.getClientVersion()`，`detected_by: 'mcp_handshake'`。HTTP 模式（`legacy: 'stateless'`，每个请求新建 server）读不到时传 `{ kind: 'mcp', agent: { name: null, detected_by: 'none' } }`，显示「MCP · 未识别」；不缓存进程内最近一次 `initialize`，避免把调用记到别的客户端头上。
  - **CLI**：`--agent <名字>` 或 `MONORAIL_AGENT`（`flag`，优先）→ 已知 agent 环境变量（`env`，对照表在 `cli/agentDetect.ts`，需实测）→ `none`。
  - 原始名字经对照表换成显示名，表里没有的按原样显示。
- 传输：管道请求对象上加**可选**顶层 `origin`；`client.call(method, input, { signal?, origin? })` 按次传入，`createPipeApplicationClient` 可设默认 `origin`（CLI）。缺失按 `automation` + `none`。Rust 桥透传。
- 全部是自报、未验证：只用于显示和筛选，不作权限依据，不参与回执冲突判断。去控制字符，`name` ≤ 64 字符，`version` ≤ 32 字符。
- 版本组合（审核 G13）：新版客户端连旧版桌面时，旧版 `applicationRequest` 是严格对象，会把带 `origin` 的请求当作参数错误拒绝。这种情况出现在退回旧版桌面、而客户端进程（Claude Desktop 等拉起的 MCP 进程）还是新版时。处理：报错照常返回、不会被当成成功；说明文档写明「更换版本后重启 AI 客户端」；E9 实测这一组合。旧版客户端连新版桌面正常（`origin` 可选）。

### 7. 保留 180 天与维护任务

- 保留**包含今天在内的最近 180 个活动日**（审核 G11）：删除 `day < 今天活动日 − 179 天` 的历史。日期推进用现有日历日函数（`shared/time.ts`），不用固定 24 小时。
- 清理不经 journal（逐文件删除，可重复，失败只记日志），但必须与提交、读取、更新备份互斥（审核 G1）：
  - 新增**维护任务**入口 `maintain(ctx, task)`：挂在同一个 Ctx 的提交队列尾部串行执行，不建事务、不写 `state.yaml`；队列已有故障（`queue.failure`）或处于更新冻结（`queue.paused`）时拒绝启动。`pauseCommits` 等待队列尾部时自然也会等待正在进行的维护任务；冻结后不再接纳新维护任务。
  - 清理在启动完成 journal 恢复、确认队列健康之后，以及 `newDay` 之后，各排一次维护任务；遇到更新冻结时经 `whenCommitsOpen` 等到冻结解除再排（与后台事务的现有做法一致），不丢这次清理。每天最多删掉一天的历史，单次开销小；长时间未运行后的第一次清理可能多一些，仍在同一维护任务里完成。
  - 清理跳过 Ctx 内存中设置合并指针所指的文件（防止系统时钟回拨等边界下删掉将被改写的文件）。
  - 切换数据目录或主窗口销毁时，等待或取消旧 Ctx 上未开始的维护任务。
  - 列表做法：一次 `fs.list('history', true)`，按路径中的日期过滤，逐个文件删除，再尝试删空日目录（`FileSystem` 可选能力，内存文件系统跳过）。
- 不清理 `receipts/`。

### 8. 读取与界面

- 不进入每次提交都计算的投影。按需查询 `historyService.list(ctx, { fromDay, toDay })` 与 `historyService.recentAutomation(ctx, n)`，经第 7 条的同一队列串行读取（类似 `readOperation`），不用会写 `state.yaml` 的 `run()`，读取期间不会被清理删除文件，也不会读到 journal 写了一半的状态。app 层按 `home.dataVersion` 记忆。
- 列表页与设置 09 共用的行与详情组件放 `src/widgets/history/`。

### 9. 设置的系统副作用（审核 G10）

- 历史只依据持久提交判断，不声称 JS journal 与系统调用天然原子。
- 调整 `settingsService.change` 的顺序：先完成所有领域改动（保存设置、按新天数处理想法、重新出卡），**最后一步**才调用系统接口（快捷键、开机自启、置顶），系统接口失败则整个事务不提交，设置页显示原因（与现在一致）。
- 系统调用成功、随后 journal 失败：提交队列会封锁并要求重启；重启时 `applyPlatform`（`settingsService.ts` 约 43–48 行）按持久设置重放系统设置，系统状态回到与已提交设置一致。这一段不会产生历史（没有持久提交）。
- 验证：系统接口拒绝（不提交、无历史）；系统接口成功但 journal 失败（队列封锁、重启后系统状态按旧设置重放、无历史）；正常修改（有历史）。

## 兼容与恢复

- `schemaVersion` 仍为 2；`state.yaml`、`settings.yaml`、receipt 格式不变；记录新增两个可选字段 `created_via`、`history_logged_at`；`history/` 是新增目录。
- 源码审计（第一轮审核已做，`git show v0.2.5:…`）：v0.2.5 各仓库只扫描自己的目录，忽略 `history/`；`Journal.recover` 只校验 `safeRelative` 与 `before`，会写出未完成计划里的 `history/` 路径；`recordSchema` 为 `.passthrough()`，`MdRepo.write` 合并原有字段后再写，新增字段会保留。这只证明这些读写路径，不等于全部退回场景已验收。
- E8d 实测矩阵（隔离安装，写进证据，审计结论与实测结论分开签字）：
  1. v0.2.5 打开带 `history/` 的数据目录；
  2. v0.2.5 恢复包含历史新建文件的未完成 journal；
  3. v0.2.5 恢复包含**设置历史改写**（`before` 非空）、且业务文件已部分写入的未完成 journal；
  4. v0.2.5 读取并改写带 `created_via` / `history_logged_at` 的记录；
  5. 快速记录吸收在不同中断点（卡片已写 / 历史已写 / 标记已写）的未完成 journal，v0.2.5 恢复后再升级回 beta.3，核对不重记、不丢记录；
  6. 新版 MCP 客户端进程连旧版桌面（beta.2）：报错可见、不伪成功；重启客户端后恢复。
- E8d 结果（2026-11-05）：
  - **源码审计（已复核）**：对 `git show v0.2.5:src/data/{journal,repos,mdRepo,schemas}.ts` 重新核对，结论同上——`Journal.recover` 按路径重放，不认识 `history/` 也照写；`MdRepo.list` 只列自己目录的 `.md`；`recordSchema` 为 `.passthrough()`，`MdRepo.write` 先合并原文字段；`migrateV2` 只在 `schemaVersion !== 2` 时扫全部路径。对矩阵第 1、2、4 条在源码层面成立；第 3 条（`before` 非空的设置历史改写）`apply` 按 `before` 逐字节核对，与业务文件同一规则；第 5 条退回期间 v0.2.5 的 `reconcile` 会照常生成卡片，回到 beta.3 后吸收时 `materializeTodoRecordInTx` 先找已关联的卡，不会重复生成，历史只写一条。
  - **隔离安装实测矩阵 1–6：未测**。没有在隔离身份下装 v0.2.5 实际打开、恢复和改写；第 6 条新版客户端连旧版桌面也没测。不能据源码审计写成兼容。
  - 备份：源码确认应用内更新备份递归复制整个数据目录（只跳过已排空的 `.journal`），包含 `history/`；更新冻结期间清理不接纳（E8a1 测试）。真机备份未测。
- 退回旧版期间的操作没有历史；退回期间用快速记录条存的记录没有 `created_via`，回到新版后不补记。空缺保持空缺。
- 应用内更新备份包含 `history/`（180 天上限约束了体积）。迁移 v2 只在 `schemaVersion !== 2` 时扫描全部路径，不受影响。

## 备选方案

- 按天一个文件追加：每次提交重写当天整个文件，否决。
- 从 receipts 推导：没有改前值和调用方，且 ADR 0011 禁止扫描，否决。
- 让模型在工具参数里报调用方：要改严格 schema，模型会漏填乱填，否决。
- 历史写在 journal 之外：崩溃时会「数据改了、没有历史」，否决。
- 快速记录条每条记录单独一个事务补记（修订 1 的做法）：无法阻止记录在补记前被消费，且 N 条记录要跑 N 次完整事务，被「先补记、再消费」取代。
- 清理经 journal：要读出每个文件作为 `before`，开销与条数成正比；改为不经 journal、但纳入同一队列互斥。

## 待审核问题

- Q1（已定）：后台改动要记，来源「系统」。
- Q2（已定）：快速记录条的补记可能延迟到下一个事务，时间取 `created_at`。
- Q3（已定）：`run()` 必填 `intent`，生产代码逐个标注并单独提交，测试用辅助函数。
- Q4（已定）：MCP HTTP 无状态模式记「MCP · 未识别」。
- Q5（修订 2 新增）：「先补记、再消费」让每个根事务都可能多出一条快速记录条历史和卡片生成。用户动作本身的历史不受影响，但同一次提交会写出两条历史。请复核这一点能否接受。
- Q6（修订 2 新增）：吸收与 MCP `expected_state` 的关系，见第 5 条最后一项；实现前先核对，复核时请一并判断。

## 验证

- `src/domain/history` 纯函数：每类动作的主体 / 连带（含父子卡、捕获待办、补录新建 ID）、实质改动判断（只改簿记字段、只写 receipt、`noop` 都不记）、设置合并（累计、来回、只在某次出现的连带）、显示文字。
- `commit.ts`：业务与历史同一 journal；**journal 写到一半失败**时队列封锁、读取被拒、重启 `recover()` 后两者一致；回执重放、被拒调用不写历史。
- 每个用户写入入口：从入口开始，断言最终改数据那次提交的历史（动作、来源、主体、改动），不只断言中间步骤；小窗完成卡片走完「小窗命令 → 主窗口对话框 → 完成」全链路。后台入口：有实质改动写「系统」历史，没有不写。
- 快速记录条（用可控的暂停点构造交错）：保存后通知前，被 MCP 提交读到；通知延迟或丢失后，用户编辑或删除该记录；两个 `reconcile` 同时处理；吸收中途 journal 失败后恢复；待办、想法各一条；无标记老记录不补；历史被清理后不补；过期记录只标记不写历史。
- 维护任务：枚举后删除期间开始更新（备份等待清理完成）；设置改写部分提交后清理被拒；读取期间清理排队；队列故障时清理不启动；保留边界（截止日前一天删、截止日当天和之后保留）；清理失败不影响提交。
- 设置系统副作用：第 9 条三种情况。
- 性能（写进证据，不填未测的数字）：长期数据下 N 条待补记录 + 并发到达时的整段耗时、读次数、峰值内存；180 天历史的列表与最近调用查询耗时。
- 兼容：上节实测矩阵 1–6。
