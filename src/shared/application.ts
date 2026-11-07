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

/** 0.3.0-beta.4 D2（ADR 0020 第 4 条）：把想法池里的一个想法标记为已完成。 */
export const completeIdeaInput = z.strictObject({
  operation_id: operationId.describe('复制 get_context 或上一次成功结果中的 next_operation_id；重试沿用原 ID'),
  idea_id: z.uuid().describe('要标记完成的想法 ID（用 find_items 按关键词查到）；只有想法池（活跃池）里的想法能标记'),
});
export const completeIdeaData = z.strictObject({
  id: z.uuid(), text: z.string(), status: z.literal('已完成'), completed_at: iso,
  noop: z.boolean().describe('true 表示这个想法本来就已完成，这次没有改动'),
});
export const completeIdeaResult = committedEnvelope(completeIdeaData);

export const captureTodoInput = z.strictObject({
  operation_id: operationId.describe('复制 get_context 或上一次成功结果中的 next_operation_id；重试沿用原 ID'),
  text: z.string().trim().min(1, '待办内容不能为空').describe('要捕捉的待办事项内容，支持 #标签'),
  task_id: nonEmpty.optional().describe('可选：归入背包中指定任务的 ID；省略时自动创建单事项支线任务'),
  due_at: iso.nullable().optional().describe('可选：截止时间（带时区 ISO 字符串）'),
  blocking: z.boolean().optional().describe('已停用（0.3.1 起不起作用，保留只为兼容旧调用）'),
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
  include_archived: z.boolean().optional().describe('是否包含冷库/已转任务/已完成想法、已完成/已放弃卡片与冷藏/已完成任务'),
});
export const findItemsResult = z.strictObject({
  as_of: iso,
  query: z.string(),
  ambiguous: z.boolean().describe('当非空查询命中多项候选时为 true，调用方应让用户确认或按精确 ID 选择'),
  ideas: z.array(z.strictObject({
    id: z.uuid(), text: z.string(), tags: z.array(z.string()), needs: z.string().nullable(),
    pool: z.enum(['活跃池', '冷库', '已转任务', '已完成']).describe('想法状态；已完成 = 用户或调用方标记做到了（ADR 0020）'), created_at: iso, exact_match: z.boolean(),
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
  /** 0.3.1（第 3 轮 N3）：插入的事暂停了（mode 仍是 away）；旧客户端忽略 */
  away_paused: z.boolean().optional(),
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
/** 今日任务板（只读，ADR 0021 第 12 条）：agent 由此知道今天排了什么。任务模式关掉时为 null。 */
export const todayPlanSchema = z.strictObject({
  day: z.string().describe('活动日 YYYY-MM-DD'),
  skip_until_planned: z.boolean().describe('用户选了「今天先不排」'),
  carry_pending: z.boolean().describe('有从前一天带过来、用户还没确认的项'),
  items: z.array(z.strictObject({
    card_id: nonEmpty, title: z.string(), track: z.enum(['主线', '支线']), priority: z.enum(['普通', '高']),
    today_minutes: z.number().int().positive().nullable().describe('时间盒：今天的量（分钟）；结果卡为 null'),
    minutes_today: z.number().int().nonnegative().describe('今天已计（分钟）'),
    achieved: z.boolean(), running: z.boolean(), carried: z.boolean(), due_today: z.boolean(),
  })),
});
export const contextResult = z.strictObject({
  status: z.literal('ready'),
  operation_id: operationId,
  expected_state: nonEmpty,
  as_of: iso,
  timer: timerContextSchema.optional(),
  pending_actions: z.array(pendingActionSchema).optional(),
  options: contextOptionsSchema.optional(),
  today_plan: todayPlanSchema.nullable().optional(),
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
/** 改一条已有的计时记录（0.3.1）：规则同日历——正在计的那一条只能改开始；来自卡的描述和项目要在卡上改；开着的待机不能改描述和项目；不能删除。 */
export const updateTimeEntryInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 的 expected_state；改记录会影响计时状态，状态变了就拒绝'),
  entry_id: nonEmpty.describe('要改的计时记录 ID（来自 list_time_entries）'),
  start: iso.optional().describe('可选：新的开始时间（带时区 ISO 字符串）'),
  end: iso.optional().describe('可选：新的结束时间（带时区 ISO 字符串；正在计时的记录不能设结束时间）'),
  description: z.string().trim().min(1, '描述不能为空').optional().describe('可选：新的描述（来自卡的记录请改卡）'),
  project: z.string().optional().describe('可选：新的项目名称（来自卡的记录请改卡）'),
  tags: z.array(z.string()).optional().describe('可选：新的标签列表（整体替换）'),
}).refine(v => v.start !== undefined || v.end !== undefined || v.description !== undefined || v.project !== undefined || v.tags !== undefined,
  '至少要改一项：start、end、description、project、tags');
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
export const updateTimeEntryData = z.strictObject({ entry: timerEntrySummary, overlaps: z.array(overlapCoverageSchema), expected_state: nonEmpty });
export const updateTimeEntryResult = committedEnvelope(updateTimeEntryData);

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

// ---------- 0.3.2 A–D 自动化能力补齐（ADR 0023 修订 4，新增 19 方法：14 写、5 读，合计 36 方法） ----------

export const taskPlanBoardSchema = todayPlanSchema.extend({
  seen_card_ids: z.array(nonEmpty).describe('本轮抽卡已看过的候选卡片 ID'),
  drawable_card_ids: z.array(nonEmpty).describe('当前可抽取的候选卡片 ID'),
}).strict();

export const getTaskPlanInput = z.strictObject({
  day: z.enum(['today', 'tomorrow']).optional().describe('要查看的任务板日期：today（默认）或 tomorrow'),
});
export const getTaskPlanResult = z.strictObject({
  as_of: iso,
  which: z.enum(['today', 'tomorrow']),
  resolved_day: z.iso.date(),
  day_boundary_hour: z.number().int().min(0).max(23),
  enabled: z.boolean().describe('任务模式是否开启；false 时 plan 为 null'),
  plan: taskPlanBoardSchema.nullable(),
});

export const addPlanItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  day: z.iso.date().describe('目标任务板的活动日 YYYY-MM-DD（只接受今天或明天对应的实际日期）'),
  card_id: nonEmpty.describe('要排进任务板的待办卡片 ID'),
  priority: z.enum(['普通', '高']).optional().describe('板子上的优先级，缺省为「普通」'),
  today_minutes: z.number().int().positive().nullable().optional().describe('时间盒卡在该天的目标分钟数（正整数）；结果卡不填或为 null'),
});
export const removePlanItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  day: z.iso.date().describe('目标任务板的活动日 YYYY-MM-DD'),
  card_id: nonEmpty.describe('要从任务板移出的卡片 ID'),
});
export const updatePlanItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  day: z.iso.date().describe('目标任务板的活动日 YYYY-MM-DD'),
  card_id: nonEmpty.describe('要修改的任务板卡片 ID'),
  priority: z.enum(['普通', '高']).optional().describe('可选：新的优先级'),
  today_minutes: z.number().int().positive().optional().describe('可选：时间盒卡新的当天目标分钟数（正整数）'),
}).refine(v => v.priority !== undefined || v.today_minutes !== undefined, '至少要改一项：priority、today_minutes');
export const confirmPlanCarryInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  day: z.iso.date().describe('今天任务板的活动日 YYYY-MM-DD'),
  keep_card_ids: z.array(nonEmpty).refine(ids => new Set(ids).size === ids.length, 'keep_card_ids 不能包含重复 ID')
    .describe('要保留在今天板子上的带入卡片 ID 列表（全部不带传空数组 []）'),
});
export const skipTodayPlanInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  day: z.iso.date().describe('今天任务板的活动日 YYYY-MM-DD'),
});
export const skipTaskItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  day: z.iso.date().describe('今天任务板的活动日 YYYY-MM-DD'),
  card_id: nonEmpty.describe('本轮换掉的候选卡片 ID；跳过后请再调用 draw_task_item 抽取下一张'),
});
export const planMutationData = z.strictObject({
  noop: z.boolean(),
  which: z.enum(['today', 'tomorrow']),
  day: z.iso.date(),
  plan: taskPlanBoardSchema,
});
export const planMutationResult = committedEnvelope(planMutationData);

export const drawTaskItemInput = emptyInput;
export const drawTaskItemResult = z.strictObject({
  as_of: iso,
  day: z.iso.date(),
  outcome: z.enum(['card', 'need_plan', 'confirm_carry', 'blocked', 'done', 'guide']),
  card: z.strictObject({
    id: nonEmpty, content: z.string(), task_id: z.string().nullable(), task_name: z.string(),
    track: z.enum(['主线', '支线']), type: z.enum(['结果卡', '时间盒卡']), priority: z.enum(['普通', '高']),
    today_minutes: z.number().int().positive().nullable(), goal_minutes: z.number().int().positive().nullable(),
  }).nullable(),
  candidates: z.array(z.strictObject({
    card_id: nonEmpty, title: z.string(), track: z.enum(['主线', '支线']),
    priority: z.enum(['普通', '高']), weight: z.number().positive(),
  })),
  reset_round: z.boolean(),
  blocked_reason: z.enum(['inserting', 'rest']).nullable(),
  guide: z.enum(['createProject', 'setMain', 'addMainCards', 'allDone']).nullable(),
});

export const makeRoomInputSchema = z.strictObject({
  action: z.enum(['freeze', 'abandon']).describe('腾位方式：freeze（冷藏）或 abandon（放弃）'),
  task_id: nonEmpty.describe('要腾出槽位的背包进行中任务 ID'),
});

export const completeTaskItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.optional().describe('可选：当完成当前计时或已暂停的卡片时必填 expected_state；直接完成背包中待做子项时可省略'),
  card_id: nonEmpty.describe('要完成的子任务卡片 ID'),
  note: z.string().optional().describe('可选：完成时的进度笔记；省略时保留卡片原有笔记'),
  finish_early: z.boolean().optional().describe('可选：当前计时/暂停的时间盒卡未达目标时长时，传 true 确认提前完成'),
});
export const completeTaskItemData = z.strictObject({
  noop: z.boolean(),
  stopped_timer: z.boolean(),
  card: z.strictObject({
    id: nonEmpty, content: z.string(), status: z.literal('已完成'),
    completed_at: iso.nullable(), completed_day: z.iso.date().nullable(),
    completed_track: z.enum(['主线', '支线']).nullable(), progress_note: z.string(),
  }),
  task: z.strictObject({
    id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
    status: z.enum(['进行中', '冷藏', '已放弃', '已完成']),
    open_card_count: z.number().int().nonnegative(),
  }).nullable(),
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const completeTaskItemResult = committedEnvelope(completeTaskItemData);

export const reopenTaskItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.optional().describe('可选：当 make_room 腾位会影响当前计时卡时必填 expected_state'),
  card_id: nonEmpty.describe('要取消完成并恢复为待做的子任务卡片 ID'),
  make_room: makeRoomInputSchema.nullable().optional().describe('可选：当所属父任务已完成且原主/支线槽位已满时，显式指定要冷藏或放弃的同槽位任务'),
});
export const reopenTaskItemData = z.strictObject({
  noop: z.boolean(),
  reopened_parent_task: z.boolean(),
  card: z.strictObject({
    id: nonEmpty, content: z.string(), status: z.literal('待做'), progress_note: z.string(),
  }),
  task: z.strictObject({
    id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
    status: z.enum(['进行中', '冷藏', '已放弃', '已完成']),
    slot_index: z.number().int().positive().nullable(),
    open_card_count: z.number().int().nonnegative(),
  }).nullable(),
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const reopenTaskItemResult = committedEnvelope(reopenTaskItemData);

export const keepGoingTaskItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 或上次写结果的 expected_state'),
  card_id: nonEmpty.describe('当前正在做或已暂停的卡片 ID'),
  note: z.string().optional().describe('可选：做到哪了的进度笔记'),
});
export const keepGoingTaskItemData = z.strictObject({
  card: z.strictObject({
    id: nonEmpty, content: z.string(), status: z.literal('待做'), progress_note: z.string(),
  }),
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const keepGoingTaskItemResult = committedEnvelope(keepGoingTaskItemData);

export const splitTaskItemInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.describe('复制自 get_context 或上次写结果的 expected_state'),
  card_id: nonEmpty.describe('当前正在做或已暂停的卡片 ID'),
  today_content: z.string().trim().min(1, '今天先做的内容不能为空').describe('拆出今天先做的这一项内容'),
  rest_content: z.string().trim().min(1, '剩下的内容不能为空').describe('拆出留到后面的剩余项内容'),
  rest_minutes: z.number().int().positive().nullable().optional().describe('时间盒卡拆给剩余项的分钟数（正整数）；结果卡不填或为 null'),
});
export const splitTaskItemData = z.strictObject({
  today_card_id: nonEmpty,
  rest_card_id: nonEmpty,
  today_content: z.string(),
  rest_content: z.string(),
  today_minutes: z.number().int().positive().nullable(),
  rest_minutes: z.number().int().positive().nullable(),
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const splitTaskItemResult = committedEnvelope(splitTaskItemData);

export const endOriginalTaskInput = timerControlInput;
export const endOriginalTaskData = z.strictObject({
  ended_entry_id: nonEmpty,
  ended_card_id: z.string().nullable(),
  promoted_entry_id: nonEmpty,
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const endOriginalTaskResult = committedEnvelope(endOriginalTaskData);

export const getTaskDetailsInput = z.strictObject({
  task_id: nonEmpty.describe('要查看详情的任务 ID'),
});
export const getTaskDetailsResult = z.strictObject({
  as_of: iso,
  task: z.strictObject({
    id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
    slot_index: z.number().int().positive().nullable(),
    status: z.enum(['进行中', '冷藏', '已放弃', '已完成']),
    created_at: iso, completed_at: iso.nullable(),
    bet_ends_at: z.iso.date().nullable(), default_project: z.string().nullable(),
    completion_id: z.uuid().nullable(),
    reopen_mode: z.enum(['snapshot_batch', 'task_only', 'conflict']).nullable(),
    reopen_conflict_reason: z.string().nullable(),
    reopen_card_ids: z.array(nonEmpty),
    slot_full: z.boolean(),
    make_room_candidates: z.array(z.strictObject({
      id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
      slot_index: z.number().int().positive().nullable(),
    })),
  }),
  items: z.array(z.strictObject({
    id: nonEmpty, content: z.string(),
    status: z.enum(['待做', '进行中', '已完成', '已缩小', '已放弃']),
    type: z.enum(['结果卡', '时间盒卡']),
    timebox_minutes: z.number().int().positive().nullable(),
    project: z.string(), tags: z.array(z.string()),
    due_at: iso.nullable(), progress_note: z.string(),
    completed_at: iso.nullable(),
    in_completion_batch: z.boolean(),
  })),
});

export const completeTaskInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.optional().describe('可选：当该任务包含当前正在计时或已暂停的卡片时必填 expected_state'),
  task_id: nonEmpty.describe('要整张完成的背包任务 ID'),
});
export const completeTaskData = z.strictObject({
  noop: z.boolean(),
  stopped_timer: z.boolean(),
  completion_id: z.uuid().nullable(),
  affected_card_ids: z.array(nonEmpty),
  freed_slot: z.strictObject({
    slot: z.enum(['主线', '支线']),
    slot_index: z.number().int().positive().nullable(),
  }),
  task: z.strictObject({
    id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
    status: z.literal('已完成'), completed_at: iso.nullable(),
    bet_ends_at: z.iso.date().nullable(),
  }),
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const completeTaskResult = committedEnvelope(completeTaskData);

export const reopenTaskInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  expected_state: nonEmpty.optional().describe('可选：当 make_room 腾位会影响当前计时卡时必填 expected_state'),
  task_id: nonEmpty.describe('要重新打开的已完成任务 ID'),
  completion_id: z.uuid().nullable().describe('完成批次 ID（来自 get_task_details.task.completion_id；无快照旧任务显式传 null）'),
  make_room: makeRoomInputSchema.nullable().optional().describe('可选：当目标主/支线槽位已满时，显式指定要冷藏或放弃的同槽位任务'),
});
export const reopenTaskData = z.strictObject({
  noop: z.boolean(),
  reopen_mode: z.enum(['snapshot_batch', 'task_only']),
  reopened_card_ids: z.array(nonEmpty),
  task: z.strictObject({
    id: nonEmpty, name: nonEmpty, slot: z.enum(['主线', '支线']),
    slot_index: z.number().int().positive(), status: z.literal('进行中'),
    bet_ends_at: z.iso.date().nullable(),
    open_card_count: z.number().int().nonnegative(),
  }),
  expected_state: nonEmpty,
  timer: timerContextSchema,
});
export const reopenTaskResult = committedEnvelope(reopenTaskData);

export const reopenIdeaInput = z.strictObject({
  operation_id: operationId.describe('复制自 get_context 或上次写结果的 next_operation_id'),
  idea_id: z.uuid().describe('要撤销完成并放回想法池的想法 ID'),
});
export const reopenIdeaData = z.strictObject({
  id: z.uuid(),
  text: z.string(),
  pool: z.literal('活跃池'),
  noop: z.boolean(),
});
export const reopenIdeaResult = committedEnvelope(reopenIdeaData);

export const getRecapInput = z.strictObject({
  period: z.enum(['week', 'lastWeek', 'cycle', 'month', 'quarter', 'year', 'custom']).optional()
    .describe('统计周期：week（默认）、lastWeek、cycle、month、quarter、year 或 custom'),
  from: z.iso.date().optional().describe('仅 period=custom 时必填：起始活动日 YYYY-MM-DD'),
  to: z.iso.date().optional().describe('仅 period=custom 时必填：结束活动日 YYYY-MM-DD'),
  dimension: z.enum(['project', 'tag', 'source', 'activity']).optional()
    .describe('分组维度：project（默认）、tag、source 或 activity'),
  include_idle: z.boolean().optional().describe('是否包含待机/睡眠系统项，默认 false'),
  bucket: nonEmpty.optional().describe('可选：只看某一柱（bucket id）的分组与明细；必须属于当前周期的 buckets'),
}).refine(v => (v.period === 'custom' ? Boolean(v.from && v.to) : v.from === undefined && v.to === undefined),
  'period=custom 时必须同时提供 from 与 to；其他周期不能传 from 或 to');

export const getRecapResult = z.strictObject({
  computed_at: iso,
  tracking_mode: z.enum(['strict', 'loose']),
  range: z.strictObject({
    period: z.enum(['week', 'lastWeek', 'cycle', 'month', 'quarter', 'year', 'custom']),
    from_day: z.iso.date(), to_day: z.iso.date(), days: z.number().int().positive(),
    from: iso, to: iso, effective_to: iso, after: iso.nullable(),
  }),
  today: z.iso.date(),
  earliest_day: z.iso.date().nullable(),
  last_review_at: iso.nullable(),
  effective_ms: z.number().int().nonnegative(),
  active_days: z.number().int().nonnegative(),
  entry_count: z.number().int().nonnegative(),
  mainline: z.strictObject({
    permille: z.number().int().min(0).max(1000),
    by_source: nonNegativeNumberMap,
  }),
  previous: z.strictObject({
    label: z.string(), from_day: z.iso.date(), to_day: z.iso.date(),
    comparable: z.boolean(), effective_ms: z.number().int().nonnegative(),
    main_permille: z.number().int().min(0).max(1000),
    done: z.number().int().nonnegative(), notes: z.number().int().nonnegative(),
  }),
  unit: z.enum(['day', 'week', 'month']),
  buckets: z.array(z.strictObject({
    id: nonEmpty, label: z.string(), sub: z.string(), title: z.string(),
    weekend: z.boolean(), days: z.array(z.iso.date()),
    total_ms: z.number().int().nonnegative(),
    by_key: nonNegativeNumberMap,
  })),
  total_ms: z.number().int().nonnegative(),
  series: z.array(z.strictObject({
    key: z.string(), ms: z.number().int().nonnegative(),
    permille: z.number().int().min(0).max(1000), color: z.string(),
    merged: z.number().int().nonnegative(),
  })),
  groups: z.array(z.strictObject({
    key: z.string(), ms: z.number().int().nonnegative(),
    permille: z.number().int().min(0).max(1000), count: z.number().int().nonnegative(),
    color: z.string(), previous_ms: z.number().int().nonnegative().nullable().optional(),
    rows: z.array(z.strictObject({
      key: z.string(), description: z.string(), ms: z.number().int().nonnegative(),
      count: z.number().int().nonnegative(), first_day: z.iso.date(), last_day: z.iso.date(),
      start: iso.nullable(), end: iso.nullable(), project: z.string(), tags: z.array(z.string()),
      card: z.strictObject({ id: nonEmpty, content: z.string(), track: z.enum(['主线', '支线']) }).nullable(),
      source: z.enum(['主线任务', '支线任务', '自由活动', '临时离开']).nullable(),
    })),
  })),
  gone_keys: z.array(z.string()),
  done: z.array(z.strictObject({
    id: nonEmpty, content: z.string(), task: z.string(),
    track: z.enum(['主线', '支线']), day: z.iso.date(), at: iso,
    ms: z.number().int().nonnegative(),
  })),
  notes: z.array(z.strictObject({
    id: nonEmpty, note: z.string(), content: z.string(), task: z.string(),
    track: z.enum(['主线', '支线']), day: z.iso.date(), at: iso,
  })),
});

export const listOperationHistoryInput = z.strictObject({
  from_day: z.iso.date().optional().describe('起始活动日 YYYY-MM-DD（含）；省略时取 to_day 往前 6 天（共 7 天）'),
  to_day: z.iso.date().optional().describe('结束活动日 YYYY-MM-DD（含）；省略时取当前活动日'),
  source: z.enum(['manual', 'system', 'mcp', 'cli', 'automation', 'all_automation']).optional()
    .describe('按来源类别过滤；all_automation 匹配 mcp/cli/automation'),
  agent: z.string().trim().min(1).optional().describe('按调用方 agent 名称过滤'),
  method: z.string().trim().min(1).optional().describe('按应用方法名（如 start_timer）或动作码过滤'),
  subject_type: z.enum(['entry', 'card', 'task', 'record', 'review', 'settings', 'state']).optional().describe('按操作主体类型过滤'),
  subject_id: z.string().trim().min(1).optional().describe('按操作主体 ID 过滤'),
  operation_id: operationId.optional().describe('按 operation_id 精确过滤'),
}).refine(v => !(v.from_day && v.to_day) || v.from_day <= v.to_day, 'from_day 不能晚于 to_day');

export const listOperationHistoryResult = z.strictObject({
  as_of: iso,
  from_day: z.iso.date(),
  to_day: z.iso.date(),
  bad_count: z.number().int().nonnegative(),
  older_before_range: z.boolean(),
  records: z.array(z.strictObject({
    id: nonEmpty, at: iso, day: z.iso.date(), action: nonEmpty,
    title: z.string(), summary: z.string(), source: jsonValue,
    operation_id: z.string().nullable(), method: z.string().nullable(),
    subject: z.strictObject({
      type: z.enum(['entry', 'card', 'task', 'record', 'review', 'settings', 'state']),
      id: nonEmpty,
      text: z.string().optional(),
      meta: z.string().optional(),
    }).nullable(),
    changes: jsonValue,
    effects: jsonValue.optional(),
    warnings: z.array(z.string()),
  })),
});

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
  update_time_entry: { input: updateTimeEntryInput, output: updateTimeEntryResult, readOnly: false },
  complete_idea: { input: completeIdeaInput, output: completeIdeaResult, readOnly: false },
  get_task_plan: { input: getTaskPlanInput, output: getTaskPlanResult, readOnly: true },
  add_plan_item: { input: addPlanItemInput, output: planMutationResult, readOnly: false },
  remove_plan_item: { input: removePlanItemInput, output: planMutationResult, readOnly: false },
  update_plan_item: { input: updatePlanItemInput, output: planMutationResult, readOnly: false },
  confirm_plan_carry: { input: confirmPlanCarryInput, output: planMutationResult, readOnly: false },
  skip_today_plan: { input: skipTodayPlanInput, output: planMutationResult, readOnly: false },
  draw_task_item: { input: drawTaskItemInput, output: drawTaskItemResult, readOnly: true },
  skip_task_item: { input: skipTaskItemInput, output: planMutationResult, readOnly: false },
  complete_task_item: { input: completeTaskItemInput, output: completeTaskItemResult, readOnly: false },
  reopen_task_item: { input: reopenTaskItemInput, output: reopenTaskItemResult, readOnly: false },
  keep_going_task_item: { input: keepGoingTaskItemInput, output: keepGoingTaskItemResult, readOnly: false },
  split_task_item: { input: splitTaskItemInput, output: splitTaskItemResult, readOnly: false },
  end_original_task: { input: endOriginalTaskInput, output: endOriginalTaskResult, readOnly: false },
  get_task_details: { input: getTaskDetailsInput, output: getTaskDetailsResult, readOnly: true },
  complete_task: { input: completeTaskInput, output: completeTaskResult, readOnly: false },
  reopen_task: { input: reopenTaskInput, output: reopenTaskResult, readOnly: false },
  reopen_idea: { input: reopenIdeaInput, output: reopenIdeaResult, readOnly: false },
  get_recap: { input: getRecapInput, output: getRecapResult, readOnly: true },
  list_operation_history: { input: listOperationHistoryInput, output: listOperationHistoryResult, readOnly: true },
} as const;

export type ApplicationMethod = keyof typeof applicationContracts;
export const applicationMethods = Object.keys(applicationContracts) as ApplicationMethod[];
export type ApplicationInput<M extends ApplicationMethod> = z.input<(typeof applicationContracts)[M]['input']>;
export type ApplicationParsedInput<M extends ApplicationMethod> = z.output<(typeof applicationContracts)[M]['input']>;
export type ApplicationOutput<M extends ApplicationMethod> = z.output<(typeof applicationContracts)[M]['output']>;

/**
 * 调用方（ADR 0019 第 6 条）：MCP / CLI 进程自报，未经验证，只用于操作历史的显示和筛选，
 * 不作权限依据，也不参与回执冲突判断。去掉控制字符并截断长度；格式不对时整段丢弃（按「未识别」记），
 * 绝不因为它让一次调用失败。
 */
const selfReported = (max: number) => z.string().transform(value => value.replace(/\p{Cc}/gu, '').slice(0, max));
export const callerAgent = z.strictObject({
  name: selfReported(64).nullable(),
  raw: selfReported(64).optional(),
  version: selfReported(32).optional(),
  detected_by: z.enum(['mcp_handshake', 'env', 'flag', 'none']),
  evidence: selfReported(128).optional(),
});
export const callerOrigin = z.strictObject({ kind: z.enum(['mcp', 'cli']), agent: callerAgent });
export type CallerAgent = z.output<typeof callerAgent>;
export type CallerOrigin = z.input<typeof callerOrigin>;
/** 请求顶层的可选 origin，不进 arguments，不影响参数校验。 */
const origin = callerOrigin.optional().catch(undefined);

export const ideaRequest = z.strictObject({ method: z.literal('save_idea'), arguments: ideaInput, origin });
export const applicationRequest = z.discriminatedUnion('method', [
  ideaRequest,
  z.strictObject({ method: z.literal('capture_todo'), arguments: captureTodoInput, origin }),
  z.strictObject({ method: z.literal('find_items'), arguments: findItemsInput, origin }),
  z.strictObject({ method: z.literal('get_context'), arguments: contextInput, origin }),
  z.strictObject({ method: z.literal('get_time_summary'), arguments: timeSummaryInput, origin }),
  z.strictObject({ method: z.literal('list_time_entries'), arguments: listTimeEntriesInput, origin }),
  z.strictObject({ method: z.literal('start_timer'), arguments: startTimerInput, origin }),
  z.strictObject({ method: z.literal('start_task_item'), arguments: startTaskItemInput, origin }),
  z.strictObject({ method: z.literal('pause_timer'), arguments: timerControlInput, origin }),
  z.strictObject({ method: z.literal('resume_timer'), arguments: timerControlInput, origin }),
  z.strictObject({ method: z.literal('stop_timer'), arguments: timerControlInput, origin }),
  z.strictObject({ method: z.literal('start_break'), arguments: startBreakInput, origin }),
  z.strictObject({ method: z.literal('return_from_break'), arguments: timerControlInput, origin }),
  z.strictObject({ method: z.literal('add_time_entry'), arguments: addTimeEntryInput, origin }),
  z.strictObject({ method: z.literal('update_time_entry'), arguments: updateTimeEntryInput, origin }),
  z.strictObject({ method: z.literal('complete_idea'), arguments: completeIdeaInput, origin }),
  z.strictObject({ method: z.literal('get_task_plan'), arguments: getTaskPlanInput, origin }),
  z.strictObject({ method: z.literal('add_plan_item'), arguments: addPlanItemInput, origin }),
  z.strictObject({ method: z.literal('remove_plan_item'), arguments: removePlanItemInput, origin }),
  z.strictObject({ method: z.literal('update_plan_item'), arguments: updatePlanItemInput, origin }),
  z.strictObject({ method: z.literal('confirm_plan_carry'), arguments: confirmPlanCarryInput, origin }),
  z.strictObject({ method: z.literal('skip_today_plan'), arguments: skipTodayPlanInput, origin }),
  z.strictObject({ method: z.literal('draw_task_item'), arguments: drawTaskItemInput, origin }),
  z.strictObject({ method: z.literal('skip_task_item'), arguments: skipTaskItemInput, origin }),
  z.strictObject({ method: z.literal('complete_task_item'), arguments: completeTaskItemInput, origin }),
  z.strictObject({ method: z.literal('reopen_task_item'), arguments: reopenTaskItemInput, origin }),
  z.strictObject({ method: z.literal('keep_going_task_item'), arguments: keepGoingTaskItemInput, origin }),
  z.strictObject({ method: z.literal('split_task_item'), arguments: splitTaskItemInput, origin }),
  z.strictObject({ method: z.literal('end_original_task'), arguments: endOriginalTaskInput, origin }),
  z.strictObject({ method: z.literal('get_task_details'), arguments: getTaskDetailsInput, origin }),
  z.strictObject({ method: z.literal('complete_task'), arguments: completeTaskInput, origin }),
  z.strictObject({ method: z.literal('reopen_task'), arguments: reopenTaskInput, origin }),
  z.strictObject({ method: z.literal('reopen_idea'), arguments: reopenIdeaInput, origin }),
  z.strictObject({ method: z.literal('get_recap'), arguments: getRecapInput, origin }),
  z.strictObject({ method: z.literal('list_operation_history'), arguments: listOperationHistoryInput, origin }),
  z.strictObject({ method: z.literal('get_operation_result'), arguments: lookupInput, origin }),
]);
export type ApplicationRequest = z.infer<typeof applicationRequest>;
