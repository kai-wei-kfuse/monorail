export interface AutomationHostInfo {
  executable: string;
  mcp_entry: string | null;
  cli_entry: string | null;
  identifier: string;
  pipe: string;
}

export interface AutomationHostState {
  loading: boolean;
  info: AutomationHostInfo | null;
  error: string | null;
}

export interface CliCommandExample {
  id: string;
  title: string;
  desc: string;
  args: readonly string[];
  command: string | null;
}

/**
 * Windows PowerShell 单引号字面量转义：
 * 单引号内 $、反引号、双引号、空格与中文均按字面量解析，仅需将内嵌单引号 ' 加倍为 ''。
 */
export function quotePowerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const SAFE_BARE_TOKEN = /^[A-Za-z0-9._-]+$/;

/**
 * 生成可在 Windows PowerShell 中直接执行的 node 命令。
 * 入口路径始终使用单引号安全转义；普通子命令/选项保持原样，含中文、空格、#、$、引号等参数使用单引号安全转义。
 */
export function formatPowerShellNodeCommand(entryPath: string, args: readonly string[]): string {
  const tokens = [
    quotePowerShellLiteral(entryPath),
    ...args.map(arg => (SAFE_BARE_TOKEN.test(arg) ? arg : quotePowerShellLiteral(arg))),
  ];
  return `node ${tokens.join(' ')}`;
}

/**
 * 使用标准 JSON.stringify 生成默认 stdio 模式的 MCP 客户端配置片段。
 */
export function formatMcpStdioConfigJson(mcpEntryPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        monorail: {
          command: 'node',
          args: [mcpEntryPath],
        },
      },
    },
    null,
    2,
  );
}

const CLI_EXAMPLE_SPECS: ReadonlyArray<{ id: string; title: string; desc: string; args: readonly string[] }> = [
  {
    id: 'context',
    title: '读取当前上下文与待处理通知',
    desc: '获取当前计时状态、待处理通知（pending_actions）、可用项目与标签，并签发 operation_id 与 expected_state。',
    args: ['context', '--json'],
  },
  {
    id: 'idea-add',
    title: '保存或创建带详情的想法记录',
    desc: '将单行标题或带 Markdown 详情的想法保存至想法池（支持 #标签，详情建议用 --details-file 读取），不创建待办事项卡片，不改变当前计时状态。',
    args: ['idea', 'create', '--title', '整理季度复盘提纲 #规划', '--json'],
  },
  {
    id: 'task-create',
    title: '创建主线或支线任务',
    desc: '在背包中新建主线或支线任务（遵循主线/支线容量上限，可附带初始结果卡或通过 --items-file 传入时间盒卡），不自动开始计时。',
    args: ['task', 'create', '--name', '第二主线：架构演进', '--slot', '主线', '--item', '梳理核心模块边界', '--json'],
  },
  {
    id: 'time-summary',
    title: '查询今日时间统计',
    desc: '按单轨活动日汇总今日非待机覆盖时长、待机时长、未记录空白及按项目与标签分类统计。',
    args: ['time', 'summary', '--day', 'today', '--json'],
  },
  {
    id: 'timer-start',
    title: '开始自由活动计时',
    desc: '开始或切换自由活动计时；未显式传入 --operation-id 时，CLI 会自动先获取当前上下文。',
    args: ['timer', 'start', '撰写技术方案', '--json'],
  },
  {
    id: 'timer-stop',
    title: '停止当前计时',
    desc: '结束当前正在进行或已暂停的计时会话并回到待机状态，同时释放进行中的事项卡片。',
    args: ['timer', 'stop', '--json'],
  },
  {
    id: 'help',
    title: '查看命令行帮助',
    desc: '查看全部 39 个子命令（对应 41 项应用方法：30 写、11 读）与参数说明；本地帮助查询不会连接或拉起单轨后台进程。',
    args: ['--help'],
  },
];

export function buildCliExamples(cliEntryPath: string | null): CliCommandExample[] {
  const validPath = cliEntryPath && cliEntryPath.trim().length > 0 ? cliEntryPath : null;
  return CLI_EXAMPLE_SPECS.map(spec => ({
    ...spec,
    command: validPath ? formatPowerShellNodeCommand(validPath, spec.args) : null,
  }));
}

export const CAPABILITY_CATEGORIES: ReadonlyArray<{ title: string; methods: string; summary: string }> = [
  {
    title: '状态、回执与操作历史（只读）',
    methods: 'get_context · get_operation_result · list_operation_history',
    summary: '读取当前计时状态、累积未消除通知（pending_actions）、可用项目与标签；按 operation_id 查询持久化提交回执；按活动日、来源、调用方、方法与主体筛选操作历史（含坏行计数 bad_count）。',
  },
  {
    title: '任务板与抽卡（A）',
    methods: 'get_task_plan · add_plan_item · remove_plan_item · update_plan_item · confirm_plan_carry · skip_today_plan · draw_task_item · skip_task_item',
    summary: '读取今天或明天的任务板（实时计算今日已计分钟、达标状态与可抽候选）；排入、移出或修改任务板项；确认昨日未完成带入；今天先不排、按权重只读抽卡以及换一张（记入本轮 seen）。',
  },
  {
    title: '想法、待办、子任务与整张任务（B & C & 0.3.3）',
    methods: 'save_idea · create_idea · get_idea_details · update_idea · complete_idea · reopen_idea · convert_idea_to_task · capture_todo · create_task · find_items · get_task_details · complete_task_item · reopen_task_item · keep_going_task_item · split_task_item · complete_task · reopen_task',
    summary: '创建/查看/编辑带单行标题与 Markdown 详情的想法（含 record_revision 乐观并发保护）、完成/撤销完成想法与转任务（支持指定并存主线）；捕获待办并入包、直接新建主/支线任务；检索条目与查看任务详情（含 completion_id）；完成/恢复/接着做/拆分子任务与整张完成/重新打开任务。',
  },
  {
    title: '计时、临时离开、时间记录与统计回看（B & D）',
    methods: 'start_timer · start_task_item · pause_timer · resume_timer · stop_timer · start_break · return_from_break · end_original_task · get_time_summary · list_time_entries · add_time_entry · update_time_entry · get_recap',
    summary: '开始自由计时或卡片计时、暂停/恢复/停止、插入临时离开与返回原活动或直接结束原任务；按日/周汇总时间、查询明细、补录与修改时间记录；读取 7 种周期 × 4 种维度的完整统计回看（get_recap）。',
  },
];

export const TROUBLESHOOTING_ITEMS: ReadonlyArray<{ code: string; title: string; resolution: string }> = [
  {
    code: 'SETUP_REQUIRED',
    title: '单轨尚未完成首次初始化',
    resolution: '请先打开单轨桌面端主窗口并选择数据目录；完成初始化后本机配置与管道入口即会自动就绪。',
  },
  {
    code: 'CONFIG_CORRUPTED',
    title: '配置文件或已登记入口路径失效',
    resolution: '数据目录不存在，或应用安装目录变更导致 mcp-host.json 中登记的可执行文件路径失效。请从托盘完全退出并重新启动单轨（关闭主窗口仅隐藏至托盘），或在设置中重新确认数据目录以刷新本机配置。',
  },
  {
    code: 'STARTUP_FAILED / UNAVAILABLE / RECOVERY_FAILED',
    title: '本机后台启动失败或状态未就绪',
    resolution: '后台进程未能正常拉起、主窗口正在切换状态或数据恢复失败。请手动打开单轨桌面端检查是否存在恢复错误提示，就绪后再执行调用。',
  },
  {
    code: 'PENDING_CONFIRMATION / STATE_CHANGED',
    title: '存在待确认事项或计时状态已变更',
    resolution: '当前存在未处理的确认项（如离线追问），或计时状态已发生改变。请勿自动重试写入，应先调用 get_context（或 CLI context --json）读取最新状态与 expected_state，或在桌面端完成确认后再操作。',
  },
  {
    code: 'RESULT_UNKNOWN / HOST_LOST',
    title: '连接中断导致提交结果未知',
    resolution: '请求在收到响应前中断，不能直接断定操作未写入。请使用原 operation_id 调用 get_operation_result（或 CLI operation get <id> --json）核对持久化回执，切勿生成新 ID 盲目重发。',
  },
];
