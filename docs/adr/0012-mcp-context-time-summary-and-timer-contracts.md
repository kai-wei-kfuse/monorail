# ADR 0012：MCP 上下文、时间统计恒等式、计时状态令牌与自包含分发包

状态：Accepted · 2026-11-03 · M6–M8，落实 ADR 0009 与 `docs/mcp/requirements-and-design.md` §3–§5（B3/B4/B5 及 N2–N4）。

主审修复补充 v1.1（2026-11-03）：依据 ADR 0013，完整 snapshot 必含 tasks/records，查询不混读文件；若已提交但尚未发布最新快照，明确返回 SNAPSHOT_UNAVAILABLE。特殊项目/标签采用 Map 与无原型输出。统计支持 this_week。具体修复验证见 evidence/0.3.0-review-fix-report.md。

## 1. 上下文与累积通知（M6 / N2）
- `get_context` 在单次一致性读取中返回 `operation_id`（服务端签发 UUID）、`expected_state`（当前计时语义状态令牌）、`as_of`、`timer`（含当前 `mode`、`open_entry`、`paused_target`、`pending`、`current_card`、`rest` 与当前允许调用的 `allowed_actions`）、`pending_actions` 及 `options`（可选项目、已知标签与插入型预设）。
- 由于 `commit.ts` 每次事务的 `tx.notices` 仅记录当次事务新增通知，后续事务（如启动时的 `newDay`）会使 `ctx.snapshot().notices` 变回空数组；因此 `Ctx` 通过 `notices()` 接口读取累积未消除通知（生产环境由 `bootstrap.ts` 注入 `() => appStore.getState().notices`，测试环境由 `createContext` 通过 `appendNotices` 累积），并结合未回答的 `离线追问` 条目生成 `pending_actions`。

## 2. 待办捕捉与精确查找（M6 / N4）
- `capture_todo` 在同一份 `runOperation` journal 中完成 `saveRecordInTx`（`kind: '待办'`）、卡片转换/关联与回执写入，不改变当前计时与 `expected_state`。
  - 未指定 `task_id` 时，沿用 `reconcile` 与 E4 规则自动创建单事项支线任务（不受支线格上限阻断）。
  - 显式传入 `task_id` 时，在事务内校验目标任务存在于当前背包（`inBackpack(task)`），且主线任务满足 `replaceableSingle` 占位替换或 `itemCapacity > 0`（否则报 `TASK_NOT_IN_BACKPACK` / `MAIN_TASK_FULL`）。
- `find_items` 支持按 `idea` / `todo_card` / `task` / `all` 检索，标记精确匹配 `exact_match`，并在非空关键词命中多项结果时返回 `ambiguous: true`，防止低成本模型盲猜首个 ID。

## 3. 时间统计三路互斥恒等式与时钟校验（M6 / B3）
- 单轨运行期间空闲与暂停均存在 `project === '待机'` 的实体 `TimeEntry`，且领域层保证待机不与任何其他条目重叠（`entry.ts:24-25`）。
- `get_time_summary` 与 `list_time_entries` 从单次一致性快照与同一 `as_of` 取数，先经 `assertClockConsistent` 校验所有记录不存在晚于 `as_of` 或起止倒置（否则明确报 `CLOCK_INCONSISTENT`，绝不静默把 `as_of` 推向未来）。
- 区间右端点按 `effective_end = min(end, max(start, as_of))` 裁切（未来日期返回 `0` 时长，非法日历日如 `2026-02-31` 显式报 `INVALID_DATE`）。
- `get_time_summary` 将 `interval_elapsed_ms` 严格拆分为互斥三项：
  1. `non_idle_covered_ms`：非待机记录（含工作、学习、生活、睡眠、离线等，不命名为“有效工作时间”）裁切后的并集时长；
  2. `idle_ms`：待机记录时长（细分为普通待机 `idle_plain_ms` 与已暂停 `paused_ms`）；
  3. `untracked_ms`：无任何记录的真实空白时长；
  满足恒等式 `interval_elapsed_ms = non_idle_covered_ms + idle_ms + untracked_ms`，并行重复累计量为 `overlap_excess_ms = non_idle_recorded_ms - non_idle_covered_ms`。

## 4. 计时状态令牌、前置拦截与暂停后停止修复（M7 / B4 / N3 / N4）
- `timerStateToken` 从 `(open_entry.id, open_entry.started_at, open_entry.kind, open_entry.project, open_entry.card_id, state.current_card, card.status, state.pending_id, state.pending_at, state.resume_entry_id, state.rest.started_at)` 生成语义令牌；保存想法或捕捉待办不会使计时令牌失效。
- 所有计时控制工具遵循固定事务内顺序：**① `operation_id` 幂等回执短路 → ② `expected_state` 比对（不匹配报 `STATE_CHANGED`） → ③ 领域前置条件检查（`IN_DEGRADE_REST` / `IN_AWAY_ACTIVITY` / `PENDING_CONFIRMATION`） → ④ 单事务执行与卡片对齐（`alignInTx`）**。
- 修复共用服务 `timerService.stopInTx` 在暂停态（`project === '待机' && kind === '暂停'`）下因 `isIdle(entry)` 提前返回导致 `resume_entry_id` 未清空、进行中卡片未释放的缺陷，桌面 UI、小窗与 MCP 共用同一修复。
- 区分临时离开回来（`return_from_break`：要求 `open.kind === '插入'`，允许从待机插入时 `resume_entry_id === null` 正常退回待机）与暂停继续（`resume_timer`：要求存在有效 `resume_entry_id`，否则报 `NO_RESUME_TARGET`）。
- `start_timer` 与 `add_time_entry` 共用 `validateUserProject` 与 `validateUserTags`：禁止传入 `SYSTEM_PROJECTS`（`RESERVED_PROJECT`），未知项目直接报 `UNKNOWN_PROJECT` 并列出可选项目，不隐式修改 `settings.yaml`。

## 5. 自包含分发包与双传输交付（M8 / B5）
- `scripts/build-mcp.mjs` 使用 `esbuild` 将 `mcp/main.ts` 及其运行时依赖、版本号内联打包为单文件 `dist-mcp/monorail-mcp.mjs`，并在 `tauri.conf.json` `bundle.resources` 中随安装包分发，`mcp-host.json` 同步记录 `mcp_entry` 路径。
- 该产物可在不含源码仓库与 `node_modules`、路径含空格与中文的干净目录下直接通过 Node 24 以默认 stdio 或 `--http --port <1..65535>` 启动。
