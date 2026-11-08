# 单轨（MONORAIL）MCP 服务

版本号以 `package.json` 为准。基于统一的共享应用接口层（[src/shared/application.ts](../src/shared/application.ts) + [client/applicationClient.ts](../client/applicationClient.ts)），已实现官方 SDK v2 双时代（`2025-11-25` / `2026-07-28`）× 双传输（stdio 默认 / 本机 Streamable HTTP 可选）、同 journal 持久化操作回执（`operation_id`）、按需 `--background` 后台启动、宿主生命周期保护、以及 **41 项核心工具（30 写、11 读；0.3.0-beta.4 加 `complete_idea`，0.3.1 加 `update_time_entry`，0.3.2 补齐 A–D 全量能力共新增 19 项工具，0.3.3 新增想法标题/Markdown 详情与多主线任务创建/转换共 5 项工具）**。并列的命令行入口说明见 [docs/application/README.md](../docs/application/README.md)。

## 给 agent 的规则（0.3.1）

> 单轨的数据目录（`timelog/`、`records/`、`cards/`、`tasks/`、`plans/`、`history/` 等）只能由单轨程序读写。直接修改这些文件不会记入操作历史，还会让单轨之后的操作报「External edit」而失败。如果 CLI 没有你需要的命令、MCP 没有你需要的工具或权限，请停下并告诉用户：做不到，缺的是什么功能。不要改文件、写脚本或用其他办法绕过。

这段话在 MCP 握手的 `instructions` 里，也写在 `get_context` 工具描述的末尾；文案只有一份，在 [src/shared/agentRules.ts](../src/shared/agentRules.ts)。这只是提示词层面的约束，挡不住执意绕过的 agent。

## 工具清单（M4–M8、A1–A4、0.3.2 A–D & 0.3.3 想法详情与多主线，共 41 项）

| 工具名 | 类型 | 作用与核心契约 |
|---|---|---|
| `get_context` | 只读 | 获取当前计时状态、待处理通知（`pending_actions`，含累积未消除的离线追问、空闲追问等）、可选项目/标签/快捷离开项、今日任务板（`today_plan`，0.3.1），并签发 `operation_id` 与 `expected_state`。`today_plan` 为 `null` 表示任务模式关掉了；今天还没排是 `items: []`，不是 `null`。（代码里快照缺板子时也给 `null`，但每次提交发布的快照都带板子，启动完成前 `get_context` 直接报 `APP_NOT_READY`，所以正常运行时只有任务模式关掉这一种情况。） |
| `get_operation_result` | 只读 | 按 `operation_id` 核对操作是否已在 journal 中持久化落盘（`committed` / `not_found`）；`committed` 额外返回持久化规范化请求 `request: { method, arguments }`。 |
| `save_idea` | 幂等写 | 保存文字到想法池（支持多行与 `#标签`、可选 `needs`；多行时首行映射为标题、其余行进入详情，回执仍返回完整 `text`），不创建任务、不开始计时。 |
| `create_idea` | 幂等写 | 按单行 `title` 与可选多行 Markdown `details_markdown`、`needs` 创建想法并返回 `IdeaSummary`（含 `has_details` 与 `record_revision`），不开始计时（0.3.3，ADR 0026/0029）。 |
| `get_idea_details` | 只读 | 按 `idea_id` 读取完整 `IdeaDocument`（含 `details_markdown` 与 `record_revision`）并签发后续写调用可用的 `operation_id`，不续期、不写历史（0.3.3，ADR 0026/0029）。 |
| `update_idea` | 幂等写 | 凭 `record_revision` 修改想法的 `title`、`details_markdown` 或 `needs`（省略保持原值，空串清空；校验乐观并发修订令牌，返回 `IdeaSummary` 与 `noop`）（0.3.3，ADR 0026/0029）。 |
| `complete_idea` | 幂等写 | 把想法池里的一个想法（`idea_id`，先用 `find_items` 查到）标记为已完成，进入想法池的「已完成」列表；已完成的再标记返回 `noop: true`；冷库、已转任务的报 `IDEA_NOT_ACTIVE`（0.3.0-beta.4，ADR 0020）。`find_items` 的想法 `pool` 多一个值「已完成」。 |
| `reopen_idea` | 幂等写 | 撤销想法的完成状态并放回活跃池（0.3.2，ADR 0023）。 |
| `capture_todo` | 幂等写 | 捕捉待办记录并在同一事务生成待办卡片（缺省归入单事项支线任务，可选传入背包中已有 `task_id`），不改变当前计时。 |
| `create_task` | 幂等写 | 在背包中新建主线或支线任务（遵循 `mainTasks`/`sideTasks` 与 `mainItems` 容量上限；省略 `items` 创建空任务，提供 `items` 则同事务生成结果卡或时间盒卡），不自动开始计时（0.3.3，ADR 0029）。 |
| `convert_idea_to_task` | 幂等写 | 凭 `record_revision` 将想法转化为任务事项，放入指定现有进行中任务（`target.kind="existing_task"`，多主线按 ID 选择）或同事务新建主/支线任务（`target.kind="new_task"`）；原想法完整详情保留并标为已转任务（0.3.3，ADR 0029）。 |
| `find_items` | 只读 | 按关键词和类别（`idea` / `todo_card` / `task` / `all`）检索；想法按兼容全文 `C(title, details)`、标签与 `needs` 匹配并返回兼容全文 `text`；多项命中时 `ambiguous=true`，不替用户猜测首个 ID。 |
| `get_time_summary` | 只读 | 统计 `today` / `yesterday` / `this_week` / `YYYY-MM-DD`（活动日或自然日）；`non_idle_covered_ms + idle_ms + untracked_ms = interval_elapsed_ms`，并另报并行重复累计量 `overlap_excess_ms`。 |
| `list_time_entries` | 只读 | 按显式起止时间（带时区 ISO 字符串 `from`/`to`）返回完整明细及区间内裁切时长（`clipped_ms`）。 |
| `start_timer` | 幂等写 | 开始或切换自由活动计时（需传 `operation_id` 与 `expected_state`；缺省项目为「未分类」，禁止传系统保留项目或未知项目）。 |
| `start_task_item` | 幂等写 | 对指定待办事项卡片（`card_id`）开始计时并对齐卡片状态。 |
| `pause_timer` | 幂等写 | 暂停正在进行的普通或卡片计时，保留返回目标。 |
| `resume_timer` | 幂等写 | 从已暂停状态恢复原活动或卡片计时（无返回目标时报 `NO_RESUME_TARGET`）。 |
| `stop_timer` | 幂等写 | 停止当前计时（或清除已暂停会话）并回到普通待机，同时释放进行中的卡片。 |
| `start_break` | 幂等写 | 插入短暂临时离开活动（如「上厕所」「吃饭」），底层原活动保留为返回目标。 |
| `return_from_break` | 幂等写 | 结束当前临时离开活动（`kind=插入`），恢复原活动/卡片（若从待机插入则回到待机）。 |
| `end_original_task` | 幂等写 | 临时离开期间直接结束离开前的原计时，当前临时离开升级为普通自由计时（0.3.2）。 |
| `add_time_entry` | 幂等写 | 手动补录过去已完成的时间段（`start`/`end`），保留并行记录语义并返回重叠明细（`overlaps`）。 |
| `update_time_entry` | 幂等写 | 修改一条已有计时记录（`entry_id` 来自 `list_time_entries`）的 `start` / `end` / `description` / `project` / `tags`，至少改一项；需传 `operation_id` 与 `expected_state`。规则同单轨日历：正在计时的只能改开始（传 `end` 报 `ENTRY_RUNNING`）；来自卡的记录，描述和项目要在卡上改（报 `ENTRY_FROM_CARD`）；`tags` 整体替换；开着的待机不能改描述和项目（报 `ENTRY_IS_IDLE`，要开始做事请用 `start_timer`）。返回的 `overlaps` 是新时段和这些已有记录重叠（并行保留，不改它们；被盖住的待机会让出来）。不能删除记录（0.3.1，ADR 0021）。 |
| `get_task_plan` | 只读 | 读取今天或明天的任务板（`day: 'today' \| 'tomorrow'`），结合当前计时索引实时计算 `minutes_today`、`achieved` 与 `drawable_card_ids`（0.3.2）。 |
| `add_plan_item` | 幂等写 | 将背包进行中任务的待做卡片排进指定活动日（`YYYY-MM-DD`）的任务板（可选 `priority`、`today_minutes`）（0.3.2）。 |
| `remove_plan_item` | 幂等写 | 从指定活动日（`YYYY-MM-DD`）的任务板移出卡片（0.3.2）。 |
| `update_plan_item` | 幂等写 | 修改指定活动日（`YYYY-MM-DD`）任务板上某张卡的优先级或当天目标分钟数（0.3.2）。 |
| `confirm_plan_carry` | 幂等写 | 确认今日任务板上的昨日未完成带入项（显式传入保留卡片列表 `keep_card_ids`，全部移出传 `[]`）（0.3.2）。 |
| `skip_today_plan` | 幂等写 | 标记今天先不排任务板（`skip_until_planned=true`），允许直接按全背包规则抽卡（0.3.2）。 |
| `draw_task_item` | 只读 | 按今日任务板或全背包规则加权随机抽取一张待办事项卡片（只读，不修改 `current_card`，不自动开始计时）（0.3.2）。 |
| `skip_task_item` | 幂等写 | 换一张：把当前候选卡片记入本轮 `seen_card_ids`（若已看遍则开启新一轮），随后可再调用 `draw_task_item`（0.3.2）。 |
| `complete_task_item` | 幂等写 | 完成当前计时/暂停卡片或直接完成背包进行中任务的待做子项（时间盒未达量须 `finish_early=true`；当目标涉及当前计时时要求 `expected_state`）（0.3.2，ADR 0022/0023）。 |
| `reopen_task_item` | 幂等写 | 取消单个已完成子项的完成状态并恢复为待做（校验主线容量上限；若父任务已完成则同事务恢复父任务，满格支持 `make_room` 显式腾位）（0.3.2，ADR 0022/0023）。 |
| `keep_going_task_item` | 幂等写 | 当前卡片接着做：记录进度笔记、停止计时并将卡片放回待做（0.3.2）。 |
| `split_task_item` | 幂等写 | 拆分当前卡片为今天先做的一项与留到后面的剩余项（时间盒卡可指定 `rest_minutes`）（0.3.2）。 |
| `get_task_details` | 只读 | 读取单个任务的完整详情、全部子项、完成批次 `completion_id` 与重新打开前置条件（0.3.2）。 |
| `complete_task` | 幂等写 | 整张完成背包中的主线或支线任务（含剩余未完成子项并生成完成批次快照，释放背包槽位）（0.3.2，ADR 0022）。 |
| `reopen_task` | 幂等写 | 重新打开已完成任务并恢复回原主/支线槽位（通过 `completion_id` 恢复本批子项，无快照旧任务传 `null`；满格支持 `make_room`）（0.3.2，ADR 0022）。 |
| `get_recap` | 只读 | 读取统计回看数据（7 种周期 × 4 种维度、自定义起止日期、柱状桶筛选、环比对比、已完成事项与进展笔记）（0.3.2）。 |
| `list_operation_history` | 只读 | 读取指定活动日范围内的操作历史记录（支持按来源、调用方、方法、主体与 `operation_id` 筛选，返回 `bad_count` 与 `older_before_range`）（0.3.2）。 |

## 运行与配置

需要 Windows、Node 24，以及构建出的新版单轨（旧 0.2.5 安装版不含 MCP 入口）。

1. 构建自包含 MCP 与 CLI 入口及桌面端：
   ```powershell
   npm ci
   npm run build
   npm run tauri -- build --debug --no-bundle
   ```
   `npm run build`（或 `npm run mcp:build`）会同时产出脱离源码仓库与 `node_modules` 的两个自包含单文件包 `dist-mcp/monorail-mcp.mjs` 与 `dist-cli/monorail-cli.mjs`（CLI 包不携带 `@modelcontextprotocol/*` 依赖），NSIS 安装包亦会将二者随应用资源一同分发。
2. 首次使用需打开一次单轨完成数据目录初始化（在 `%APPDATA%\local.pixelrecord.app\` 下生成 `config.json` 与 `mcp-host.json`，其中登记 `executable`、`mcp_entry`、`cli_entry` 与 `pipe`）。若尚未初始化，MCP/CLI 调用会明确返回 `SETUP_REQUIRED`。
3. 完成首次初始化后，即使单轨已退出，MCP 收到请求时也会自动按 `mcp-host.json` 登记的可执行文件路径以 `--background` 启动单轨后台实例（窗口在创建前隐藏，不闪窗、不抢焦点，并发启动由单实例机制收敛）。Windows 启动器通过本机 PowerShell/CIM 的 `Win32_Process.Create` 创建独立后台，避免 Codex 等宿主结束 MCP 时清理其子进程树并终止计时；短期观察进程在管道就绪前保留实际启动/退出检测，就绪或等待取消后只释放观察进程。若 PowerShell/CIM/WMI 组件不可用，明确返回 `STARTUP_FAILED`，不静默改用会被宿主清理的直接启动。实现依据见 [ADR 0015](../docs/adr/0015-independent-windows-background-launch.md)。

### 客户端配置示例（stdio 默认）

可直接使用打包后的自包含入口 `dist-mcp/monorail-mcp.mjs`（支持路径含空格与中文，不要求工作目录在仓库内）：

```json
{
  "mcpServers": {
    "monorail": {
      "command": "node",
      "args": ["C:/path/to/monorail/dist-mcp/monorail-mcp.mjs"]
    }
  }
}
```

开发调试时也可直接指向源码入口 `C:/path/to/monorail/mcp/main.ts`。将示例替换为你的实际路径；安装版的入口路径可从上述 `mcp-host.json` 读取。stdout 仅用于 MCP JSON-RPC 消息；诊断信息输出至 stderr。

### 可选的本机 Streamable HTTP

```powershell
node dist-mcp/monorail-mcp.mjs --http --port 8765
```

显式启动后监听 `http://127.0.0.1:8765/mcp`（端口范围 `1..65535`，默认不随桌面端自启）。使用官方双时代 handler（同时支持 `2026-07-28` 与 `2025-11-25` stateless HTTP，不提供已废弃的 `2024-11-05` 双端点 HTTP+SSE），默认拒绝任何浏览器 `Origin`（含 `null`）并校验 `Host`（仅允许 `127.0.0.1` / `localhost`）。

### 调用方与操作历史（0.3.0-beta.3）

改了数据的工具调用会记进单轨的「操作历史」，来源记「MCP」，调用方取每次调用时握手里的 `clientInfo`（不缓存、不改工具参数、不让模型自报）。原始名字经 [src/shared/agents.ts](../src/shared/agents.ts) 换成显示名，表里没有的按原样显示；对照表还没有逐个用真实客户端核对。旧协议的无状态 HTTP 读不到握手信息，记「MCP · 未识别」。

**更换单轨版本后请重启 AI 客户端**：客户端拉起的 MCP 进程还是旧版本时，它和新的桌面端之间的字段可能对不上；新版 MCP 连旧版桌面端时，旧版会把新增的 `origin` 字段当作参数错误拒绝（报错照常返回，不会当成成功）。详见 [docs/application/README.md](../docs/application/README.md) 第 5 节。

## 典型调用流程

1. 调用 `get_context({})`，获取当前状态、`operation_id` 与 `expected_state`。
2. 调用写工具（如 `save_idea`、`capture_todo`、`start_timer`、`start_task_item`），原样复制 `operation_id`（计时写工具同时复制 `expected_state`）。
3. 每次成功写结果都会返回新的 `next_operation_id`（计时写工具还会返回更新后的 `expected_state`），供下一步写操作直接复制。
4. 若调用中途连接断开或返回 `RESULT_UNKNOWN`，使用原 `operation_id` 调用 `get_operation_result` 核对，或用同一 `operation_id` + 相同参数安全重试（命中回执时 `replayed: true`，零重复写入）。

### 结构化错误与重试

工具错误设置 `isError: true`，`structuredContent` 包含 `{status:"error", code, category, message, next_step, latest_context?}`，文本块提供同一对象的 JSON 表示。工具 outputSchema 明确声明成功/错误两种结构，以兼容会校验错误结果的旧客户端。

`not_executed` 表示请求未执行；`result_unknown` 表示不能据此次响应断言未写入，应先核对原操作 ID。`STATE_CHANGED` 等业务冲突附最新上下文及合法下一步；部分 journal 故障或快照不可用时不附伪造状态。成功响应的 `warnings` 非空仍代表数据已提交。

`PIPE_BUSY` 表示已有应用的管道暂忙，本次没有发出业务请求，也不会另启实例；只有 `ENOENT` 才进入按需启动流程。

## 验证命令

```powershell
npm run check
npm run mcp:build
npm run mcp:check
npm run mcp:smoke
npm run cli:smoke
npm run build
```
