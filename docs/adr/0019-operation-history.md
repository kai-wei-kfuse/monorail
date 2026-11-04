# ADR 0019：操作历史的记录口径、存储与调用方识别

状态：Accepted · 2026-11-04 · 首轮审核有条件通过（[`evidence/beta3-plan-review-round1.md`](../../evidence/beta3-plan-review-round1.md)），按 P1–P4、P7 修订后第二轮复核通过（[`evidence/beta3-plan-review-round2.md`](../../evidence/beta3-plan-review-round2.md)）。对应 [0.3.0-beta.3 计划](../stages/0.3.0-beta.3.md) §1.7（v1.16）与 [执行方案](../stages/0.3.0-beta.3-execution-plan.md) E8。界面以 `../原型/页面/history-prototype.html` 与 `../UI参考截图/v0.3.0-beta.3-history-01..11` 为准（用户已确认暂定稿）。

## 背景

用户要求能看到「数据被谁、在什么时候、怎么改了」：桌面端手动操作（主窗口、小窗、快速记录条）和 MCP / CLI 的写调用都要能查到，并且要知道是哪个 agent 调用的。

现状（代码核对）：

- 所有业务写入经 `src/services/commit.ts` 的 `execute()`：载入实体 → `work(tx)` → 收集 `tx.writes` → `repos.transact`（journal）→ 投影发布。`run()` 与 `runOperation()` 共用这一条路径，但调用时**不带任何动作名或来源**；后台事务（启动 `reconcile`、`newDay`、`scheduler.settle`、`data-changed` / `main-visible` 触发的 `reconcile`）同样走 `run(ctx, …)`。
- 每个 `Write` 带完整的改前文本 `before` 与改后文本 `text`（`src/data/journal.ts`），journal 计划文件 `.journal/<id>.json` 同时保存两者。`state.yaml` 每次事务都会写（`commit.ts` 约 198 行），所以「写了几个文件」不能用来判断有没有实际改动。
- MCP / CLI 写操作在同一份 journal 里写 `receipts/<operation_id>.json`（ADR 0011，`version: 1` 严格格式，只按 ID 读，不扫描、不按天数删）。receipt 里没有调用方信息。
- MCP / CLI 请求经 `client/applicationClient.ts` → 命名管道 → Rust `mcp_bridge.rs`（只读 `method` 字段，整体透传）→ `src/app/applicationBridge.ts` → `applicationController.handleApplicationRequest`，在这里用 `applicationRequest`（`discriminatedUnion` + `strictObject`）解析，**多出的顶层字段会被拒绝**。
- 小窗所有命令经 `mini-command` → `connectMini` → `homeService.dispatchMiniCommand`，是单一入口。
- 快速记录条**不走 journal**：Rust `save_quick_record` 直接写 `records/<uuid>.md`，再发 `data-changed {recordId}`，主窗口随后 `reconcile` 生成卡片。
- 数据目录里各仓库只列自己的目录，未知的顶层目录被忽略；应用内更新前的备份递归复制整个数据目录（`update_backup.rs`）。ADR 0016 要求退回 v0.2.5 的兼容性必须经源码审计和实测，不能默认。

## 决定

### 1. 记录口径

- **改动了数据就记**：一次根事务提交后，业务数据（计时条目、卡片、任务、回顾、记录 / 想法、设置、计时状态）有实际差异，就写一条操作历史。来源分三类：手动、自动化（MCP / CLI）、系统（软件按规则自己做的后台改动，用户 2026-11-04 确定也要记）。
- **不记**：只读请求（不论成败）；失败、被拒绝、被取消、未进入提交的调用（没有提交就没有记录）；命中回执的重放；MCP 计时方法返回 `noop: true` 的提交（只写了 receipt，业务无差异）；没有实际差异的后台事务。
- 「实际差异」由第 4 条的语义比较判断，不看写了几个文件。`state.yaml` 中只服务于运行的簿记字段（如 `open_entry_day`）、待确认（pending）相关字段、记录上的 `history_logged_at`（第 5 条）不算实质改动；计时状态（开始 / 暂停 / 离开 / 待机、`resume_entry_id`、`current_card`）算。完整字段清单在实现时写进 `src/domain/history` 的单测。
- 一个用户动作一条：日历拖动在松手时提交一次；行内编辑在离开输入框时提交一次。设置页同一来源在 60 秒内连续改同一项，合并成一条（显示 `×N`，保留首次改前与末次改后）。
- 只看不撤销。

### 2. 存储

- 新目录 `history/`，**一次操作一个文件**：`history/<活动日 YYYY-MM-DD>/<HHmmssSSS>-<id>.json`。活动日按写入时的 `dayBoundaryHour` 计算，与列表页分组一致。
- 不采用「每天一个文件追加」：journal 写入需要整份改前和改后文本，按天追加会让每次提交重写并在 journal 里复制当天全部历史，随条数增长；一次一个新文件时 `before = null`，journal 只多一个小文件。
- 记录格式 `version: 1`，严格 schema（`shared/history.ts`），字段：`id`、`at`、`day`、`action`（动作 ID）、`source`（见第 5、6 条）、`subject`（主体的显示文字与小字）、`changes[]` 与 `effects[]`（每项：对象显示名、字段、改前显示值、改后显示值；新建改前为 null，删除改后为 null）、可选 `merged`、自动化另有 `operation_id`、`method` 与截断后的规范化参数（上限 8 KB，超出标记截断）。
- 显示文字在**写入时**生成并保存，之后实体被改名或删除，历史仍按当时的样子显示。
- 坏文件：列表读取时跳过并在页面底部提示「有 N 条记录无法读取」，不中断整页，也不自动删除（与 ADR 0011 坏 receipt 抛错不同，因为历史只用于查看，不参与业务判断）。

### 3. 与业务写入同一份 journal

- 在 `execute()` 收集完业务 writes、调用 `transact` 之前，把历史记录作为一个新文件 write 追加进 `tx.writes`。业务数据和对应的历史要么都提交，要么都不提交。
- 设置合并（第 1 条）需要改写上一条历史文件，同样经 journal。`Journal.run` 会逐字节核对 `before` 与磁盘原文（`journal.ts:24,34`），不一致就抛 `External edit` 并让提交队列进入故障状态，因此：
  - **沿用上一条的原路径**，`before` 传上一条**实际落盘的原文**；Ctx 内存保存上一条的 `{ path, rawText, record, committedAtMs, settingKey, sourceKey, day }`，只在 `transact` 成功后更新。
  - 同时满足才合并，否则写新文件：同一设置项、同一来源、活动日未变、本次改的不是 `dayBoundaryHour`、距上一条 ≤ 60 秒。
  - 合并后更新 `at`、改后值与 `merged`，保留首次的改前值。提交失败或主窗口重载后不再合并到旧文件。
- 不改动 receipt：调用方等新信息只写进历史记录，`receipts/` 保持 ADR 0011 的 `version: 1` 格式与「不按天数删」的约定。

### 4. 改前改后与连带改动

- 新增纯函数单元 `src/domain/history`：输入事务开始时载入的实体快照与 `work(tx)` 之后的实体（条目、卡片、任务、回顾、记录、设置、计时状态）、动作描述，输出 `changes` / `effects` 与「是否有实质改动」。只比较本次变化的对象，耗时与改动量成正比。
- 主体与连带的划分：动作描述可带 `subject`（服务层已知的主体 ID）；主体对象的变化进 `changes`，其余进 `effects`（截断上一条、待机让位 / 回填、卡片状态、任务事项数等）。没有 `subject` 时按动作目录里声明的主体类型划分。
- `src/domain/history` 可以引用 timeline / card / task / review / idea / record 的类型与格式函数，任何其他 domain 单元不得引用它（eslint 增加对应约束）。

### 5. 动作 ID 与手动来源

- `run()` 增加必填的动作描述参数 `intent = { action, subject?, source? }`，`action` 是 `shared/history.ts` 中的字符串联合类型，并有一张「动作 ID → 中文名」表。**必填**是为了让每个写入入口在编译期就必须声明自己是什么动作，避免漏记。测试通过 `serviceFixture` 的辅助函数固定传 `test.direct`；开发预览与验证入口用 `dev.*`、`verification.*`。
- 后台事务使用 `system.*` 动作 ID，来源 `source = { kind: 'system', trigger }`，记录里另存一句「为什么会改」，有实质改动就写入。已核对的后台写入：
  - `system.dayChange`（启动时一次、之后每天日界一次，`bootstrap.ts` 的 `newDay`）：想法超过「自动进冷库」天数没动 → 进冷库；到回顾日生成本周回顾；首页重新出卡、释放已失效的当前卡。
  - `system.resume`（休眠 / 关机后恢复，`scheduler.settle`）：离线超过「离线追问最小间隔」时补记离线时段、截断休眠时正在计的那条，可能释放进行中的卡。
  - `system.reconcile`（启动与唤回主窗口时的整理）：有实质改动才记；快速记录条的新记录按第 5 条的「快速记录条」来源记，不算系统。
  - 事务开始时没有进行中的条目会自动开始「待机」：在用户动作里是连带改动，在后台事务里随该事务一起记。
  - 界面：「系统」徽标为细框、无底色；来源筛选增加「仅系统」；展开详情最上面显示「为什么会改」（原型 `history-prototype.html`，截图 `history-11`）。
- 手动来源 `source = { kind: 'manual', via: 'main' | 'mini' | 'quickbar', page? }`，**随 `intent` 显式传入**，不使用全局的一次性来源标记（审核 P4：一次用户动作可能触发两次提交，如 `tempActivity` 先 `changeLists` 再 `insert`；后台事务也可能在中间插队，一次性标记会被错拿）：
  - `main`：缺省来源。`page`（首页 / 日历 / 列表 / 背包 / 回顾 / 设置）只用于显示，缺省按 `action` 前缀推导；日历与列表共用的服务入口加可选 `page` 参数，由调用页面传入。
  - `mini`：`dispatchMiniCommand` 显式传入。
  - `quickbar`（审核 P1）：记录文件由 Rust 在事务外写入，`RecordEntry` 原本没有来源字段，`reconcile` 原本也跳过想法（`recordService.ts:115`）。因此：
    - 快速记录条保存时在记录上写 `created_via: 'quickbar'`（`recordSchema` 为 `.passthrough()`）。
    - `reconcile` 对 `created_via === 'quickbar'` 且没有 `history_logged_at` 的记录（待办和想法），一条记录一个事务：生成卡片 / 任务（待办）、写一条「快速记录条 · 捕获待办 / 保存想法」历史（`at` 与活动日取 `record.created_at`，改动为「新记录」，生成的卡片和任务作为连带），并在同一事务里给记录写上 `history_logged_at`。
    - 只认标记，不看历史文件是否存在：升级前的老记录、主窗口 / MCP / CLI 新建的记录没有 `created_via`，不会被误记成快速记录条；180 天后历史被清理，记录上的 `history_logged_at` 仍在，不会重复补写。
    - 主窗口没运行时保存的记录，要等下一次 `reconcile` 才补写，时间仍是记录的创建时刻（Q2 已定可接受）。
    - 实现提醒（第二轮复核）：记录文件在补记事务开始前就已在磁盘上，语义比较看不到「新建」。补记事务中，`history_logged_at` 由无到有的那条记录要作为本次的主体，生成「新记录」改动；否则「保存想法」（不产生卡片和任务）会被判成没有实质改动而漏记。普通事务里 `history_logged_at` 仍按簿记字段忽略。

### 6. 自动化来源与调用方

- `source = { kind: 'mcp' | 'cli' | 'automation', agent: { name, raw?, version?, detected_by, evidence? } }`。`automation` 用于来源字段缺失的旧客户端（例如更新前就在运行的 beta.2 MCP 进程）。
- 不改 15 个工具的参数，不让模型自报：
  - **MCP**：读握手时客户端自动发送的 `clientInfo`，`detected_by: 'mcp_handshake'`。client 在握手前就已创建（`mcp/main.ts:10`），所以不在创建时注入，而是在每次工具调用时（`mcp/server.ts` 的 `call()`）读 `server.server.getClientVersion()`，按次传给 `client.call`（审核 P3）。
  - **CLI**：依次取 `--agent <名字>` 全局参数或 `MONORAIL_AGENT` 环境变量（`'flag'`，用户指定，优先）→ 已知 agent 设置的环境变量（`'env'`，对照表维护在 `cli/agentDetect.ts`，如 `CLAUDECODE`、`CODEX_SANDBOX`；不是统一标准，需实测）→ `'none'`，显示「未识别」。
  - 原始名字经对照表换成显示名（`shared/history.ts`），表里没有的按原样显示。
- 传输：在管道请求对象上增加**可选**的顶层 `origin` 字段（`applicationRequest` 每个成员 `origin: callerOrigin.optional()`）。`client.call(method, input, { signal?, origin? })` 按次传入（MCP 用）；`createPipeApplicationClient` 另可设默认 `origin`（CLI 用）。缺失时按 `automation` + `none` 处理，旧客户端继续可用。Rust 桥透传，不需要改。
- 全部是对方自报、未验证：只用于显示和筛选，不作权限依据，不参与同一 `operation_id` 重试的冲突判断（冲突仍只比较 `command` 与规范化 `input`）。字符串去掉控制字符，`name` ≤ 64 字符，`version` ≤ 32 字符。
- MCP HTTP 模式是 `legacy: 'stateless'`（`mcp/http.ts:18-20`），每个 HTTP 请求都新建一个 `McpServer`，处理 `tools/call` 的实例从没收到过 `initialize`，`getClientVersion()` 必为空。此时传 `origin: { kind: 'mcp', agent: { name: null, detected_by: 'none' } }`，显示「MCP · 未识别」；必须带 `kind: 'mcp'`。不缓存进程内最近一次 `initialize` 的 `clientInfo`：同一个 HTTP 进程可能有多个客户端，缓存会把调用记到别的客户端头上。不为此改 HTTP 会话模型（Q4 已定）。

### 7. 保留 180 天

- 只保留最近 180 天（用户 2026-11-04 确定）。启动完成 journal 恢复之后、以及每次活动日切换时，删除 `history/` 下日期早于「今天的活动日 − 180 天」的历史。
- 做法（审核 P7）：调一次 `fs.list('history', true)` 拿到全部文件路径，按路径里的日期过滤，**逐个文件**删除，再尝试删空日目录（`FileSystem` 可选能力，内存文件系统没有目录则跳过）。不按目录名直接删：`MemoryFs.remove` 只认文件，`tauriFs.remove` 不带递归，删非空目录会失败。列表读取同样只调一次递归列出，不逐日调用。
- 清理**不经 journal**：只删 `history/` 下的文件，可重复执行，中途失败下次继续，失败只记日志、不阻塞业务提交。理由：经 journal 删除要读出每个文件作为 `before`，开销与条数成正比，而历史文件只追加、不被业务引用，部分删除不会造成不一致。
- 不清理 `receipts/`（ADR 0011 保持不变）。

### 8. 读取与界面

- 不进入每次提交都会计算的投影。新增按需查询 `historyService.list(ctx, { fromDay, toDay })` 与 `historyService.recentAutomation(ctx, n)`，app 层按 `home.dataVersion` 记忆，与列表页 `recentEntries` 的用法一致。查询经提交队列读取，不会读到 journal 写了一半的状态。
- 列表页与设置 09 都要显示历史行，而页面之间不能互相引用，共用的行和详情组件放在 `src/widgets/history/`。

## 兼容与恢复

- `schemaVersion` 仍为 2；`state.yaml`、`settings.yaml` 与 receipt 格式不变；已有实体只在记录上新增两个可选字段（`created_via`、`history_logged_at`，第 5 条）；`history/` 是新增目录。
- 退回 v0.2.5 / beta.2：旧版各仓库只列自己的目录，预期忽略 `history/`；如果退回时留有未完成的 `.journal`，旧版 `Journal.recover` 会照常把其中 `history/` 路径的文件写出，旧版仍不读取它们。这是推断，按 ADR 0016 必须在实现后用 v0.2.5 实测确认后才能写进兼容结论。
- 首轮审核已用 `git show v0.2.5:…` 核对：v0.2.5 各仓库只扫描 records / cards / tasks / reviews / timelog，忽略 `history/`；其 `Journal.recover` 只校验 `safeRelative` 与 `before`，对未完成 journal 里的 `history/` 路径会正常写出。实测仍在 E8d。
- 记录上新增的可选字段 `created_via`、`history_logged_at`：v0.2.5 的 `recordSchema` 同样是 `.passthrough()`，`MdRepo.write` 会先合并文件里原有的字段再写，所以旧版能读、改写后字段保留（源码核对，E8d 一并实测）。
- 退回旧版期间的操作不会有历史；退回期间用快速记录条存的记录没有 `created_via`，回到新版后也不补记。空缺保持空缺，不补造。
- 应用内更新的备份会包含 `history/`，备份体积随之增加（180 天上限约束了增长）。
- 迁移代码 v2 只在 `schemaVersion !== 2` 时扫描全部路径，不受影响。

## 备选方案

- **按天一个文件追加**：读取方便，但每次提交都要重写当天整个文件并在 journal 中复制，否决。
- **从 receipts 推导自动化历史**：receipt 没有改前值和调用方，且 ADR 0011 禁止扫描 receipts，否决。
- **让模型在工具参数里报调用方**：要改 15 个工具的严格 schema，模型会漏填或乱填，否决。
- **历史写在 journal 之外（提交成功后再写）**：崩溃时会出现「数据改了、没有历史」，与「改了就记」矛盾，否决。

## 待审核问题

- Q1（已定，2026-11-04）：后台事务的实质改动要记，来源「系统」，见第 5 条。
- Q2（审核同意）：快速记录条延迟到下次 `reconcile` 补写，时间取 `created_at`；识别方式按第 5 条的持久化标记。
- Q3（审核同意，附修订）：`run()` 必填 `intent`，生产代码逐个标注并单独提交；测试经 `serviceFixture` 辅助函数固定传 `test.direct`，避免改动约 41 处测试的业务含义。
- Q4（审核同意）：HTTP 无状态模式记「MCP · 未识别」，必须带 `kind: 'mcp'`，见第 6 条。

## 验证

- `src/domain/history` 纯函数单测：每类动作的主体 / 连带划分、实质改动判断（只改簿记字段、只写 receipt、`noop` 都不记）、设置合并、显示文字。
- `commit.ts` 集成测试：业务与历史同一 journal；journal 写入失败时两者都不落盘、恢复后两者一致；回执重放不写历史；失败调用不写历史。
- 每个用户写入入口至少一条「调用后产生一条且动作 ID 正确」的测试（参数化）；后台入口：有实质改动时写一条「系统」记录（含触发原因），没有改动时不写。
- 来源：小窗命令；快速记录条（待办、想法各一条，重复 `reconcile` 不重复，无标记的老记录不补写，历史被清理后不补写）；`tempActivity` 两次提交各自来源正确；MCP stdio 握手、MCP HTTP 记「MCP · 未识别」；CLI `--agent` / `MONORAIL_AGENT` / 已知环境变量 / 都没有；缺 `origin` 的旧请求。
- 设置合并：60 秒内同项合并且只剩一个文件、跨活动日不合并、改 `dayBoundaryHour` 不合并、上一次提交失败后不合并到旧文件。
- 保留：跨 180 天边界的历史被删、当天不删、`MemoryFs` 与真实文件系统都能删、清理失败不影响提交。
- 兼容：v0.2.5 隔离安装读带 `history/` 的数据目录、带 `history/` 路径的未完成 journal 恢复、带 `created_via` / `history_logged_at` 的记录读取与改写（实测，写进证据）。
