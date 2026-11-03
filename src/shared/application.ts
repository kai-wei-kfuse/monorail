import { z } from 'zod';
import { jsonValue, operationId } from './operation.ts';

const iso = z.iso.datetime({ offset: true });
const nonEmpty = z.string().min(1);
const warning = z.strictObject({ phase: z.enum(['settings', 'projection', 'reminders', 'logging']), message: z.string() });

function committedEnvelope<T extends z.ZodType>(dataSchema: T) {
  return z.strictObject({
    status: z.literal('committed'),
    operation_id: operationId,
    data: dataSchema,
    committed_at: iso,
    replayed: z.boolean().describe('true 表示命中已持久化回执直接返回，未重复写入'),
    warnings: z.array(warning).describe('当次提交后的非致命后置副作用告警；replayed=true 时为空数组，不代表历史告警已消除'),
    next_operation_id: operationId,
  });
}

export const ideaInput = z.strictObject({
  operation_id: operationId.describe('复制 get_context 或上一次成功结果中的 next_operation_id；同一次保存重试沿用原 ID'),
  text: z.string().trim().min(1, '想法内容不能为空').describe('要保存的想法正文，支持多行和 #标签'),
  needs: z.string().optional().describe('这个想法满足什么需要，可省略'),
});
export const ideaResult = z.strictObject({
  id: z.uuid(), text: z.string(), created_at: iso,
  tags: z.array(z.string()), pool: z.literal('活跃池'),
});
export const saveIdeaResult = committedEnvelope(ideaResult);

export const captureTodoInput = z.strictObject({
  operation_id: operationId.describe('复制 get_context 或上一次成功结果中的 next_operation_id；重试沿用原 ID'),
  text: z.string().trim().min(1, '待办内容不能为空').describe('要捕捉的待办事项内容，支持 #标签'),
  task_id: nonEmpty.optional().describe('可选：归入背包中指定任务的 ID；省略时自动创建单事项支线任务'),
  due_at: iso.nullable().optional().describe('可选：截止时间（带时区 ISO 字符串）'),
  blocking: z.boolean().optional().describe('可选：是否为阻塞事项'),
});
export const todoResult = z.strictObject({
  record_id: z.uuid(),
  card_id: nonEmpty,
  task_id: nonEmpty,
  task_name: nonEmpty,
  slot: z.enum(['主线', '支线']),
  content: z.string(),
  tags: z.array(z.string()),
  due_at: iso.nullable(),
  blocking: z.boolean(),
  created_at: iso,
});
export const captureTodoResult = committedEnvelope(todoResult);

export const findItemsInput = z.strictObject({
  kind: z.enum(['idea', 'todo_card', 'task', 'all']).optional().describe('搜索类别：idea（想法）、todo_card（待办事项卡）、task（背包任务）或 all（全部）'),
  query: z.string().optional().describe('关键词过滤（匹配标题、正文、项目或标签）；省略时返回当前活跃列表'),
  include_archived: z.boolean().optional().describe('是否包含冷库/已转任务想法、已完成/已放弃卡片与冷藏/已完成任务'),
});
export const findItemsResult = z.strictObject({
  as_of: iso,
  query: z.string(),
  ambiguous: z.boolean().describe('当非空查询命中多项候选时为 true，调用方应让用户确认或按精确 ID 选择'),
  ideas: z.array(z.strictObject({
    id: z.uuid(), text: z.string(), tags: z.array(z.string()), needs: z.string().nullable(),
    pool: z.enum(['活跃池', '冷库', '已转任务']), created_at: iso, exact_match: z.boolean(),
  })),
  todo_cards: z.array(z.strictObject({
    id: nonEmpty, content: z.string(), status: z.enum(['待做', '进行中', '已完成', '已缩小', '已放弃']),
    type: z.enum(['结果卡', '时间盒卡']), task_id: z.string().nullable(), task_name: z.string(),
    slot: z.enum(['主线', '支线', '游离']), project: z.string(), tags: z.array(z.string()),
    due_at: iso.nullable(), blocking: z.boolean(), exact_match: z.boolean(),
  })),
  tasks: z.array(z.strictObject({
    id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
    status: z.enum(['进行中', '冷藏', '已放弃', '已完成']), default_project: z.string().nullable(),
    open_card_count: z.number().int().nonnegative(), exact_match: z.boolean(),
  })),
});

export const timerEntrySummary = z.strictObject({
  id: nonEmpty,
  description: z.string(),
  project: nonEmpty,
  tags: z.array(z.string()),
  started_at: iso,
  ended_at: iso.nullable(),
  card_id: z.string().nullable(),
  kind: z.enum(['普通', '插入', '暂停']),
  source: z.enum(['计时', '手动', '日历', '自动', '离线追问']),
});

export const timerContextSchema = z.strictObject({
  mode: z.enum(['idle', 'running', 'paused', 'away', 'pending', 'rest']),
  expected_state: nonEmpty,
  open_entry: timerEntrySummary,
  paused_target: timerEntrySummary.nullable(),
  pending: z.strictObject({ id: nonEmpty, started_at: iso }).nullable(),
  current_card: z.strictObject({
    id: nonEmpty, content: z.string(), status: z.enum(['待做', '进行中']),
    task_id: z.string().nullable(), task_name: z.string(), project: z.string(), tags: z.array(z.string()),
    goal_minutes: z.number().positive().nullable(),
  }).nullable(),
  rest: z.strictObject({ suggestion: z.string().nullable(), started_at: iso }).nullable(),
  allowed_actions: z.array(z.string()),
});

export const pendingActionSchema = z.strictObject({
  id: nonEmpty,
  kind: z.string(),
  summary: z.string(),
  data: jsonValue,
});

export const contextOptionsSchema = z.strictObject({
  projects: z.array(nonEmpty),
  known_tags: z.array(z.string()),
  break_presets: z.array(z.strictObject({ id: nonEmpty, name: nonEmpty, project: nonEmpty, tags: z.array(z.string()) })),
});

export const contextSection = z.enum(['timer', 'pending_actions', 'options']);
export const contextInput = z.strictObject({
  sections: z.array(contextSection).optional().describe('可选：按需请求 timer、pending_actions、options 分区；默认返回全部三个分区'),
});
export const emptyInput = z.strictObject({});
export const contextResult = z.strictObject({
  status: z.literal('ready'),
  operation_id: operationId,
  expected_state: nonEmpty,
  as_of: iso,
  timer: timerContextSchema.optional(),
  pending_actions: z.array(pendingActionSchema).optional(),
  options: contextOptionsSchema.optional(),
});

function createDurationMapSchema() {
  const schema = z.record(z.string(), z.number().nonnegative());
  schema._zod.run = (payload) => {
    const input = payload.value;
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      payload.issues.push({ code: 'invalid_type', expected: 'record', input, path: [] });
      return payload;
    }
    const out: Record<string, number> = Object.create(null);
    for (const key of Object.keys(input)) {
      const val = (input as Record<string, unknown>)[key];
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
        payload.issues.push({ code: 'invalid_type', expected: 'number', input: val, path: [key] });
      } else {
        Object.defineProperty(out, key, { value: val, enumerable: true, writable: true, configurable: true });
      }
    }
    payload.value = out;
    return payload;
  };
  return schema;
}
const nonNegativeNumberMap = createDurationMapSchema();

export const timeSummaryInput = z.strictObject({
  day: z.string().trim().min(1).optional().describe('统计日期：today（默认）、yesterday、this_week 或 YYYY-MM-DD'),
  day_mode: z.enum(['activity', 'calendar']).optional().describe('日期边界模式：activity（默认，按单轨活动日边界）或 calendar（自然日 00:00）'),
});
export const timeSummaryResult = z.strictObject({
  resolved_day: z.iso.date(),
  day_mode: z.enum(['activity', 'calendar']),
  day_boundary_hour: z.number().int().min(0).max(23),
  timezone: nonEmpty,
  start: iso,
  end: iso,
  effective_end: iso,
  as_of: iso,
  interval_elapsed_ms: z.number().nonnegative(),
  non_idle_recorded_ms: z.number().nonnegative().describe('非待机记录（含工作/学习/生活/睡眠/离线等）裁切后累计时长'),
  non_idle_covered_ms: z.number().nonnegative().describe('非待机记录并集时长（重叠时段只算一次；含睡眠/离线，不等同于有效工作时长）'),
  overlap_excess_ms: z.number().nonnegative().describe('非待机并行记录重复累计量 = non_idle_recorded_ms - non_idle_covered_ms'),
  idle_ms: z.number().nonnegative().describe('待机总时长（含普通待机与已暂停待机）'),
  idle_plain_ms: z.number().nonnegative(),
  paused_ms: z.number().nonnegative(),
  untracked_ms: z.number().nonnegative().describe('无任何记录（含无待机记录）的真实空白 = interval_elapsed_ms - non_idle_covered_ms - idle_ms'),
  by_project: nonNegativeNumberMap,
  by_tag: nonNegativeNumberMap,
  entry_count: z.number().int().nonnegative(),
});

export const listTimeEntriesInput = z.strictObject({
  from: iso.describe('起始时间（带时区 ISO 字符串）'),
  to: iso.describe('结束时间（带时区 ISO 字符串，必须晚于 from）'),
});
export const clippedEntrySchema = timerEntrySummary.extend({
  is_open: z.boolean(),
  clipped_start: iso,
  clipped_end: iso,
  clipped_ms: z.number().nonnegative(),
}).strict();
export const listTimeEntriesResult = z.strictObject({
  from: iso,
  to: iso,
  effective_to: iso,
  as_of: iso,
  timezone: nonEmpty,
  entries: z.array(clippedEntrySchema),
});

export const startTimerInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 或上次写结果的 expected_state'),
  description: z.string().trim().min(1, '活动描述不能为空').describe('正在做的自由活动描述'),
  project: z.string().optional().describe('可选：已知项目名称（缺省为「未分类」；禁止传系统保留项目）'),
  tags: z.array(z.string()).optional().describe('可选：标签列表（不含 #、@ 或空白）'),
});

export const startTaskItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 或上次写结果的 expected_state'),
  card_id: nonEmpty.describe('要开始计时的待办事项卡片 ID（先通过 find_items 或 get_context 获取，不要用名称猜测）'),
});

export const timerControlInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 或上次写结果的 expected_state'),
});

export const startBreakInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 或上次写结果的 expected_state'),
  activity: z.string().trim().min(1, '临时活动名称不能为空').describe('临时离开活动名称或快捷活动 ID（如「上厕所」「吃饭」）'),
});

export const timerMutationData = z.strictObject({
  noop: z.boolean().describe('true 表示当前已处于目标状态，未产生重复状态切换'),
  reason: z.string().nullable(),
  effective_at: iso,
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const timerMutationResult = committedEnvelope(timerMutationData);

export const addTimeEntryInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  description: z.string().trim().min(1, '补录活动描述不能为空').describe('补录的活动描述'),
  start: iso.describe('补录开始时间（带时区 ISO 字符串）'),
  end: iso.describe('补录结束时间（带时区 ISO 字符串，必须晚于 start 且不晚于当前时间）'),
  project: z.string().optional().describe('可选：已知项目名称（缺省为「未分类」）'),
  tags: z.array(z.string()).optional().describe('可选：标签列表'),
});
export const overlapCoverageSchema = z.strictObject({
  id: nonEmpty,
  description: z.string(),
  project: z.string(),
  tags: z.array(z.string()),
  card_id: nonEmpty.nullable(),
  from: iso,
  to: iso,
});
export const addTimeEntryData = z.strictObject({
  entry: timerEntrySummary,
  overlaps: z.array(overlapCoverageSchema),
  expected_state: nonEmpty,
});
export const addTimeEntryResult = committedEnvelope(addTimeEntryData);

export const lookupInput = z.strictObject({ operation_id: operationId });
export const committedRequestSummary = z.strictObject({
  method: nonEmpty,
  arguments: jsonValue,
});
export const lookupResult = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('not_found'), operation_id: operationId }),
  z.strictObject({
    status: z.literal('committed'),
    operation_id: operationId,
    command: nonEmpty,
    request: committedRequestSummary,
    data: jsonValue,
    committed_at: iso,
  }),
]);

export const applicationContracts = {
  get_context: { input: contextInput, output: contextResult, readOnly: true },
  get_operation_result: { input: lookupInput, output: lookupResult, readOnly: true },
  save_idea: { input: ideaInput, output: saveIdeaResult, readOnly: false },
  capture_todo: { input: captureTodoInput, output: captureTodoResult, readOnly: false },
  find_items: { input: findItemsInput, output: findItemsResult, readOnly: true },
  get_time_summary: { input: timeSummaryInput, output: timeSummaryResult, readOnly: true },
  list_time_entries: { input: listTimeEntriesInput, output: listTimeEntriesResult, readOnly: true },
  start_timer: { input: startTimerInput, output: timerMutationResult, readOnly: false },
  start_task_item: { input: startTaskItemInput, output: timerMutationResult, readOnly: false },
  pause_timer: { input: timerControlInput, output: timerMutationResult, readOnly: false },
  resume_timer: { input: timerControlInput, output: timerMutationResult, readOnly: false },
  stop_timer: { input: timerControlInput, output: timerMutationResult, readOnly: false },
  start_break: { input: startBreakInput, output: timerMutationResult, readOnly: false },
  return_from_break: { input: timerControlInput, output: timerMutationResult, readOnly: false },
  add_time_entry: { input: addTimeEntryInput, output: addTimeEntryResult, readOnly: false },
} as const;

export type ApplicationMethod = keyof typeof applicationContracts;
export const applicationMethods = Object.keys(applicationContracts) as ApplicationMethod[];
export type ApplicationInput<M extends ApplicationMethod> = z.input<(typeof applicationContracts)[M]['input']>;
export type ApplicationParsedInput<M extends ApplicationMethod> = z.output<(typeof applicationContracts)[M]['input']>;
export type ApplicationOutput<M extends ApplicationMethod> = z.output<(typeof applicationContracts)[M]['output']>;

export const ideaRequest = z.strictObject({ method: z.literal('save_idea'), arguments: ideaInput });
export const applicationRequest = z.discriminatedUnion('method', [
  ideaRequest,
  z.strictObject({ method: z.literal('capture_todo'), arguments: captureTodoInput }),
  z.strictObject({ method: z.literal('find_items'), arguments: findItemsInput }),
  z.strictObject({ method: z.literal('get_context'), arguments: contextInput }),
  z.strictObject({ method: z.literal('get_time_summary'), arguments: timeSummaryInput }),
  z.strictObject({ method: z.literal('list_time_entries'), arguments: listTimeEntriesInput }),
  z.strictObject({ method: z.literal('start_timer'), arguments: startTimerInput }),
  z.strictObject({ method: z.literal('start_task_item'), arguments: startTaskItemInput }),
  z.strictObject({ method: z.literal('pause_timer'), arguments: timerControlInput }),
  z.strictObject({ method: z.literal('resume_timer'), arguments: timerControlInput }),
  z.strictObject({ method: z.literal('stop_timer'), arguments: timerControlInput }),
  z.strictObject({ method: z.literal('start_break'), arguments: startBreakInput }),
  z.strictObject({ method: z.literal('return_from_break'), arguments: timerControlInput }),
  z.strictObject({ method: z.literal('add_time_entry'), arguments: addTimeEntryInput }),
  z.strictObject({ method: z.literal('get_operation_result'), arguments: lookupInput }),
]);
export type ApplicationRequest = z.infer<typeof applicationRequest>;
