# ADR 0029：0.3.3 新功能的 CLI / MCP 同版契约

状态：Accepted v0.1 · 2026-11-08。唯一维护方：coder-6；coder最终审核通过。依据用户确认及新增指令（Runner `01M6WQPHN8EDD2JA3ZSM57YDWN` / `01M6WQPHQKEA5KZ7298QE2CJ2N`）、主审范围要求 `01M6WQQ6Y5ZDSZNFYXH3VK450R` / `01M6WRR5BNT5X6A32WAC6Q476X`、[执行方案](../stages/0.3.3-execution-plan.md)、[内容规范 ADR0026](0026-record-title-and-markdown-details.md)、[主线数量 ADR0027](0027-multiple-main-tasks.md)。本文定义适配器交付和任务操作契约；标题、Markdown 编码、兼容全文、内容修订算法仍只有 ADR0026 一份规范。

审核：[0.3.3-final-plan-review-coder.md](../../evidence/0.3.3-final-plan-review-coder.md)；Runner `01M6WSEHW6ZX6YECSPYQEFV4CJ`。同一v0.1输入/输出/容量/回执/CLI基线不变，仅更新接受状态与引用。

## 用户行为与方法对应

0.3.2 送审源码基线为36方法（26写、10读），没有任务创建或想法转任务方法。0.3.3新增以下5项，目标共 **41方法（30写、11读）**。这是交付要求；实际实现与验证进度以执行方案/阶段入口及交付证据为准，不将旧基线写成当前代码状态。

| 已确认用户行为 | 新共享方法 / MCP 工具 | CLI 指令 | 范围 |
|---|---|---|---|
| 记录想法标题和可选 Markdown 详情 | create_idea（写） | idea create | 输入 / 摘要输出以 ADR0026 为准 |
| 阅读同一想法的完整详情 | get_idea_details（读） | idea show | 返回 IdeaDocument，不续期、不写历史 |
| 编辑标题、详情或 needs | update_idea（写） | idea edit | 显式 patch、record_revision，不改计时 / 卡 |
| 新建与已有主线并存的任务 | create_task（写） | task create | 复用现有主 / 支线任务模型及容量；不补独立整理系统 |
| 将想法标题转成任务 / 放入指定主线 | convert_idea_to_task（写） | idea convert | 使用明确目标 ID；原想法的全部详情继续保留 |

独立窗口是 GUI 展示和草稿入口，不为开窗、预览、焦点或窗口状态新增外部工具。待办 Markdown 详情、通用卡编辑 / 加子项、自动分拣、自动排今日计划、项目管理和 AI 接入均不借本 ADR 纳入。原型转换后 `inToday: true` 是演示数据，不改变现有服务“不隐式排计划 / 开计时”的规则。

## 任务操作输入（v0.1）

所有对象严格校验未知键；operation_id 使用现有 UUID 契约，任务 / 卡 ID 用现有非空字符串，idea_id 为 UUID。字段名为公开协议，camelCase 只在适配现有 service 时映射。

共用 `TaskItemInput = {content, type, timebox_minutes}`：content 为非空白字符串，按现有卡输入 trim；type 明确为 `结果卡` 或 `时间盒卡`；结果卡的 timebox_minutes 必须为 null，时间盒必须为正整数分钟。不设新的文本 / 数组上限；主线待做子项仍受当前 mainItems 限制。GUI 的预填标题只是表单值，提交后同样校验；不能用详情首段、固定“推进第一阶段”或任务名替代非法空事项。

| 方法 | 输入 | 确切效果 |
|---|---|---|
| create_task | operation_id、name（非空白，trim）、slot（主线 / 支线）、default_project?（已有项目名或 null，省略规范化为 null）、items?（非空 TaskItemInput 数组） | 新建一张背包进行中任务。省略 items 明确创建空任务，沿用旧空任务工作流；显式数组须至少一项，空数组报 INVALID_INPUT。任务和全部给定卡同一事务生成。默认项目仅引用已有项目，不自动创建 |
| convert_idea_to_task | operation_id、idea_id、record_revision、target、items（非空 TaskItemInput 数组） | 一次将想法转为任务事项；保留原记录 ID、标题、Markdown 详情、附件与标签，pool 改为已转任务并关联首张卡。每项 content 是用户核对后的标题 / 可执行事项，不自动读详情拆解 |

target 为严格的两种互斥对象：

- `{kind: "existing_task", task_id}`：明确指定当前背包进行中任务。GUI 列出可选主线；共享服务仍沿用现有“背包任务”资格，不另造一套按名称选主线的规则。多个主线必须按 ID 选择，不回退到首个主线。
- `{kind: "new_task", name, slot, default_project?}`：在同一事务新建主 / 支线任务并加入这些事项；name / slot / default_project 的规则同 create_task。不允许同时传 task_id 和新建字段，不接受隐含目标。

转换沿现有 ideaService 的状态规则：已转任务 / 已有生成卡拒绝再次转换；合法冷库 / 已完成想法按既有 convert / clearDone 规则处理，不额外增加“只许活跃池”门槛。新操作在事务内核对内容修订、任务仍在背包、当前 mainTasks / mainItems 容量和项目存在性。原想法只读打开不续期；成功转换按既有 last_touched_at / cold_since / 完成状态规则更新。

GUI 和两适配器复用同一 TaskItemInput 到 TaskItemDraft 的映射（timebox_minutes → minutes）及领域建卡规则。现有字符串事项的 GUI 调用仍适配为结果卡；有类型的输入保留时间盒类型 / 目标分钟。导出当前私有 convertIdeaInTx 给 ApplicationController 使用，不在控制器重写转换、标签或容量业务。

## 输出、冲突、容量与回执（v0.1）

两写方法都使用现有 committedEnvelope：status、operation_id、data、committed_at、replayed、warnings、next_operation_id；不自造“已保存”成功路径。

`TaskMutationSummary` 的严格字段为 `{id, name, slot, slot_index, status, created_at, completed_at, bet_ends_at, default_project}`。字段类型复用 get_task_details.task 对应 schema；本次创建 / 转换成功时 status=进行中、slot_index 为正整数，押注到期的日期口径沿现有任务详情。由同一事务最终任务投影生成，避免回执与详情返回的日期不同。

| 方法 | data |
|---|---|
| create_task | `{task: TaskMutationSummary, created_card_ids: string[]}`；空任务数组为空，新建 ID 必须能用 get_task_details 读回 |
| convert_idea_to_task | `{idea: IdeaSummary, task: TaskMutationSummary, created_card_ids: string[], created_new_task: boolean}`；至少一张卡，idea 的 pool=已转任务；不把长详情复制进 data |

规范输入固定所有实际业务字段：create 的 name/slot/default_project；items 省略保持省略，给定项保持顺序 / 明确类型 / 分钟；convert 包含 idea_id/record_revision/完整 target/items。名称 / 卡内容采用既有 trim，项目省略与 null 统一；Markdown / needs 仍依 ADR0026。operation_id 与 caller 来源不混入业务参数指纹。旧 36 方法的严格输入 / 输出不增加新字段或缩短旧全文。

1. runOperation 先比较持久原回执，再检查现记录 / 修订 / 容量。同 ID 同方法同规范输入返回首次回执，不重复创建或转任务；记录 / 任务后来编辑、完成或删除也不能重建。同 ID 换方法、目标、事项、类型 / 分钟或修订返回 OPERATION_CONFLICT。
2. 新 convert 修订不符返回 `RECORD_CHANGED / not_executed`，latest_context.idea 为 ADR0026 的 IdeaSummary；需要正文则显式 get_idea_details。不能自动换最新修订执行旧草案。
3. 容量失败复用 `TASK_CAPACITY_FULL` / `MAIN_TASK_ITEMS_FULL`，目标失效用 `TASK_NOT_FOUND` / `TASK_NOT_IN_BACKPACK`，想法已转用 `IDEA_ALREADY_CONVERTED`，不存在用 `IDEA_NOT_FOUND`；均为 not_executed，保持任务 / 卡 / 想法 / 历史 / 回执零提交。新增代码若尚无对应映射，沿共享 appError 注册，不让 UI 解析中文错误推断状态。
4. 容量错误的 latest_context 使用明确结构：`task_capacity: {slot, limit, active_tasks: [{id, name}]}`；子项错误增加 `item_capacity: {task_id, limit, active_count, requested_count}`。这是事务内现值报告，非另一份设置来源。原有其它方法错误形状保持。提示用户在 GUI 完成 / 冷藏 / 放弃后重试，不谎称这两个新方法支持 make_room；本次不传 make_room、不隐式腾位或停止计时。
5. 数据、派生标签、操作历史和持久回执共 journal；完整输入保留，不截断长文，不新增回执清理。成功后投影 / 提醒异常沿 committed+warnings；连接 / 响应校验失败按 result_unknown，用原 operation_id 查 get_operation_result，不更换 ID 假定失败重做。

## CLI 格式与长文（v0.1）

想法三命令及 --details-file / --details-stdin / --clear-details / --clear-needs 的互斥与 patch 语义，直接采用 ADR0026 的 CLI 规范。全部新命令支持已有 --json / --agent；写命令支持 --operation-id。

```text
monorail task create --name <name> --slot 主线|支线
  [--default-project <existing-name>]
  [--item <content> ... | --items-file <path> | --items-stdin]
  [--operation-id <uuid>] [--json]

monorail idea convert <idea-id>
  (--task-id <task-id> | --new-task-name <name> --slot 主线|支线)
  (--item <content> ... | --items-file <path> | --items-stdin)
  [--default-project <existing-name>] [--record-revision <token>]
  [--operation-id <uuid>] [--json]
```

重复 --item 明确映射为结果卡、timebox_minutes=null；复杂事项从 UTF-8 文件或 stdin 读取 JSON TaskItemInput 数组，支持时间盒与多行 content。items-file / items-stdin / 重复 item 互斥；default-project 只在新建目标可用，已有 task-id 不能改该任务项目。create 省略所有事项来源是明确空任务；convert 缺事项来源报错。

CLI 首次 convert 未给 record_revision 时先 get_idea_details 取得令牌；显式 operation_id 重试先查原回执，只恢复同方法原 record_revision，保留本次 target/items 等业务参数参与冲突比较。用户显式修订不被覆盖；无回执才按既有协议取得当前修订。此逻辑与 idea edit 复用，不新增第二份重试恢复实现。create 无内容修订，使用现有写操作 ID 取得 / 回查流程。

帮助必须有 PowerShell UTF-8 文件 / stdin 示例和 MCP 对应 JSON，说明省略保持、空串清详情、结果卡无分钟、原 ID 重试和不自动开计时。把 Markdown 当字面内容传输，文件 / stdin 的换行与 #、引号、反引号、$ 均由文本读取保留，不把长文拼成 shell 命令，也不修改 agent 的数据目录规则。

## 影响文件与验证（v0.1）

- src/shared/application.ts：五组输入 / 输出、applicationContracts / applicationRequest；src/shared/appError.ts 及控制器错误映射按需注册。摘要 / 项目 / TaskItem 映射复用，不复制 schema 与业务规则。
- src/services/ideaService.ts / backpackService.ts / domain/task：共享 InTx、卡创建和容量来源；src/app/applicationController.ts 经 readSerial / runOperation 组装；client/applicationClient.ts 保持共享泛型，按需补新类型，不另写客户端业务。
- cli/commands.ts / execute.ts / output.ts：解析、执行、可读结果及 CLI_HELP_COMMANDS / --help --json；mcp/server.ts 使用共享 schema 注册工具和说明，两协议 SDK / stdio / HTTP 兼容回归；src-tauri/src/mcp_bridge.rs 的 READ_ONLY_METHODS 只增加 get_idea_details（目标 11），新写方法沿现写门。
- docs/application/README.md、mcp/README.md、docs/mcp/requirements-and-design.md、src/pages/settings/AutomationGuide.tsx / automationData.ts 与版本交付说明同步 41 项、长文 / 转换样例，实际安装入口沿现动态信息生成。用户不能遇到工具已新增而 --help / 设置说明仍称不支持的同版漂移。
- 先定向单测：五方法合法 / 非法输入和旧多行兼容；省略 / 清空；类型与正文原样；至少两主线并存；按指定第二主线转换且全文 / 附件保留；容量满时零写；旧修订、同 ID 换目标 / 参数、重放时目标已编辑或删除；取消 / result_unknown 和回查不重复。用原 service / journal，不能仅 fake transport 返回自造成功。
- 再类型 / lint、应用 / CLI / MCP 构建，最后隔离真实管道的 CLI 与 MCP 调用并用 GUI / get详情重读，核对历史 / 回执 / 计时不变；SDK 两协议工具枚举对照共享契约（41、30 写 / 11 读）及 Rust 读分类。后端测试进程沿现硬期限 60 秒，不增加生产调用超时。

本稿已通过最终方案审核；生产验证由实施方按上述矩阵另行记录，用户确认原型不替代持久回执、原生多窗或正式发布验收。流程仍为coder-6定稿→coder审核放行→coder-3实施→coder-6与coder审核；发版仍需另有用户指令。

## Revision History

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-11-08 | 用户追加 CLI/MCP 同版指令；映射五个已确认行为，明确任务创建 / 标题转换的输入输出、容量、修订与原回执、长文 / 结构化事项输入、帮助同步与真实调用验收；Proposed，未改生产代码 |
| v0.1 Accepted | 2026-11-08 | coder最终审核通过；补审核引用/接受状态，五方法及严格任务输入/原回执契约不变，非真实工具实现验收 |
| v0.1 实施状态说明 | 2026-11-08 | 将36项明确标为送审源码基线，41项仍为同版交付要求；仅修进度口径，五方法输入输出/容量/回执规范不变 |
