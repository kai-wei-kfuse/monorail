# 单轨（MONORAIL）共享应用接口与 CLI 指南（0.3.3）

当前版本 **0.3.3**。单轨以桌面端单写入者（`ApplicationController`）为核心，向上暴露一套由 [src/shared/application.ts](../../src/shared/application.ts) 统一定义、由 [client/applicationClient.ts](../../client/applicationClient.ts) 强类型校验的 **41 项共享应用方法（30 写、11 读）**，同时驱动两个并列外部适配器：

- **MCP 适配器**（`mcp/` → `dist-mcp/monorail-mcp.mjs`）：面向原生支持 MCP（`2025-11-25` / `2026-07-28`，stdio 或本机 Streamable HTTP）的宿主。详见 [mcp/README.md](../../mcp/README.md)。
- **CLI 适配器**（`cli/` → `dist-cli/monorail-cli.mjs`）：面向具备命令行/Shell 执行能力的代理、自动化脚本与终端用户。自包含单文件包**不打包** `@modelcontextprotocol/*` 依赖。

## 给 agent 的规则（0.3.1）

> 单轨的数据目录（`timelog/`、`records/`、`cards/`、`tasks/`、`plans/`、`history/` 等）只能由单轨程序读写。直接修改这些文件不会记入操作历史，还会让单轨之后的操作报「External edit」而失败。如果 CLI 没有你需要的命令、MCP 没有你需要的工具或权限，请停下并告诉用户：做不到，缺的是什么功能。不要改文件、写脚本或用其他办法绕过。

这段话写在 `monorail --help` 的开头、`--help --json` 的顶层 `rules` 字段、未知命令报错和参数错误默认的 `next_step` 里；MCP 那边在握手 `instructions` 和 `get_context` 描述里。文案只有一份，在 [src/shared/agentRules.ts](../../src/shared/agentRules.ts)。这只是提示词层面的约束，挡不住执意绕过的 agent。

---

## 1. 架构与代码阅读路径（面向新 Session）

1. **权威契约注册表**：[src/shared/application.ts](../../src/shared/application.ts)
   - `applicationContracts` 将全部 41 个方法名映射到 `{ input, output, readOnly }`。
   - `ApplicationMethod`、`ApplicationInput<M>`、`ApplicationOutput<M>` 与 `applicationRequest` 均从同一契约派生，无第二份手写请求/返回类型。
   - `lookupResult`（`get_operation_result`）在 `committed` 分支包含 `request: { method, arguments }`，直接读取持久化回执 `receipts/<uuid>.json` 中的规范化请求参数。
2. **结构化错误模型**：[src/shared/appError.ts](../../src/shared/appError.ts)
   - `ApplicationError` 与 `applicationErrorSchema` 承载 `{ status: 'error', code, category: 'not_executed' | 'result_unknown', message, next_step, latest_context? }`。
3. **本机管道与类型化客户端**：[client/pipe.ts](../../client/pipe.ts) & [client/applicationClient.ts](../../client/applicationClient.ts)
   - `unknown` 严格限制在 `ApplicationTransport` 边界；`createApplicationClient` 在发送前校验输入 schema（失败报 `INVALID_INPUT` 且不发请求），在接收后校验输出 schema（不符报 `INVALID_RESPONSE` / `result_unknown`）。
   - `callDesktop` 负责 Windows Named Pipe 通信、`EBUSY` 与 `ENOENT` 严格区分、以及按 `mcp-host.json` 的单实例 `--background` 按需拉起。
   - Windows 默认启动经 `client/windowsLauncher.ts` 使用 PowerShell/CIM 本机进程服务，让后台独立于 MCP/CLI 宿主清理；临时观察进程保留启动失败/实际退出检测，在就绪或最后一名等待者结束后释放。组件不可用时报 `STARTUP_FAILED`，不静默回退，见 ADR 0015。
4. **桌面端统一控制器与桥接**：[src/app/applicationController.ts](../../src/app/applicationController.ts) & [src/app/applicationBridge.ts](../../src/app/applicationBridge.ts)
   - `handleApplicationRequest` 复用 `recordService` / `homeService` / `planService` / `dealService` / `cardService` / `backpackService` / `ideaService` / `recapService`、完整 `Snapshot` 以及 `runOperation` / `readOperation` / `readSerial`。
5. **CLI 入口与命令实现**：[cli/main.ts](../../cli/main.ts)、[cli/commands.ts](../../cli/commands.ts)、[cli/execute.ts](../../cli/execute.ts)、[cli/output.ts](../../cli/output.ts)
   - ESLint（[eslint.config.mjs](../../eslint.config.mjs)）强制隔离：`client/`、`cli/`、`mcp/` 仅能从 `src/shared` 导入共享契约，不能直接碰触 `src/app`、`src/services`、`src/data`；`cli/` 与 `mcp/` 互不依赖。

---

## 2. CLI 命令对照表（41 个应用方法）

运行方式：
- 开发源码：`node cli/main.ts <command> ...`（或 `npm run cli -- <command> ...`）
- 自包含发行包：`node <安装目录或dist-cli>/monorail-cli.mjs <command> ...`

| CLI 命令 | 对应应用方法 | 参数说明 |
|---|---|---|
| `monorail context` | `get_context` | 可选重复 `--section timer\|pending_actions\|options` |
| `monorail idea add [<text>]` | `save_idea` | 正文三选一（`<text>` / `--text-file <path>` / `--stdin`），可选 `--needs <text>`、`--operation-id <uuid>`；多行时首行映射为标题、其余行进入详情，回执仍返回完整 `text` |
| `monorail idea create` | `create_idea` | 可选 `--title <title>`（单行，仅写详情可省略）、`--details-file <path> \| --details-stdin`（多行 Markdown 详情）、`--needs <text>`、`--operation-id <uuid>`；返回 `IdeaSummary` 与 `record_revision`（0.3.3，ADR 0026/0029） |
| `monorail idea show <idea-id>` | `get_idea_details` | 必填 `<idea-id>`（UUID）；只读返回 `IdeaDocument`（含 `details_markdown` 与 `record_revision`）及签发给后续写调用的 `operation_id`（0.3.3，ADR 0026/0029） |
| `monorail idea edit <idea-id>` | `update_idea` | 必填 `<idea-id>`（UUID）；至少一项：`--title <title>`、`--details-file <path> \| --details-stdin \| --clear-details`、`--needs <text> \| --clear-needs`；可选 `--record-revision <token>`、`--operation-id <uuid>`（0.3.3，ADR 0026/0029） |
| `monorail idea convert <idea-id>` | `convert_idea_to_task` | 必填 `<idea-id>`（UUID）；目标二选一：`--task-id <task-id>`（放入指定进行中任务，多主线时按 ID 选择）或 `--new-task-name <name> --slot 主线\|支线 [--default-project <name>]`（同事务新建任务）；事项三选一：重复 `--item <content>`、`--items-file <path>` 或 `--items-stdin`；可选 `--record-revision <token>`、`--operation-id <uuid>`（0.3.3，ADR 0029） |
| `monorail idea done <idea-id>` | `complete_idea` | 必填 `<idea-id>`（UUID，通过 `find --kind idea` 获取）；可选 `--operation-id <uuid>`。只有想法池里的想法能标记；已完成的再标记返回 `noop: true`（0.3.0-beta.4，ADR 0020） |
| `monorail idea reopen <idea-id>` | `reopen_idea` | 必填 `<idea-id>`（UUID）；撤销想法完成并放回活跃池（0.3.2，ADR 0023） |
| `monorail todo add [<text>]` | `capture_todo` | 正文三选一，可选 `--task-id <id>`、`--due-at <iso>`、`--operation-id <uuid>`；`--blocking` 0.3.1 起不起作用（删除阻塞机制），仍接受以兼容旧脚本 |
| `monorail find [<query>]` | `find_items` | 可选 `--kind idea\|todo_card\|task\|all`、`--include-archived`；想法按兼容全文 `C(title, details)`、标签与 `needs` 检索并返回兼容全文 `text` |
| `monorail time summary` | `get_time_summary` | 可选 `--day today\|yesterday\|this_week\|YYYY-MM-DD`、`--day-mode activity\|calendar` |
| `monorail time entries` | `list_time_entries` | 必填 `--from <iso>`、`--to <iso>`（带时区偏移） |
| `monorail time add [<description>]` | `add_time_entry` | 正文三选一，必填 `--start <iso>`、`--end <iso>`；可选 `--project <name>`、重复 `--tag <tag>`、`--operation-id <uuid>` |
| `monorail entry edit <entry-id>` | `update_time_entry` | 必填 `<entry-id>`（通过 `time entries` 获取）；至少一项：`--start <iso>`、`--end <iso>`、`--description <text>`、`--project <name>`、重复 `--tag <tag>`（整体替换）或 `--clear-tags`；可选 `--operation-id <uuid>`、`--expected-state <token>`。规则同单轨日历：正在计时的只能改开始；来自卡的描述和项目要在卡上改；开着的待机不能改描述和项目（`ENTRY_IS_IDLE`）；结果的 `overlaps` 是新时段和这些已有记录重叠（并行保留，不改它们；被盖住的待机会让出来）；不能删除（0.3.1） |
| `monorail timer start [<description>]` | `start_timer` | 正文三选一，可选 `--project <name>`、重复 `--tag <tag>`、`--operation-id <uuid>`、`--expected-state <token>` |
| `monorail timer start-item <card-id>` | `start_task_item` | 必填 `<card-id>`（通过 `find` 或 `context` 获取）；可选 `--operation-id <uuid>`、`--expected-state <token>` |
| `monorail timer pause` | `pause_timer` | 可选 `--operation-id <uuid>`、`--expected-state <token>` |
| `monorail timer resume` | `resume_timer` | 可选 `--operation-id <uuid>`、`--expected-state <token>` |
| `monorail timer stop` | `stop_timer` | 可选 `--operation-id <uuid>`、`--expected-state <token>` |
| `monorail break start [<activity>]` | `start_break` | 正文三选一（活动名称或预设 ID），可选 `--operation-id <uuid>`、`--expected-state <token>` |
| `monorail break return` | `return_from_break` | 可选 `--operation-id <uuid>`、`--expected-state <token>` |
| `monorail break end-original` | `end_original_task` | 临时离开期间结束离开前的原计时，当前临时离开升级为普通自由计时（0.3.2） |
| `monorail plan show` | `get_task_plan` | 可选 `--day today\|tomorrow`；只读查看今天或明天的任务板（0.3.2） |
| `monorail plan add <card-id>` | `add_plan_item` | 必填 `--day <YYYY-MM-DD>`，可选 `--priority 普通\|高`、`--today-minutes <N>`、`--operation-id <uuid>`（0.3.2） |
| `monorail plan remove <card-id>` | `remove_plan_item` | 必填 `--day <YYYY-MM-DD>`，可选 `--operation-id <uuid>`（0.3.2） |
| `monorail plan edit <card-id>` | `update_plan_item` | 必填 `--day <YYYY-MM-DD>`，至少一项 `--priority 普通\|高` 或 `--today-minutes <N>`，可选 `--operation-id <uuid>`（0.3.2） |
| `monorail plan carry` | `confirm_plan_carry` | 必填 `--day <YYYY-MM-DD>`，以及 `--keep <card-id>...` 或 `--keep-none` 二选一（0.3.2） |
| `monorail plan skip-today` | `skip_today_plan` | 必填 `--day <YYYY-MM-DD>`；标记今天先不排任务板（0.3.2） |
| `monorail plan draw` | `draw_task_item` | 只读按权重抽取一张待办事项卡，不自动开始计时（0.3.2） |
| `monorail plan skip <card-id>` | `skip_task_item` | 必填 `--day <YYYY-MM-DD>`；将当前候选记入本轮已看过（seen），随后可再调用 `plan draw`（0.3.2） |
| `monorail item done <card-id>` | `complete_task_item` | 完成当前计时/暂停卡片或直接完成背包进行中任务的待做子项；可选 `--note <text>\|--note-file <path>\|--stdin`、`--finish-early`（时间盒未达量确认）、`--operation-id <uuid>`、`--expected-state <token>`（0.3.2，ADR 0022/0023） |
| `monorail item reopen <card-id>` | `reopen_task_item` | 取消单个已完成子项的完成状态并恢复为待做（父任务已完成时同事务恢复父任务，满格可传 `--make-room freeze\|abandon:<task-id>`）（0.3.2，ADR 0022/0023） |
| `monorail item keep <card-id>` | `keep_going_task_item` | 当前卡片记录进度笔记并放回待做；可选 `--note <text>\|--note-file <path>\|--stdin`、`--operation-id <uuid>`、`--expected-state <token>`（0.3.2） |
| `monorail item split <card-id>` | `split_task_item` | 必填 `--today-content <text>`、`--rest-content <text>`，可选 `--rest-minutes <N>`、`--operation-id <uuid>`、`--expected-state <token>`（0.3.2） |
| `monorail task create` | `create_task` | 必填 `--name <name>`、`--slot 主线\|支线`；可选 `--default-project <name>`、事项来源（重复 `--item <content>` / `--items-file <path>` / `--items-stdin`，省略则创建空任务）、`--operation-id <uuid>`；不自动开始计时（0.3.3，ADR 0029） |
| `monorail task show <task-id>` | `get_task_details` | 只读查询单个任务详情、全部子项、完成批次 `completion_id` 与重新打开前置条件（0.3.2） |
| `monorail task done <task-id>` | `complete_task` | 整张完成背包中的主/支线任务（含剩余未完成子项并生成完成批次快照，释放背包槽位）（0.3.2，ADR 0022） |
| `monorail task reopen <task-id>` | `reopen_task` | 必填 `--completion-id <uuid>` 或 `--legacy`，满格可选 `--make-room freeze\|abandon:<task-id>`；重新打开已完成任务（0.3.2，ADR 0022） |
| `monorail recap show` | `get_recap` | 只读统计回看；可选 `--period week\|lastWeek\|cycle\|month\|quarter\|year\|custom`（`custom` 必填 `--from` 与 `--to`）、`--dimension project\|tag\|source\|activity`、`--include-idle`、`--bucket <id>`（0.3.2） |
| `monorail history list` | `list_operation_history` | 只读列出操作历史；可选 `--from-day <YYYY-MM-DD>`、`--to-day <YYYY-MM-DD>`、`--source manual\|system\|mcp\|cli\|automation\|all_automation`、`--filter-agent <name>`、`--method <name>`、`--subject-type <type>`、`--subject-id <id>`、`--operation-id <uuid>`（0.3.2） |
| `monorail operation get <id>` | `get_operation_result` | 必填 `<id>`（UUID），只读查询持久化回执 |

通用选项：`--help`（`-h`）、`--version`（`-v`）、`--json`。`--help`、`--version` 与本地参数校验错误**不会**连接或启动单轨后台进程。`--help --json` 输出 `{ status: "ok", kind: "help", version, rules, commands }`，其中 `rules` 是上面那段给 agent 的规则（0.3.1 新加的字段）。

`monorail context` 的 `today_plan`（今日任务板，0.3.1）为 `null` 表示任务模式关掉了；今天还没排是 `items: []`，不是 `null`。（代码里快照缺板子时也给 `null`，但每次提交发布的快照都带板子，启动完成前 `get_context` 直接报 `APP_NOT_READY`，所以正常运行时只有任务模式关掉这一种情况。）

---

## 3. 多行、中文、Markdown 长详情与结构化事项输入规范

对需要单字段正文的 5 个命令（`idea add`、`todo add`、`time add`、`timer start`、`break start`），输入来源严格**三选一**（同时传多个或全部省略均返回退出码 `2`）：

1. **位置参数**：`node dist-cli/monorail-cli.mjs idea add "简短想法 #产品"`
2. **文件读取（推荐用于多行/含引号/`$`/反引号/`&`/`|` 内容）**：
   ```powershell
   node dist-cli/monorail-cli.mjs idea add --text-file ./note.txt --needs "保留多行格式" --json
   ```
3. **标准输入（`--stdin`）**：
   ```powershell
   Get-Content -Raw -Encoding utf8 ./note.txt | node dist-cli/monorail-cli.mjs todo add --stdin --json
   ```

对 0.3.3 新增的想法 Markdown 详情（`idea create`、`idea edit`）与任务事项列表（`task create`、`idea convert`）：

1. **Markdown 详情字面输入（`--details-file` / `--details-stdin` / `--clear-details`）**：
   ```powershell
   Set-Content -Path ./details.md -Value "第一段说明`n- https://example.com`n#标签" -Encoding utf8
   node dist-cli/monorail-cli.mjs idea create --title "想法标题 #架构" --details-file ./details.md --json
   Get-Content -Raw -Encoding utf8 ./details.md | node dist-cli/monorail-cli.mjs idea edit <idea-id> --details-stdin --json
   node dist-cli/monorail-cli.mjs idea edit <idea-id> --clear-details --json
   ```
2. **任务事项输入（重复 `--item` 结果卡，或 `--items-file` / `--items-stdin` JSON 数组）**：
   ```powershell
   node dist-cli/monorail-cli.mjs task create --name "第二主线：编译器实验" --slot 主线 --item "搭建词法分析器" --json
   Set-Content -Path ./items.json -Value '[{"content":"精读论文第 3 节","type":"时间盒卡","timebox_minutes":45},{"content":"写出实验总结","type":"结果卡","timebox_minutes":null}]' -Encoding utf8
   node dist-cli/monorail-cli.mjs idea convert <idea-id> --task-id <task-id> --items-file ./items.json --json
   ```

CLI 内部直接通过结构化 JSON 管道发送请求，从不对用户文本执行 shell 拼接或 `eval`。

---

## 4. JSON 输出契约、退出码与幂等重试指南

### 4.1 `--json` 输出结构
传入 `--json` 时，`stdout` 保证只输出一个完整 JSON 对象，无任何日志污染：
- **成功（退出码 `0`）**：
  ```json
  {
    "status": "ok",
    "method": "save_idea",
    "operation_id": "fd5c2b9a-...",
    "result": {
      "status": "committed",
      "operation_id": "fd5c2b9a-...",
      "data": { "id": "...", "text": "...", "created_at": "...", "tags": [], "pool": "活跃池" },
      "committed_at": "...",
      "replayed": false,
      "warnings": [],
      "next_operation_id": "..."
    }
  }
  ```
- **失败（退出码 `2 | 3 | 4 | 5 | 130`）**：
  ```json
  {
    "status": "error",
    "method": "start_timer",
    "operation_id": "fd5c2b9a-...",
    "error": {
      "status": "error",
      "code": "STATE_CHANGED",
      "category": "not_executed",
      "message": "STATE_CHANGED：...",
      "next_step": "...",
      "latest_context": { ... }
    }
  }
  ```

### 4.2 退出码语义

| 退出码 | 分类 | 典型错误码与处理方式 |
|---|---|---|
| `0` | 成功 | `committed`（含 `replayed: true` 或非空 `warnings`）、`noop: true`、只读查询成功 |
| `2` | CLI 用法/参数错误 | `USAGE_ERROR`、`INVALID_INPUT`（缺参数、未知选项、时间无时区、`--text-file` 读取失败；尚未调用后端） |
| `3` | 业务前置或状态拒绝（`not_executed`） | `STATE_CHANGED`、`OPERATION_CONFLICT`、`PENDING_CONFIRMATION`、`IN_AWAY_ACTIVITY`、`IN_DEGRADE_REST`、`NO_RESUME_TARGET`、`CARD_NOT_FOUND`、`TASK_NOT_IN_BACKPACK` 等 |
| `4` | 环境/连接/初始化错误（`not_executed`） | `SETUP_REQUIRED`、`CONFIG_CORRUPTED`、`PIPE_PERMISSION_DENIED`、`PIPE_BUSY`、`UNAVAILABLE`、`STARTUP_FAILED`、`RECOVERY_FAILED` |
| `5` | 结果未知（`result_unknown`） | `RESULT_UNKNOWN`、`HOST_LOST`、`JOURNAL_BLOCKED`、`SNAPSHOT_UNAVAILABLE`、`CANCELLED_AFTER_SEND`、`INVALID_RESPONSE` |
| `130` | 发送前取消（`not_executed`） | `CANCELLED` |

### 4.3 结果未知（Exit 5）与跨进程幂等重试流程

1. **默认写命令（未传 `--operation-id`）**：CLI 自动先调 `get_context` 获取 `operation_id`（计时命令同时获取 `expected_state`）。若写请求中途断开返回退出码 `5`，错误 JSON 与 stderr 均会输出本次已签发的 `operation_id`。
2. **核对结果**：
   ```powershell
   node dist-cli/monorail-cli.mjs operation get <operation-id> --json
   ```
3. **带 `--operation-id` 确定性重试**：
   - CLI 先调用 `get_operation_result` 查询该 `<operation-id>`：
     - 若回执已存在（`committed`）且用户未显式传 `--expected-state`，CLI 从回执 `request.arguments.expected_state` 恢复当时的原状态令牌，同时保留用户本次命令行传入的业务参数（正文、卡片 ID、项目、标签等），再交由服务端 `runOperation` 比对规范化请求。
     - 因此：**即使后续计时状态已经推进，原样重跑同一条带 `--operation-id` 的计时命令仍能稳定命中回执（`replayed: true`，退出码 `0`）；而一旦篡改任何业务参数或显式传入不一致的 `--expected-state`，服务端必定拒绝并返回 `OPERATION_CONFLICT`（退出码 `3`）**。
     - 若回执为 `not_found`，CLI 按需获取当前上下文后以该 `--operation-id` 执行写入。

---

## 5. 调用方识别与操作历史（0.3.0-beta.3，[ADR 0019](../adr/0019-operation-history.md) 第 6 条）

改了数据的写调用会记进单轨的「操作历史」，并写明是 MCP 还是 CLI、哪个 agent 调的。调用方放在请求顶层的可选 `origin` 里，不进 `arguments`，不影响参数校验，也不参与回执冲突判断。它是自报、未验证的，只用于显示和筛选。

- **CLI**：按下面的顺序识别，取第一个有值的。
  1. 全局参数 `--agent <名字>`（任何命令都可以带，例如 `monorail --agent 手环同步 idea add "…"`）。
  2. 环境变量 `MONORAIL_AGENT`。
  3. 已知 agent 的环境变量：`CLAUDECODE` → Claude Code、`CODEX_SANDBOX` → Codex、`GEMINI_CLI` → Gemini CLI、`CURSOR_AGENT` → Cursor。对照表在 [cli/agentDetect.ts](../../cli/agentDetect.ts)，**还没有逐个用真实工具核对**。
  4. 都没有就记「CLI · 未识别」。
- **MCP**：每次工具调用时读握手里的 `clientInfo`，原始名字经 [src/shared/agents.ts](../../src/shared/agents.ts) 的对照表换成显示名，表里没有的按原样显示。旧协议（`2025-11-25`）的本机 HTTP 是无状态的，每个请求新建 server，读不到握手信息，记「MCP · 未识别」。
- **旧客户端**：没带 `origin` 的请求照常执行，记「自动化 · 未识别」。
- **更换单轨版本后请重启 AI 客户端**。新版客户端（带 `origin`）连旧版桌面端时，旧版会把这个字段当作参数错误拒绝。报错会照常返回，不会被当成成功。
