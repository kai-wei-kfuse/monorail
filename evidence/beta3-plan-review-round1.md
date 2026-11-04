# 0.3.0-beta.3 开发执行方案与 ADR 0019：首轮审核

日期：2026-11-04。审核人：coder-3。
结论：**有条件通过（存在 3 项阻塞问题 P1–P3、5 项应改问题 P4–P8 及 1 项事实修正建议 P9）**。请先修正方案与 ADR 0019 中的阻塞项（尤其是 E8 操作历史的快速记录条识别、设置合并 journal 契约、MCP 调用方动态注入与 HTTP 模式处理，以及 E6 回看投影拆分后的 `lastCompletedAt` 来源），再开始 E1 之后的编码实施。本轮仅新建本审核文件，未修改任何代码或方案原文，未提交、未推送、未构建安装包。

---

## 逐条审核发现（P1–P9）

### P1：快速记录条（QuickBar）补写操作历史的方案无法识别「想法」，且会将既有记录或主窗口/MCP 新建的想法误判为快速记录条操作
- **严重程度**：阻塞
- **涉及章节**：ADR 0019 §5（第 60 行）、执行方案 E8b.1（第 189 行）
- **代码对照证据**：
  - `src/app/QuickBarApp.tsx:18-43`：快速记录条通过 `invoke('save_quick_record')` 直接写 `records/<uuid>.md`，同时支持 `d.kind === '待办'` 与 `d.kind === '想法'` 两种记录，写完发出 `emit('data-changed', { recordId: value.id })`。
  - `src/domain/record/record.ts:3-9`、`src/data/schemas.ts:12-20`：`RecordEntry` 持久化字段中**没有任何字段区分该记录来自 `quickbar`、`main`（如回顾页新建想法）还是 `mcp`/`cli`**。
  - `src/app/bootstrap.ts:66-71`、`src/services/recordService.ts:111-122`：`listen('data-changed', refresh)` 丢弃了事件 payload 中的 `recordId`；且 `reconcile(ctx)` 第 115 行写了 `if (record.kind !== '待办') continue;`，根本不处理快速记录条保存的「想法」（想法在活跃池中 `card_id` 恒为 `null`）。
- **问题是什么**：
  1. 快速记录条保存的「想法」在 `reconcile` 中被跳过，且因想法无关联卡片，无法靠“是否尚未生成卡片”判断是否为新记录，会导致快速记录条保存的想法漏记。
  2. ADR 0019 §5 提出“历史文件路径由记录 ID 决定（`<时刻>-quick-<recordId>.json`），文件已存在就不重复写”。但旧版本升级上来的历史记录、通过主窗口/MCP/CLI 保存的想法（其历史文件名为 `<HHmmssSSS>-<historyId>.json` 而非 `*-quick-<recordId>.json`），以及超过 180 天被清理掉历史文件但保留在 `records/` 中的老记录，在磁盘上都没有 `*-quick-<recordId>.json`。若 `reconcile` 按此规则补写，会把旧记录和主窗口/MCP 新建记录全部误判或复活重写为「快速记录条」操作。
- **建议怎么改**：
  - 在 `QuickBarApp.tsx` 的 `toRecord` 中为快速记录条写入的记录增加一个可选持久化标记（例如 `created_via: 'quickbar'` 与 `quickbar_history_logged?: boolean`，`recordSchema` 已开启 `.passthrough()`），或由 `bootstrap.ts` 把 `data-changed` 的 `{ recordId }` 队列传给 `reconcile`；
  - `reconcile` 扫描到 `created_via === 'quickbar' && !quickbar_history_logged` 的记录（含 `待办` 与 `想法`）时，在同一事务内生成 `<HHmmssSSS>-quick-<recordId>.json` 历史文件并将该记录更新为 `quickbar_history_logged: true`。这样升级前的老记录、主窗口/MCP 记录均不会误判，且 180 天后历史文件被清理也绝不会重复补写。

---

### P2：设置项 60 秒合并（`historyRepo.rewrite`）未保留原文件路径与落盘原文 `before`，违反 `Journal.run` 一致性检查
- **严重程度**：阻塞
- **涉及章节**：ADR 0019 §1（第 26 行）、§3（第 40 行）、执行方案 E8a.2（第 168 行）、E8a.4（第 173 行）
- **代码对照证据**：
  - `src/data/journal.ts:24,34`：`Journal.run` 对每个 `Write` 强制校验 `((await this.fs.read(write.path))?.text ?? null) !== write.before`，若不匹配立即抛 `External edit` 并令提交队列进入 `queue.failure` 锁死状态（`src/services/commit.ts:203`）。
  - `src/services/settingsService.ts:25-31`：每次修改设置都会触发一次独立的 `run(ctx, ...)`。
- **问题是什么**：
  1. 方案只写“在 Ctx 上保留上一条设置历史的指针，`historyRepo.rewrite(prev, next)`”，但没有规定合并时**必须沿用上一条历史文件的原有相对路径 `prevPath`**，并用上一条实际落盘的 JSON 字符串作为 `createWrite(prevPath, nextText, prevRawText)` 的 `before`。若按新时间戳生成新文件名而不删除旧文件，磁盘上会残留合并前的每一步文件；若 `before` 与磁盘文件字节不完全一致，`Journal.run` 会直接抛错阻塞整个应用写入。
  2. 若 60 秒内恰好跨过活动日边界，或用户修改的设置项正是 `dayBoundaryHour`（导致当前活动日计算变化），跨目录合并会破坏按活动日分目录的不变量。
- **建议怎么改**：
  - 在 `Ctx` 内存中保存 `{ path: string; rawText: string; record: HistoryRecord; committedAtMs: number; settingKey: string; sourceKey: string }`；
  - 仅当 `settingKey` 相同、`sourceKey` 相同、`day`（活动日）未变、非 `dayBoundaryHour` 变更且 `nowMs - committedAtMs <= 60_000` 时，**保持原路径 `prev.path` 不变**，调用 `createWrite(prev.path, nextRawText, prev.rawText)` 原地覆写该文件（更新 `at`、`after` 与 `merged: (prev.record.merged ?? 1) + 1`），并在提交成功后同步更新内存中的 `rawText`；否则直接写新文件。

---

### P3：MCP 调用方识别在 `mcp/main.ts` 的注入时机过早（握手前为空），且 HTTP 无状态模式（`mcp/http.ts`）每次请求新建 `McpServer` 导致 `tools/call` 无法直接读取 `getClientVersion()`
- **严重程度**：阻塞
- **涉及章节**：ADR 0019 §6（第 67–72 行）、Q4（第 105 行）、执行方案 E8b.2（第 191–194 行）
- **代码对照证据**：
  - `mcp/main.ts:10-21`：`const client = createPipeApplicationClient(defaultPipePath())` 在 `serveStdio(() => createServer(client))` **之前**就已经创建完毕；而 `McpServer` 实例是在 `mcp/server.ts:35` 的 `createServer(client)` 中创建的，`server.server.getClientVersion()` 只有在客户端完成 `initialize` 握手后才返回 `{ name, version }`。
  - `mcp/http.ts:18-20`：`createMcpHandler(() => createServer(client), { legacy: 'stateless', ... })` 在无状态 HTTP 模式下，**每一个 HTTP POST 请求都会调用工厂函数新建一个全新的 `McpServer` 实例**。处理 `tools/call` POST 请求的 `McpServer` 实例从未收到过前一个 `initialize` POST 请求，因此在该实例上调 `server.server.getClientVersion()` **恒为 `undefined`**。
  - `client/applicationClient.ts:28-60`：目前 `client.call(method, input, options)` 的 `options` 仅接收 `{ signal?: AbortSignal }`，并固定构造 `{ method, arguments: parsedInput.data }` 发送。
- **问题是什么**：
  1. 若只在 `mcp/main.ts:10` 创建 `client` 时静态传入 `origin`，stdio 模式下尚未创建 `McpServer` 也未握手，拿不到 `clientInfo`。
  2. HTTP 无状态模式下，`tools/call` 所在的新 `McpServer` 实例上 `getClientVersion()` 必然为空（无需等到开发时才测出）。
- **建议怎么改**：
  - 在 `client/applicationClient.ts` 中允许 `client.call(method, input, options?: { signal?: AbortSignal; origin?: CallerOrigin })` 按次传入 `origin`（同时支持 `createPipeApplicationClient` 接收默认 `origin` 或 `() => CallerOrigin`）；
  - 在 `mcp/server.ts:36` 的 `call()` 内部（此时处于具体工具调用上下文，stdio 握手已完成）动态读取 `server.server.getClientVersion()` 并作为 `origin: { kind: 'mcp', ... }` 传给 `client.call`；
  - 在 `mcp/http.ts` 中：可在 HTTP 入口解析 JSON-RPC 请求体时，若 `method === 'initialize'` 则缓存 `params.clientInfo` 供同进程后续请求读取，或者按 ADR 0019 Q4 直接保底发送 `origin: { kind: 'mcp', agent: { name: '未识别', detected_by: 'none' } }`（注意必须标明 `kind: 'mcp'`，不能漏传 `origin` 退化成 `automation`）。

---

### P4：主窗口手动操作通过“全局一次性来源标记”传递 `page` 在异步调用链（如 `tempActivity`）与并发入队下会丢失或串台
- **严重程度**：应改
- **涉及章节**：ADR 0019 §5（第 59 行）、执行方案 E8b.1（第 187 行）
- **代码对照证据**：
  - `src/app/actions.ts:62-66`：`tempActivity` 在勾选「存为快捷活动」时会先 `await changeLists(...)`（第 1 次 `run`），再 `await timer.insert(...)`（第 2 次 `run`）。若使用“调用前同步设置一次性来源标记、由下一次 `run` 入队时取走”，第 1 次 `changeLists` 就会把标记消耗掉，导致真正的 `timer.insert` 丢失页面来源；
  - `src/app/bootstrap.ts:69`、`src/services/scheduler.ts:38-55`：`reconcile` 与 `scheduler` 随时可能在异步微任务间隙调用 `run(ctx, ...)`。若某处 UI 设置了一次性标记后因前置校验失败未进入 `run()`，随后入队的后台事务或小窗命令就会误取走该一次性标记，造成来源串台。
- **问题是什么**：
  方案 E8a.4 既然已经决定给所有 `run(ctx, work, at, intent)` 增加必填的 `intent` 参数，再额外搞一套有状态的“一次性来源标记”既冗余又容易串台。
- **建议怎么改**：
  - 直接在 `run(ctx, work, at, intent)` 的 `intent` 参数中携带可选的 `source?: HistorySource`（缺省根据 `intent.action` 前缀自动推导默认页面来源，如 `review.*` → `回顾`、`settings.*` → `设置`、`backpack.*` → `背包`、`home.*` → `首页`；对日历/列表共用的 `timeEditService` 或预设操作，由调用方参数或 `intent` 显式传入 `page: 'calendar' | 'list'`），彻底废除全局一次性可变标记。

---

### P5：D7 回看「实际占用时间 + 并行平均分摊」算法需明确「含待机/睡眠」开关过滤顺序与原子区间切分规则
- **严重程度**：应改
- **涉及章节**：执行方案 E6.1（第 130–134 行）
- **代码对照证据**：
  - `src/domain/timeline/stats.ts:196-215`：现有统计对 `by_project` 直接累加 `item.clipped_ms`（未去重），而 `non_idle_covered_ms` 用 `unionLength` 求并集。
  - `src/domain/timeline/place.ts`：手动补录或日历新建采用 `'overlay'` 模式，允许普通活动与「睡眠」「离线」或另一条普通活动在时间上重叠。
- **问题是什么**：
  方案 E6.1 写了“分组把并行时段按同时进行的条数平均分给各条，使各组合计等于有效投入、占比合计 100%”，但未说明**过滤系统项（待机/睡眠）与切分并行时段的先后顺序**。若在切分并行时段时未先排除被隐藏的「睡眠」条目，那么一段与「睡眠」重叠的补录活动会被「睡眠」分走一半时长，之后再隐藏「睡眠」就会导致有效投入总时长凭空少算！
- **建议怎么改**：
  - 在 E6.1 中明确算法步骤：
    1. **先过滤**：若 `includeIdle === false`，在进入切分前先剔除「待机」与「睡眠」条目；
    2. **再切分原子区间（Sweep-line）**：将剩余条目的 `[clipped_start, clipped_end)` 端点排序切分为互不重叠的原子区间 $[t_i, t_{i+1})$，若该原子区间被 $k$ 条存活记录覆盖，则每条记录分得 $\Delta t / k$ 毫秒；
    3. **最后按维度聚合**：每条记录分得的总有效时长 `effectiveMs` 在项目/来源/活动维度全额计入对应组，在标签维度按该记录的标签数 $1/n$ 分摊（无标签归入「无标签」）。这样可严格保证在任意开关和任意维度下，各分组合计与每日柱状图各段之和 100% 等于总有效投入时长。

---

### P6：E6 移除 `projectReview()` 中的 `recap()` 后，当回顾完成（`ReviewSlice === null`）时 `lastCompletedAt` 无处存放，且 `Snapshot` 未保存 `reviews`
- **严重程度**：应改
- **涉及章节**：执行方案 E6.3–E6.4（第 140–141 行）、E7.1（第 149 行）
- **代码对照证据**：
  - `src/services/reviewProjection.ts:52-55`：`export function projectReview(input: Input): ReviewSlice` 在没有未完成回顾时直接 `return null;`。
  - `src/services/commit.ts:25-28, 216-227`：`Snapshot` 接口包含 `state, cards, tasks, records, entries, home, backpack, review, settings, notices`，**没有保存 `reviews: Review[]` 数组**！
  - `src/app/dev/M3Preview.tsx:21-48`：预览组件也直接依赖 `ReviewData.recap`。
- **问题是什么**：
  1. 方案 E6.3 写“在回顾投影里新增 `lastCompletedAt`，回顾完成后也要发布；`recapService.query` 从内存读取”。但如果本期回顾已完成（`data === null`），现有的 `ReviewSlice` 是 `null`，根本无法挂载 `lastCompletedAt`；而且 `ctx.snapshot()` 里也没有 `reviews: Review[]` 可供 `recapService.query` 同步重算 `recapStart`！
- **建议怎么改**：
  - 在 `Snapshot`（`src/services/commit.ts:26`）中补上 `reviews: Review[]`（与 `cards`、`tasks`、`records` 一致，启动和每次提交时已在内存载入），这样 `recapService.query(ctx, ...)` 可直接从 `ctx.snapshot()` 同步调用 `recapStart(snap.reviews, snap.state.first_used_day, snap.settings.dayBoundaryHour, at)`，无需把 `ReviewSlice` 的 `null` 语义改坏；
  - 同步在 E6/E7 中列出 `src/app/dev/M3Preview.tsx` 的适配改动。

---

### P7：E8a.2 历史目录读取与清理未考虑 `MemoryFs` 无目录实体及 `tauriFs.remove` 默认非递归的限制
- **严重程度**：应改
- **涉及章节**：执行方案 E8a.2（第 168 行）、E8d.1（第 211 行）
- **代码对照证据**：
  - `src/data/fs.ts:70-92`：`tauriFs.list(directory, recursive)` 在 `recursive = true` 时可一次性递归列出所有子目录中的文件相对路径；而 `tauriFs.remove(path)` 调用 `fs.remove(resolve(path))` 未传 `{ recursive: true }`，直接删非空日目录会报错。
  - `src/data/memoryFs.ts:8-17`：`MemoryFs` 用 `Map<string, FileSnapshot>` 仅存储文件，不存在目录键；在 `MemoryFs` 上对目录名调用 `remove('history/2026-04-01')` 会直接抛 `Error: File missing: history/2026-04-01`。
- **问题是什么**：
  1. 若 `removeDaysBefore` 直接按目录名调 `fs.remove`，在 `MemoryFs` 单测与 `tauriFs` 非空目录下都会失败。
  2. 若 `listDays(fromDay, toDay)` 对 7~180 天逐日调 `fs.list('history/' + day)`，在桌面端会产生大量串行 IPC 往返。
- **建议怎么改**：
  - `historyRepo` 统一通过**一次** `await this.fs.list('history', true)` 获取全部历史文件相对路径（`history/<day>/<file>.json`），在内存中按 `<day>` 过滤：
    - `listDays(fromDay, toDay)` 仅对命中的文件调 `this.fs.read(path)`；
    - `removeDaysBefore(cutoffDay)` 对 `<day> < cutoffDay` 的文件逐个调 `this.fs.remove(filePath)`（兼容 `MemoryFs` 与 `tauriFs`），在 `tauriFs` 中若需清理空日目录再单独处理或忽略空目录。

---

### P8：D3 日历 `EntryPopover` 修改时间的报错通道与 `TimeScreens.tsx` 现有 `void` 动作签名不一致
- **严重程度**：应改
- **涉及章节**：执行方案 E4.2–E4.3（第 95–102 行）
- **代码对照证据**：
  - `src/app/TimeScreens.tsx:18-27, 45-51, 62-68`：`CalendarScreen` 与 `ListScreen` 的动作均通过 `void edit.setStart(...).catch(report)` 包装，返回 `void`，报错由主窗口顶部的全局 Toast（`report`）展示。
  - `src/pages/list/EntryRow.tsx:36-50`：列表页的 `Cell` 提交失败后，`EntryRow` 重新渲染时输入格自动回退显示原 `value`，错误信息由全局 `report` 弹出 Toast，并不在行内显示错误文字。
- **问题是什么**：
  方案 E4.2 写“照 `ListScreen` 接 `edit.setStart/setEnd/setDuration`，错误交给 `report`”，但 E4.3 第 101 行又写“服务报错时弹窗内显示原因（复用 `.cal-note` 或 `.ls-warn` 样式），不静默”。若错误已在 `CalendarScreen` 交给 `report` 并返回 `void`，`EntryPopover` 无法获知错误；若两边都报则会重复提示。
- **建议怎么改**：
  - 保持与列表页 `EntryRow` 及 `EntryPopover` 现有 `onPatch` 完全一致：错误统一由 `TimeScreens.tsx` 的 `report` 弹出全局错误 Toast，弹窗内 `InlineCell` 自动恢复为当前条目的原值，不必在弹窗内另做一套局部错误状态。

---

### P9：方案中几处文件/行号引用与 `run()` 改动范围需修正
- **严重程度**：建议
- **涉及章节**：执行方案开头（第 3 行）、E2（第 74 行）、E8a.5（第 174 行）、E8b.2（第 191 行）
- **代码对照证据与修正建议**：
  1. **执行方案第 3 行**：“路径相对 `src/app/`” → 应改为“路径相对 `app/`”。
  2. **执行方案 E2 第 74 行**：“`homeService.sleep` 若再无引用（含测试）一并删除” → 经 `git grep -n "sleep" src/` 核实，`src/services/homeService.test.ts:4,67` 与 `src/services/reviewTiming.test.ts:6,23` 仍直接调用 `sleep` 测试睡眠释放卡片与回顾不打断睡眠；应明确**保留 `homeService.sleep`**，仅删除 UI 层的 `QuickActs` 睡眠磁贴与 `actions.sleep`。
  3. **执行方案 E8a.5 第 174 行**：除已列出的 service 外，非测试代码中还有 `src/app/dev/LivePreview.tsx:42` 与 `src/verification/journal.ts:14` 调用了 `run(ctx, ...)`；此外测试文件中有 41 处直接调用 `run(ctx, ...)`（如 `serviceFixture.ts:38` 等）。建议 `run()` 对未传 `intent` 的测试调用提供默认测试动作（或在类型上要求业务 service 传 `intent`，并为测试提供辅助包装），避免 41 处无关测试被迫做无意义的机械修改。
  4. **执行方案 E8b.2 第 191 行**：`applicationController.ts` 中 `handleApplicationRequest` 入口在第 310 行，而实际调用 `runOperation` 的位置在 **第 457–626 行（共 10 处）**。

---

## 对待审核问题的意见（方案 §5 R3、R4、R6–R12 与 ADR 0019 Q2–Q4）

| 编号 | 审核意见 |
|---|---|
| **R3**（「做到哪了」每张卡只有最新一条笔记） | **同意方案做法**。`Card` 实体（`src/data/schemas.ts:29`）仅存单字段 `progress_note` 与 `progress_noted_at`，本版不改数据模型与 `schemaVersion`，按现有字段展示即可。 |
| **R4 / Q3**（`run()` 必填动作参数面广） | **同意单独提交，但建议优化测试签名（见 P4、P9.3）**。生产代码的 11 个 service + `bootstrap.ts` 必须显式传 `{ action, subject?, source? }`；对测试文件中的裸 `run(ctx, tx => ...)`，建议允许缺省或由 `serviceFixture` 统一标记为测试内部事务，减少对 41 处既有测试的侵入。 |
| **R6 / Q2**（快速记录条在主窗口未运行时延迟到下次 `reconcile` 补记） | **可接受，但必须先修 P1**。快速记录条的设计约束就是只写 `records/` 不跑完整事务；只要历史记录上的时间戳 `at` 与所属活动日 `day` 取自 `record.created_at`（而非 `reconcile` 执行时刻），用户看到的时间线就是准确的。但必须按 P1 区分快速记录条记录，防止误记或漏记「想法」。 |
| **R7 / Q4**（MCP HTTP 无状态模式取不到 `clientInfo`） | **接受显示「MCP · 未识别」，但需按 P3 保底 `kind: 'mcp'`**。在 `mcp/http.ts` 的 `legacy: 'stateless'` 模式下每次请求新建 `McpServer`，`tools/call` 时 `getClientVersion()` 必为 `undefined`。无需为此把 HTTP 改成有状态会话，也可选在 `http.ts` 缓存最近一次 `initialize` 请求的 `clientInfo`；取不到时记为 `MCP · 未识别` 完全合理。 |
| **R8**（CLI 环境变量识别非统一标准） | **同意方案做法**。优先取显式 `--agent` 与 `MONORAIL_AGENT`，环境变量对照表集中放在 `cli/agentDetect.ts` 并在文档中说明即可。 |
| **R9**（180 天历史清理不经 journal） | **同意不经 journal，但需按 P7 按文件删除**。`history/` 下每个文件只写一次（除 60 秒内设置合并外）、不被任何业务实体引用，不经 journal 逐文件删除不会破坏业务一致性，也不会在崩溃恢复时引发 `Recovery conflict`。 |
| **R10**（v0.2.5 兼容推断与验证） | **源码审计已初步印证，同意 E8d 实测后才写兼容结论**。我已核对 `v0.2.5` 标签下的 `src/data/journal.ts`、`src/data/repos.ts` 与 `src/app/bootstrap.ts`：`v0.2.5` 的各仓库只扫描 `records`、`cards`、`tasks`、`reviews`、`timelog`，忽略未知的 `history/` 目录；且 `v0.2.5` 的 `Journal.recover`（`journal.ts:41-51`）仅校验 `safeRelative(write.path)` 与 `before`，对未完成 journal 中的 `history/...` 路径会正常写出或删除而不报错。E8d 按计划做隔离安装实测（含带 `history/` 路径的未完成 `.journal` 恢复）足够充分。 |
| **R11**（`../UI风格规范.md` 在仓库外） | **同意方案做法**。在交接文档与总结中明确记录修改章节即可。 |
| **R12**（D6 删除后 UI 无内置「睡觉」入口） | **同意方案做法**。符合用户明确要求及设置页「软件不预置，都由你自己添加」的说明；保留 `homeService.sleep` 供已有单测使用（见 P9.2）。 |

---

## 按审核要点的逐项核对结论

1. **范围（E0–E9 vs 计划 D3–D9）**：一一对应，无遗漏开发项，亦未超出用户已确认范围。
2. **分层（`eslint.config.mjs` 与 `../架构设计.md`）**：
   - `src/ui/controls/InlineCell.tsx`（只依赖 React / `shared`）、`src/shared/duration.ts`、`src/shared/recapColors.ts`、`src/shared/history.ts` 符合 `ui` 与 `shared` 规则；
   - `src/domain/timeline/recap.ts` 不引用卡/任务，符合 `eslint.config.mjs:24-27` 对 `domain/timeline` 的隔离要求；
   - `src/domain/review/recap.ts` 引用 `timeline`、`card`、`task`，符合 `domain` 规则（需同步在 `../架构设计.md` §4 的依赖图中补画 `review -> timeline & card & task` 的边）；
   - `src/domain/history/` 引用各 domain 类型，并在 `eslint.config.mjs` 中禁止其他 domain 单元反向引用 `domain/history`，符合单向 DAG；
   - `src/widgets/history/` 供 `pages/list` 与 `pages/settings` 共用，避免页面间互相引用（`eslint.config.mjs:21`），完全合规。
3. **D3（条目弹窗改时间与 `flat`）**：抽离 `InlineCell` 到 `src/ui/controls/`、复用 `timeEditService` 的 `setStart/setEnd/setDuration` 可行；唯一需统一的是报错提示方式（见 **P8**）。
4. **D4（小窗会话标识）**：在 `Ctx` 上生成 `session` 并加入 `MiniSnapshot` 与 `miniCommandSchema`（`.strict()`），能完整覆盖同会话乱序、新会话低修订号、旧会话迟到事件与旧会话编辑命令修订号碰撞；改动面（`commit.ts`、`windowBus.ts`、`miniProjection.ts`、`miniController.ts`、`MiniApp.tsx`、`MiniPreview.tsx`、`windowBus.test.ts`、`mini.test.ts`）完整。
5. **D7（回看重构）**：先 `clipEntriesInRange` 再 `splitAtDays` 正确；1 年约 1 万条记录在内存中不做 `structuredClone` 直接聚合的性能假设合理（< 50 ms）；需按 **P5** 明确「先过滤待机/睡眠、再切分并行原子区间分摊」的顺序，并按 **P6** 在 `Snapshot` 中保留 `reviews` 以支持回顾完成后的 `lastCompletedAt` 计算。
6. **D8 / ADR 0019（操作历史）**：「语义比较 + 同一份 journal + 忽略 `state.yaml` 簿记字段」能保证改了才记、不改不记；`origin` 作为 `applicationRequest` 顶层可选字段（不进 `arguments`）既兼容旧客户端，又不影响 `canonicalJson(operation.input)` 的回执冲突判断，也不必修改 `receipts/` 格式。但必须解决 **P1**（快速记录条识别与防误判）、**P2**（设置合并的 `before` 与路径契约）、**P3**（MCP 动态读取 `clientInfo` 与 HTTP 模式）、**P4**（手动来源传参防串台）和 **P7**（`MemoryFs` / `tauriFs` 删除与列表）。
7. **验证（E9）**：明确区分了单测、gallery 无头截图与必须在真窗口验证的项（D2 短块点击与 1 分钟拖出、D4 F5 重载恢复、D5 真窗口切角、D7 `recap-view.json` 重启恢复、D8 真实 MCP/CLI/快速记录条/系统触发/v0.2.5 降级恢复），并遵循关闭 `autostart` 与清理 `Run` 项的纪律。

---

## 核验记录

- **实际读取并核对的文件**：
  - 规范与计划：`../AGENTS.md`、`CLAUDE.md`、`docs/版本开发流程.md`、`../架构设计.md`、`../UI风格规范.md`、`docs/stages/0.3.0-beta.3.md`（v1.16）、`docs/stages/0.3.0-beta.3-execution-plan.md`（v1.1）、`docs/adr/0019-operation-history.md`、`evidence/beta3-calendar-review-round1.md`、`../原型/页面/recap-prototype.html`、`../原型/页面/history-prototype.html`。
  - 正式代码：`eslint.config.mjs`、`src/shared/{application.ts,operation.ts,settings.ts}`、`src/domain/record/record.ts`、`src/domain/timeline/{day.ts,stats.ts}`、`src/data/{fs.ts,memoryFs.ts,journal.ts,receiptRepo.ts,repos.ts,schemas.ts}`、`src/platform/windowBus.ts`、`src/store/reviewSlice.ts`、`src/services/{commit.ts,homeService.ts,cardService.ts,backpackService.ts,ideaService.ts,recordService.ts,reviewService.ts,reviewProjection.ts,settingsService.ts,timeEditService.ts,dealService.ts,degradeService.ts,scheduler.ts,miniController.ts,miniProjection.ts}`、`src/services/tracking/timeEditService.ts`、`src/pages/calendar/{CalendarBoard.tsx,CalendarPage.tsx,EntryPopover.tsx,calendar.css}`、`src/pages/list/{ListPage.tsx,EntryRow.tsx,listGroups.test.ts}`、`src/pages/backpack/{BackpackPage.tsx,TaskPool.tsx}`、`src/pages/review/{ReviewPage.tsx,Recap.tsx,review.css}`、`src/app/{bootstrap.ts,MainApp.tsx,MiniApp.tsx,QuickBarApp.tsx,ReviewScreen.tsx,TimeScreens.tsx,actions.ts,applicationController.ts}`、`src/app/dev/{HomePreview.tsx,ListPreview.tsx,MiniPreview.tsx,M3Preview.tsx}`、`src/ui/controls/{Dropdown.tsx,controls.css}`、`src/ui/dev/Gallery.tsx`、`client/applicationClient.ts`、`mcp/{main.ts,server.ts,http.ts}`、`cli/main.ts`。
- **实际运行的只读命令**：
  - `git status --short`（确认工作区未提交文件与 `evidence/journal-real.json` 状态，未触碰任何已有文件）；
  - `git grep -n "run(" src/` 与 `git grep -n "runOperation(" src/`（逐一核对全部 52 处生产调用点、41 处测试调用点与 10 处 `runOperation` 调用点）；
  - `git grep -n "sleep" src/`（核对 `homeService.sleep` 在测试中的引用）；
  - `git show v0.2.5:src/data/journal.ts`、`git show v0.2.5:src/data/repos.ts`、`git show v0.2.5:src/app/bootstrap.ts`（审计 `v0.2.5` 对未知目录与 `.journal` 恢复的代码行为）；
  - 检查 `../UI参考截图/v0.3.0-beta.3-*` 文件列表（共 17 张参考截图）。
- **未验证项**：
  - 本轮为纯方案审核，未修改生产代码、未执行构建或真实窗口运行测试（均属未验证，留待方案修正并实施后在 E9 实测）。

---

## 需要用户决定

本次发现的 P1–P9 均属于实现机制与代码契约层面的技术修正，不改变你已拍板的任何产品规则或界面原型，**无需你额外做新的产品决定**；方案作者按 P1–P8 修订执行方案与 ADR 0019 后即可开工。
