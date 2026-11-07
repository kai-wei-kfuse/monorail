import type { ApplicationMethod, ApplicationOutput } from '../src/shared/application.ts';
import { applicationFailure, type ApplicationFailure } from '../src/shared/appError.ts';
import pkg from '../package.json' with { type: 'json' };
import { AGENT_RULES } from '../src/shared/agentRules.ts';
import { CliUsageError } from './commands.ts';
import { CliExecutionError, type CliExecutionOutcome } from './execute.ts';

export function getCliVersion(): string {
  return pkg.version;
}

export type CliExitCode = 0 | 2 | 3 | 4 | 5 | 130;

const ENVIRONMENT_ERROR_CODES = new Set([
  'SETUP_REQUIRED',
  'CONFIG_CORRUPTED',
  'PIPE_PERMISSION_DENIED',
  'PIPE_BUSY',
  'UNAVAILABLE',
  'STARTUP_FAILED',
  'RECOVERY_FAILED',
  'MIGRATING',
  'UPDATING',
  'UPDATE_IN_PROGRESS',
  'APP_NOT_READY',
]);

export function mapFailureToExitCode(error: unknown, failure: ApplicationFailure): CliExitCode {
  if (error instanceof CliUsageError || failure.code === 'USAGE_ERROR' || failure.code === 'INVALID_INPUT') {
    return 2;
  }
  if (failure.code === 'CANCELLED' && failure.category === 'not_executed') {
    return 130;
  }
  if (failure.category === 'result_unknown') {
    return 5;
  }
  if (ENVIRONMENT_ERROR_CODES.has(failure.code)) {
    return 4;
  }
  return 3;
}

export interface HelpCommandItem {
  usage: string;
  method: ApplicationMethod;
  summary: string;
  examples: string[];
}

export const CLI_HELP_COMMANDS: HelpCommandItem[] = [
  {
    usage: 'monorail context [--section timer|pending_actions|options] [--json]',
    method: 'get_context',
    summary: '读取当前计时状态、待处理确认项、已知项目/标签与新操作令牌',
    examples: [
      'monorail context',
      'monorail context --section timer --json',
    ],
  },
  {
    usage: 'monorail idea add [<text>] [--text-file <path> | --stdin] [--needs <text>] [--operation-id <uuid>] [--json]',
    method: 'save_idea',
    summary: '保存想法到活跃池（支持多行中文与 #标签）',
    examples: [
      'monorail idea add "做一个命令行入口 #产品"',
      'monorail idea add --text-file ./note.txt --needs "减少切换开销"',
    ],
  },
  {
    usage: 'monorail idea done <idea-id> [--operation-id <uuid>] [--json]',
    method: 'complete_idea',
    summary: '把想法池里的一个想法标记为已完成（先用 monorail find --kind idea 查到 ID；已完成的再标记不报错）',
    examples: [
      'monorail idea done <idea-id>',
    ],
  },
  {
    usage: 'monorail idea reopen <idea-id> [--operation-id <uuid>] [--json]',
    method: 'reopen_idea',
    summary: '撤销想法的完成状态并放回活跃池',
    examples: [
      'monorail idea reopen <idea-id>',
    ],
  },
  {
    usage: 'monorail todo add [<text>] [--text-file <path> | --stdin] [--task-id <id>] [--due-at <iso>] [--operation-id <uuid>] [--json]   （--blocking 0.3.1 起不起作用，仍接受）',
    method: 'capture_todo',
    summary: '捕捉待办事项并原子入包（可归入指定任务或自动建单事项支线任务）',
    examples: [
      'monorail todo add "复习操作系统页面置换 #408"',
      'monorail todo add "完成真题卷" --task-id <task-id> --due-at 2026-11-05T18:00:00+08:00',
    ],
  },
  {
    usage: 'monorail find [<query>] [--kind idea|todo_card|task|all] [--include-archived] [--json]',
    method: 'find_items',
    summary: '查找想法、待办事项卡与任务（多项同名时标记 ambiguous）',
    examples: [
      'monorail find "操作系统" --kind todo_card',
      'monorail find --kind task --json',
    ],
  },
  {
    usage: 'monorail time summary [--day today|yesterday|this_week|YYYY-MM-DD] [--day-mode activity|calendar] [--json]',
    method: 'get_time_summary',
    summary: '查询指定日期或本周的时间汇总、项目/标签分布与重叠时长',
    examples: [
      'monorail time summary --day today --day-mode activity',
      'monorail time summary --day 2026-11-03 --json',
    ],
  },
  {
    usage: 'monorail time entries --from <iso> --to <iso> [--json]',
    method: 'list_time_entries',
    summary: '列出指定时间区间内裁切后的时间记录明细',
    examples: [
      'monorail time entries --from 2026-11-03T08:00:00+08:00 --to 2026-11-03T12:00:00+08:00',
    ],
  },
  {
    usage: 'monorail time add [<description>] [--text-file <path> | --stdin] --start <iso> --end <iso> [--project <name>] [--tag <tag>] [--operation-id <uuid>] [--json]',
    method: 'add_time_entry',
    summary: '手动补录一段已完成的时间记录（不覆盖已有记录，返回重叠区段）',
    examples: [
      'monorail time add "听编译原理播客" --start 2026-11-03T09:00:00+08:00 --end 2026-11-03T09:30:00+08:00 --project 学习 --tag 播客',
    ],
  },
  {
    usage: 'monorail entry edit <entry-id> [--start <iso>] [--end <iso>] [--description <text>] [--project <name>] [--tag <tag> | --clear-tags] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'update_time_entry',
    summary: '修改一条已有的时间记录（规则同单轨日历：正在计时的只能改开始；来自卡的描述和项目要在卡上改；开着的待机不能改描述和项目；--tag 整体替换标签；不能删除）',
    examples: [
      'monorail entry edit 0f3c2a1e-0000-4000-8000-000000000000 --start 2026-11-03T09:10:00+08:00 --end 2026-11-03T09:40:00+08:00',
      'monorail entry edit 0f3c2a1e-0000-4000-8000-000000000000 --description "看龙书第三章" --project 学习',
    ],
  },
  {
    usage: 'monorail timer start [<description>] [--text-file <path> | --stdin] [--project <name>] [--tag <tag>] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'start_timer',
    summary: '开始自由活动计时',
    examples: [
      'monorail timer start "看龙书第三章" --project 学习 --tag 编译',
    ],
  },
  {
    usage: 'monorail timer start-item <card-id> [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'start_task_item',
    summary: '按精确卡片 ID 开始待办事项计时（先用 monorail find 获取 card-id）',
    examples: [
      'monorail timer start-item <card-id>',
    ],
  },
  {
    usage: 'monorail timer pause|resume|stop [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'pause_timer',
    summary: '暂停、恢复或停止当前主计时',
    examples: [
      'monorail timer pause',
      'monorail timer resume',
      'monorail timer stop',
    ],
  },
  {
    usage: 'monorail break start [<activity>] [--text-file <path> | --stdin] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'start_break',
    summary: '开始临时离开活动（保留暂停目标以便返回）',
    examples: [
      'monorail break start "倒水"',
    ],
  },
  {
    usage: 'monorail break return [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'return_from_break',
    summary: '从临时离开活动返回原计时或待机',
    examples: [
      'monorail break return',
    ],
  },
  {
    usage: 'monorail break end-original [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'end_original_task',
    summary: '临时离开期间直接结束离开前的原计时，当前临时离开升级为普通自由计时',
    examples: [
      'monorail break end-original',
    ],
  },
  {
    usage: 'monorail plan show [--day today|tomorrow] [--json]',
    method: 'get_task_plan',
    summary: '查看今天或明天的任务板（只读，实时计算已计分钟、达标状态与可抽候选）',
    examples: [
      'monorail plan show',
      'monorail plan show --day tomorrow --json',
    ],
  },
  {
    usage: 'monorail plan add <card-id> --day <YYYY-MM-DD> [--priority 普通|高] [--today-minutes <N>] [--operation-id <uuid>] [--json]',
    method: 'add_plan_item',
    summary: '把背包进行中任务的待做卡片排进指定活动日的任务板',
    examples: [
      'monorail plan add <card-id> --day 2026-11-07 --priority 高 --today-minutes 45',
    ],
  },
  {
    usage: 'monorail plan remove <card-id> --day <YYYY-MM-DD> [--operation-id <uuid>] [--json]',
    method: 'remove_plan_item',
    summary: '把一张卡片从指定活动日的任务板移出（回背包）',
    examples: [
      'monorail plan remove <card-id> --day 2026-11-07',
    ],
  },
  {
    usage: 'monorail plan edit <card-id> --day <YYYY-MM-DD> [--priority 普通|高] [--today-minutes <N>] [--operation-id <uuid>] [--json]',
    method: 'update_plan_item',
    summary: '修改指定活动日任务板上某张卡的优先级或当天目标分钟数',
    examples: [
      'monorail plan edit <card-id> --day 2026-11-07 --priority 高',
    ],
  },
  {
    usage: 'monorail plan carry --day <YYYY-MM-DD> (--keep <card-id>... | --keep-none) [--operation-id <uuid>] [--json]',
    method: 'confirm_plan_carry',
    summary: '确认今天任务板上的昨日未完成带入项（明确保留列表或全部移出）',
    examples: [
      'monorail plan carry --day 2026-11-07 --keep <card-1> --keep <card-2>',
      'monorail plan carry --day 2026-11-07 --keep-none',
    ],
  },
  {
    usage: 'monorail plan skip-today --day <YYYY-MM-DD> [--operation-id <uuid>] [--json]',
    method: 'skip_today_plan',
    summary: '标记今天先不排任务板，直接从全背包可抽卡片中抽卡',
    examples: [
      'monorail plan skip-today --day 2026-11-07',
    ],
  },
  {
    usage: 'monorail plan draw [--json]',
    method: 'draw_task_item',
    summary: '按今日任务板或全背包规则加权随机抽取一张待办事项卡（只读，不自动开始计时）',
    examples: [
      'monorail plan draw --json',
    ],
  },
  {
    usage: 'monorail plan skip <card-id> --day <YYYY-MM-DD> [--operation-id <uuid>] [--json]',
    method: 'skip_task_item',
    summary: '换一张：将当前候选卡片记入本轮已看过（seen），随后可再运行 monorail plan draw',
    examples: [
      'monorail plan skip <card-id> --day 2026-11-07',
    ],
  },
  {
    usage: 'monorail item done <card-id> [--note <text> | --note-file <path> | --stdin] [--finish-early] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'complete_task_item',
    summary: '完成当前计时/暂停卡片或直接完成背包进行中任务的待做子项（时间盒未达量须 --finish-early）',
    examples: [
      'monorail item done <card-id>',
      'monorail item done <card-id> --note "已完成核心章节" --finish-early',
    ],
  },
  {
    usage: 'monorail item reopen <card-id> [--make-room <freeze|abandon>:<task-id>] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'reopen_task_item',
    summary: '取消单个已完成子项的完成状态并恢复为待做（父任务已完成时同事务恢复父任务，满格可传 --make-room）',
    examples: [
      'monorail item reopen <card-id>',
      'monorail item reopen <card-id> --make-room freeze:<active-task-id>',
    ],
  },
  {
    usage: 'monorail item keep <card-id> [--note <text> | --note-file <path> | --stdin] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'keep_going_task_item',
    summary: '当前卡片接着做：记录进度笔记、停止计时并将卡片放回待做',
    examples: [
      'monorail item keep <card-id> --note "读到第 42 页"',
    ],
  },
  {
    usage: 'monorail item split <card-id> --today-content <text> --rest-content <text> [--rest-minutes <N>] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'split_task_item',
    summary: '拆分当前卡片：分成今天先做的一项与留到后面的剩余项',
    examples: [
      'monorail item split <card-id> --today-content "先写完接口层" --rest-content "补齐剩余测试" --rest-minutes 30',
    ],
  },
  {
    usage: 'monorail task show <task-id> [--json]',
    method: 'get_task_details',
    summary: '查看单个任务的完整详情、子项列表、完成批次 ID（completion_id）与重新打开前置条件',
    examples: [
      'monorail task show <task-id> --json',
    ],
  },
  {
    usage: 'monorail task done <task-id> [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'complete_task',
    summary: '整张完成背包中的主线或支线任务（含剩余未完成子项并生成完成批次快照，释放背包槽位）',
    examples: [
      'monorail task done <task-id>',
    ],
  },
  {
    usage: 'monorail task reopen <task-id> (--completion-id <uuid> | --legacy) [--make-room <freeze|abandon>:<task-id>] [--operation-id <uuid>] [--expected-state <token>] [--json]',
    method: 'reopen_task',
    summary: '重新打开已完成任务并恢复回原主/支线槽位（满格时用 --make-room 显式腾位）',
    examples: [
      'monorail task reopen <task-id> --completion-id <completion-id>',
      'monorail task reopen <task-id> --legacy --make-room freeze:<active-task-id>',
    ],
  },
  {
    usage: 'monorail recap show [--period week|lastWeek|cycle|month|quarter|year|custom] [--from <YYYY-MM-DD> --to <YYYY-MM-DD>] [--dimension project|tag|source|activity] [--include-idle] [--bucket <id>] [--json]',
    method: 'get_recap',
    summary: '读取统计回看数据（7 种周期 × 4 种分组维度、柱状桶筛选、环比对比、已完成事项与进展笔记）',
    examples: [
      'monorail recap show --period week --dimension project',
      'monorail recap show --period custom --from 2026-11-01 --to 2026-11-07 --dimension tag --json',
    ],
  },
  {
    usage: 'monorail history list [--from-day <YYYY-MM-DD>] [--to-day <YYYY-MM-DD>] [--source manual|system|mcp|cli|automation|all_automation] [--filter-agent <name>] [--method <name>] [--subject-type <type>] [--subject-id <id>] [--operation-id <uuid>] [--json]',
    method: 'list_operation_history',
    summary: '列出指定活动日范围内的操作历史记录（只读，含坏行计数 bad_count 与更早记录标记）',
    examples: [
      'monorail history list',
      'monorail history list --from-day 2026-11-01 --to-day 2026-11-07 --source all_automation --json',
    ],
  },
  {
    usage: 'monorail operation get <operation-id> [--json]',
    method: 'get_operation_result',
    summary: '查询指定 operation_id 的已持久化回执（用于结果未知时的核对）',
    examples: [
      'monorail operation get <operation-id> --json',
    ],
  },
];

export function renderHelpText(): string {
  const lines: string[] = [
    `monorail v${getCliVersion()} — 单轨（MONORAIL）命令行入口`,
    '',
    `给 agent 的规则：${AGENT_RULES}`,
    '',
    '用法：',
    '  monorail <command> [subcommand] [options]',
    '',
    '命令列表：',
  ];
  for (const item of CLI_HELP_COMMANDS) {
    lines.push(`  ${item.usage}`);
    lines.push(`      ${item.summary}`);
  }
  lines.push(
    '',
    '多行 / 中文 / 特殊字符输入（idea add / todo add / time add / timer start / break start 三选一）：',
    '  1. 位置参数：monorail idea add "正文内容"',
    '  2. 文件读取：monorail idea add --text-file ./content.txt',
    '  3. 标准输入：cat ./content.txt | monorail idea add --stdin',
    '',
    '结构化输出与幂等重试：',
    '  - 传入 --json 时，stdout 仅输出一个完整 JSON 对象：',
    '    成功：{ "status": "ok", "method": "<method>", "result": { ... } }',
    '    失败：{ "status": "error", "method"?: "<method>", "operation_id"?: "<uuid>", "error": { ... } }',
    '  - 当写入返回退出码 5（result_unknown）时，请勿换 ID 盲目重写：',
    '    1) 先核对回执：monorail operation get <operation-id> --json',
    '    2) 或携带原 --operation-id <uuid> 重跑同一命令以安全幂等重放',
    '',
    '调用方（记进单轨的操作历史，只用于显示和筛选）：',
    '  --agent <名字>   任何命令都可以带，说明是谁在调用；也可以设环境变量 MONORAIL_AGENT',
    '  两者都没有时按已知 agent 的环境变量识别（如 Claude Code、Codex），识别不到记「CLI · 未识别」',
    '',
    '退出码：',
    '  0   成功（含 committed+warnings 或 noop）',
    '  2   CLI 用法或本地参数错误（尚未调用应用服务）',
    '  3   业务前置条件或状态冲突拒绝（未执行，如 STATE_CHANGED / OPERATION_CONFLICT）',
    '  4   连接、未初始化或宿主繁忙等环境错误（确认尚未发送业务）',
    '  5   结果未知（必须用 monorail operation get <id> 核对，不得当作未写入）',
    '  130 发送前被用户取消',
  );
  return lines.join('\n');
}

function formatDurationMs(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatWarnings(warnings: Array<{ phase: string; message: string }> | undefined): string[] {
  if (!warnings || warnings.length === 0) return [];
  return warnings.map(w => `  [告警:${w.phase}] ${w.message}`);
}

export function renderHumanSuccess(
  method: ApplicationMethod,
  result: ApplicationOutput<ApplicationMethod>,
): string {
  switch (method) {
    case 'get_context': {
      const r = result as ApplicationOutput<'get_context'>;
      const lines = [
        `状态: ${r.status} | operation_id: ${r.operation_id} | expected_state: ${r.expected_state}`,
      ];
      if (r.timer) {
        lines.push(
          `计时模式: ${r.timer.mode} | 当前记录: ${r.timer.open_entry.project} - ${r.timer.open_entry.description || '(无描述)'}`,
        );
        if (r.timer.current_card) {
          lines.push(`当前卡片: [${r.timer.current_card.id}] ${r.timer.current_card.content}`);
        }
        lines.push(`可执行动作: ${r.timer.allowed_actions.join(', ') || '无'}`);
      }
      if (r.pending_actions && r.pending_actions.length > 0) {
        lines.push(`待确认项 (${r.pending_actions.length}): ${r.pending_actions.map(p => p.summary).join('；')}`);
      }
      if (r.options) {
        lines.push(`已知项目 (${r.options.projects.length}): ${r.options.projects.join('、')}`);
      }
      return lines.join('\n');
    }

    case 'get_operation_result': {
      const r = result as ApplicationOutput<'get_operation_result'>;
      if (r.status === 'not_found') {
        return `未找到回执: operation_id=${r.operation_id} (status=not_found)`;
      }
      return [
        `已提交回执: operation_id=${r.operation_id} | command=${r.command} | committed_at=${r.committed_at}`,
        `规范化请求: ${JSON.stringify(r.request)}`,
        `结果数据: ${JSON.stringify(r.data)}`,
      ].join('\n');
    }

    case 'save_idea': {
      const r = result as ApplicationOutput<'save_idea'>;
      const lines = [
        `已保存想法 [${r.data.id}] (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id}`,
        `正文: ${r.data.text}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'complete_idea': {
      const r = result as ApplicationOutput<'complete_idea'>;
      return [
        `${r.data.noop ? '想法本来就已完成' : '已标记想法完成'} [${r.data.id}] (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id}`,
        `正文: ${r.data.text} | 完成于: ${r.data.completed_at}`,
        ...formatWarnings(r.warnings),
      ].join('\n');
    }

    case 'reopen_idea': {
      const r = result as ApplicationOutput<'reopen_idea'>;
      return [
        `${r.data.noop ? '想法已在活跃池' : '已撤销想法完成并放回活跃池'} [${r.data.id}] (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id}`,
        `正文: ${r.data.text}`,
        ...formatWarnings(r.warnings),
      ].join('\n');
    }

    case 'capture_todo': {
      const r = result as ApplicationOutput<'capture_todo'>;
      const lines = [
        `已捕捉待办卡片 [${r.data.card_id}] → ${r.data.slot}任务「${r.data.task_name}」(${r.data.task_id}) (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id}`,
        `内容: ${r.data.content}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'find_items': {
      const r = result as ApplicationOutput<'find_items'>;
      const lines = [
        `查询结果 (query="${r.query}", ambiguous=${String(r.ambiguous)}): 想法 ${r.ideas.length} 条 | 待办卡 ${r.todo_cards.length} 张 | 任务 ${r.tasks.length} 个`,
      ];
      if (r.ambiguous) {
        lines.push('提示: 命中多项候选，请向用户确认或使用精确 ID 调用后续命令。');
      }
      for (const idea of r.ideas) {
        lines.push(`  [想法 ${idea.id}] (${idea.pool}) ${idea.text}`);
      }
      for (const card of r.todo_cards) {
        lines.push(`  [卡片 ${card.id}] (${card.status}/${card.slot}:${card.task_name}) ${card.content}`);
      }
      for (const task of r.tasks) {
        lines.push(`  [任务 ${task.id}] (${task.slot}/${task.status}) ${task.name} (待做卡:${task.open_card_count})`);
      }
      return lines.join('\n');
    }

    case 'get_time_summary': {
      const r = result as ApplicationOutput<'get_time_summary'>;
      const projects = Object.entries(r.by_project)
        .map(([k, v]) => `${k}:${formatDurationMs(v)}`)
        .join(', ');
      return [
        `时间汇总 (${r.resolved_day}, mode=${r.day_mode}, 记录数=${r.entry_count}):`,
        `  区间总计: ${formatDurationMs(r.interval_elapsed_ms)} | 非待机并集: ${formatDurationMs(r.non_idle_covered_ms)} | 待机: ${formatDurationMs(r.idle_ms)} | 未记录空白: ${formatDurationMs(r.untracked_ms)} | 重叠附加: ${formatDurationMs(r.overlap_excess_ms)}`,
        `  按项目: ${projects || '无'}`,
      ].join('\n');
    }

    case 'list_time_entries': {
      const r = result as ApplicationOutput<'list_time_entries'>;
      const lines = [`时间记录明细 (${r.from} ~ ${r.effective_to}, 共 ${r.entries.length} 条):`];
      for (const e of r.entries) {
        lines.push(
          `  [${e.id}] ${e.clipped_start} ~ ${e.clipped_end} (${formatDurationMs(e.clipped_ms)}) [${e.project}] ${e.description}`,
        );
      }
      return lines.join('\n');
    }

    case 'add_time_entry': {
      const r = result as ApplicationOutput<'add_time_entry'>;
      const lines = [
        `已补录时间记录 [${r.data.entry.id}] (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id}`,
        `区间: ${r.data.entry.started_at} ~ ${r.data.entry.ended_at ?? ''} | 项目: ${r.data.entry.project} | 描述: ${r.data.entry.description}`,
        `重叠已有记录数: ${r.data.overlaps.length}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'update_time_entry': {
      const r = result as ApplicationOutput<'update_time_entry'>;
      const lines = [
        `已修改时间记录 [${r.data.entry.id}] (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        `区间: ${r.data.entry.started_at} ~ ${r.data.entry.ended_at ?? '（正在计时）'} | 项目: ${r.data.entry.project} | 描述: ${r.data.entry.description}`,
        `和新时段重叠的已有记录数（并行保留，没改它们）: ${r.data.overlaps.length}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'start_timer':
    case 'start_task_item':
    case 'pause_timer':
    case 'resume_timer':
    case 'stop_timer':
    case 'start_break':
    case 'return_from_break': {
      const r = result as ApplicationOutput<'start_timer'>;
      const lines = [
        `计时操作完成 (${method}, noop=${String(r.data.noop)}, replayed=${String(r.replayed)}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        `当前模式: ${r.data.timer.mode} | 当前记录: [${r.data.timer.open_entry.project}] ${r.data.timer.open_entry.description || '(无描述)'}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'end_original_task': {
      const r = result as ApplicationOutput<'end_original_task'>;
      const lines = [
        `已结束离开前的原计时 [${r.data.ended_entry_id}]（原卡片=${r.data.ended_card_id ?? '无'}）并将当前活动 [${r.data.promoted_entry_id}] 升级为普通计时 | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        `当前模式: ${r.data.timer.mode} | 当前记录: [${r.data.timer.open_entry.project}] ${r.data.timer.open_entry.description || '(无描述)'}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'get_task_plan': {
      const r = result as ApplicationOutput<'get_task_plan'>;
      if (!r.enabled || !r.plan) {
        return `任务板 (${r.which}=${r.resolved_day}): 任务模式未开启 (enabled=false)`;
      }
      const lines = [
        `任务板 (${r.which}=${r.resolved_day}, skip_until_planned=${String(r.plan.skip_until_planned)}, carry_pending=${String(r.plan.carry_pending)}, 可抽候选=${r.plan.drawable_card_ids.length}, 已看过=${r.plan.seen_card_ids.length}):`,
      ];
      for (const item of r.plan.items) {
        lines.push(
          `  [${item.card_id}] (${item.track}) ${item.title} | 优先级:${item.priority} | 进行中:${String(item.running)} | 今日:${item.minutes_today}m/${item.today_minutes ?? '-'}m | 达标:${String(item.achieved)}`,
        );
      }
      return lines.join('\n');
    }

    case 'add_plan_item':
    case 'remove_plan_item':
    case 'update_plan_item':
    case 'confirm_plan_carry':
    case 'skip_today_plan':
    case 'skip_task_item': {
      const r = result as ApplicationOutput<'add_plan_item'>;
      const lines = [
        `任务板操作完成 (${method}, day=${r.data.day}, which=${r.data.which}, noop=${String(r.data.noop)}, replayed=${String(r.replayed)}) | operation_id=${r.operation_id}`,
        `当前板子项数: ${r.data.plan.items.length} | 可抽候选: ${r.data.plan.drawable_card_ids.length} | 已看过: ${r.data.plan.seen_card_ids.length}`,
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'draw_task_item': {
      const r = result as ApplicationOutput<'draw_task_item'>;
      const lines = [
        `抽卡结果 (day=${r.day}, outcome=${r.outcome}, reset_round=${String(r.reset_round)}, 候选数=${r.candidates.length}):`,
      ];
      if (r.card) {
        lines.push(
          `  抽中卡片: [${r.card.id}] (${r.card.track}/${r.card.task_name}) ${r.card.content} | 优先级:${r.card.priority}`,
        );
      } else if (r.blocked_reason) {
        lines.push(`  当前不可抽卡: blocked_reason=${r.blocked_reason}`);
      } else if (r.guide) {
        lines.push(`  引导提示: guide=${r.guide}`);
      }
      return lines.join('\n');
    }

    case 'complete_task_item': {
      const r = result as ApplicationOutput<'complete_task_item'>;
      const lines = [
        `${r.data.noop ? '子任务本来就已完成' : '已完成子任务'} [${r.data.card.id}] ${r.data.card.content} (stopped_timer=${String(r.data.stopped_timer)}, replayed=${String(r.replayed)}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        ...(r.data.task ? [`所属任务: [${r.data.task.id}] ${r.data.task.name} (${r.data.task.slot}/${r.data.task.status}, 剩余待做:${r.data.task.open_card_count})`] : []),
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'reopen_task_item': {
      const r = result as ApplicationOutput<'reopen_task_item'>;
      const lines = [
        `${r.data.noop ? '子任务本来就是待做' : '已取消完成子任务并恢复为待做'} [${r.data.card.id}] ${r.data.card.content} (reopened_parent_task=${String(r.data.reopened_parent_task)}, replayed=${String(r.replayed)}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        ...(r.data.task ? [`所属任务: [${r.data.task.id}] ${r.data.task.name} (${r.data.task.slot}/${r.data.task.status}, 待做:${r.data.task.open_card_count})`] : []),
        ...formatWarnings(r.warnings),
      ];
      return lines.join('\n');
    }

    case 'keep_going_task_item': {
      const r = result as ApplicationOutput<'keep_going_task_item'>;
      return [
        `已记录进度并放回待做 [${r.data.card.id}] ${r.data.card.content} (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        `进度笔记: ${r.data.card.progress_note || '(空)'}`,
        ...formatWarnings(r.warnings),
      ].join('\n');
    }

    case 'split_task_item': {
      const r = result as ApplicationOutput<'split_task_item'>;
      return [
        `已拆分卡片 (${r.replayed ? '幂等重放' : '新提交'}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        `今天先做: [${r.data.today_card_id}] ${r.data.today_content} (${r.data.today_minutes ?? '-'}m)`,
        `剩余留后: [${r.data.rest_card_id}] ${r.data.rest_content} (${r.data.rest_minutes ?? '-'}m)`,
        ...formatWarnings(r.warnings),
      ].join('\n');
    }

    case 'get_task_details': {
      const r = result as ApplicationOutput<'get_task_details'>;
      const lines = [
        `任务详情 [${r.task.id}] ${r.task.name} (${r.task.slot}/${r.task.status}, completion_id=${r.task.completion_id ?? 'null'}, reopen_mode=${r.task.reopen_mode ?? 'null'}, slot_full=${String(r.task.slot_full)}):`,
      ];
      for (const item of r.items) {
        lines.push(`  [${item.id}] (${item.status}/${item.type}) ${item.content}`);
      }
      return lines.join('\n');
    }

    case 'complete_task': {
      const r = result as ApplicationOutput<'complete_task'>;
      return [
        `${r.data.noop ? '任务本来就已完成' : '已整张完成任务'} [${r.data.task.id}] ${r.data.task.name} (completion_id=${r.data.completion_id ?? 'null'}, 本批完成子项=${r.data.affected_card_ids.length}, stopped_timer=${String(r.data.stopped_timer)}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        ...formatWarnings(r.warnings),
      ].join('\n');
    }

    case 'reopen_task': {
      const r = result as ApplicationOutput<'reopen_task'>;
      return [
        `${r.data.noop ? '任务已在背包进行中' : '已重新打开任务'} [${r.data.task.id}] ${r.data.task.name} (mode=${r.data.reopen_mode}, 恢复子项=${r.data.reopened_card_ids.length}, 待做=${r.data.task.open_card_count}) | operation_id=${r.operation_id} | expected_state=${r.data.expected_state}`,
        ...formatWarnings(r.warnings),
      ].join('\n');
    }

    case 'get_recap': {
      const r = result as ApplicationOutput<'get_recap'>;
      const lines = [
        `回看统计 (${r.range.period}: ${r.range.from_day} ~ ${r.range.to_day}, computed_at=${r.computed_at}, 有效时长=${formatDurationMs(r.effective_ms)}, 主线占比=${(r.mainline.permille / 10).toFixed(1)}%):`,
      ];
      for (const g of r.groups) {
        lines.push(`  [${g.key}] ${formatDurationMs(g.ms)} (${(g.permille / 10).toFixed(1)}%, ${g.count}条)`);
      }
      return lines.join('\n');
    }

    case 'list_operation_history': {
      const r = result as ApplicationOutput<'list_operation_history'>;
      const lines = [
        `操作历史 (${r.from_day} ~ ${r.to_day}, 共 ${r.records.length} 条, 损坏行=${r.bad_count}, 更早记录=${String(r.older_before_range)}):`,
      ];
      for (const rec of r.records) {
        lines.push(`  [${rec.at}] (${rec.action}) ${rec.title} — ${rec.summary}`);
      }
      return lines.join('\n');
    }
  }
}

export function renderOutcome(outcome: CliExecutionOutcome): { stdout: string; exitCode: 0 } {
  if (outcome.kind === 'help') {
    if (outcome.json) {
      return {
        stdout: JSON.stringify({
          status: 'ok',
          kind: 'help',
          version: getCliVersion(),
          rules: AGENT_RULES,
          commands: CLI_HELP_COMMANDS,
        }),
        exitCode: 0,
      };
    }
    return { stdout: renderHelpText(), exitCode: 0 };
  }

  if (outcome.kind === 'version') {
    if (outcome.json) {
      return {
        stdout: JSON.stringify({
          status: 'ok',
          kind: 'version',
          name: 'monorail',
          version: getCliVersion(),
        }),
        exitCode: 0,
      };
    }
    return { stdout: getCliVersion(), exitCode: 0 };
  }

  if (outcome.json) {
    return {
      stdout: JSON.stringify({
        status: 'ok',
        method: outcome.method,
        ...(outcome.operationId !== undefined ? { operation_id: outcome.operationId } : {}),
        result: outcome.result,
      }),
      exitCode: 0,
    };
  }

  return {
    stdout: renderHumanSuccess(outcome.method, outcome.result),
    exitCode: 0,
  };
}

export function renderError(
  error: unknown,
  options: { json: boolean; method?: ApplicationMethod; operationId?: string },
): { stdout?: string; stderr?: string; exitCode: CliExitCode } {
  const execErr = error instanceof CliExecutionError ? error : undefined;
  const method = options.method ?? execErr?.method;
  const operationId = options.operationId ?? execErr?.operationId;
  const failure = execErr ? execErr.failure : applicationFailure(error);
  const exitCode = mapFailureToExitCode(error, failure);

  if (options.json) {
    return {
      stdout: JSON.stringify({
        status: 'error',
        ...(method !== undefined ? { method } : {}),
        ...(operationId !== undefined ? { operation_id: operationId } : {}),
        error: failure,
      }),
      exitCode,
    };
  }

  const lines = [
    `错误 [${failure.code}] (${failure.category}): ${failure.message}`,
    `下一步: ${failure.next_step}`,
  ];
  if (operationId) {
    lines.push(`操作 ID: ${operationId}（可运行: monorail operation get ${operationId}）`);
  }
  if (failure.latest_context !== undefined) {
    lines.push(`最新状态: ${JSON.stringify(failure.latest_context)}`);
  }
  return {
    stderr: lines.join('\n'),
    exitCode,
  };
}
