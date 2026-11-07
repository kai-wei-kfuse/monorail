import {
  addTimeEntryData,
  addTimeEntryResult,
  updateTimeEntryData,
  updateTimeEntryResult,
  applicationRequest,
  captureTodoResult,
  completeIdeaData,
  completeIdeaResult,
  completeTaskData,
  completeTaskItemData,
  completeTaskItemResult,
  completeTaskResult,
  contextResult,
  drawTaskItemResult,
  endOriginalTaskData,
  endOriginalTaskResult,
  findItemsResult,
  getRecapResult,
  getTaskDetailsResult,
  getTaskPlanResult,
  ideaResult,
  keepGoingTaskItemData,
  keepGoingTaskItemResult,
  listOperationHistoryResult,
  listTimeEntriesResult,
  lookupResult,
  planMutationData,
  planMutationResult,
  reopenIdeaData,
  reopenIdeaResult,
  reopenTaskData,
  reopenTaskItemData,
  reopenTaskItemResult,
  reopenTaskResult,
  saveIdeaResult,
  splitTaskItemData,
  splitTaskItemResult,
  taskPlanBoardSchema,
  timeSummaryResult,
  timerContextSchema,
  timerMutationData,
  timerMutationResult,
  todoResult,
} from '../shared/application';
import type { z } from 'zod';
import { captureTodoInTx, saveRecordInTx } from '../services/recordService';
import { completeIdeaInTx, completedBy, uncompleteIdeaInTx } from '../services/ideaService';
import { ideaStatus } from '../domain/idea/pool';
import {
  addTimeEntryCheckedInTx,
  updateTimeEntryCheckedInTx,
  endOriginalInTx,
  pauseTimerCheckedInTx,
  resumeTimerCheckedInTx,
  returnFromBreakCheckedInTx,
  startBreakCheckedInTx,
  startTaskItemCheckedInTx,
  startTimerCheckedInTx,
  stopTimerCheckedInTx,
  timerStateToken,
  timerStateTokenInTx,
} from '../services/homeService';
import {
  addInTx as addPlanItemInTx,
  confirmCarryInTx,
  drawableIdsInTx,
  editInTx as editPlanItemInTx,
  removeInTx as removePlanItemInTx,
  resolvePlanDayInTx,
  skipCardInTx,
  skipTodayInTx,
} from '../services/planService';
import { drawFromPlanInSerial } from '../services/dealService';
import { completeTaskItemInTx, keepGoingCheckedInTx, splitInTx } from '../services/cardService';
import { completeTaskInTx, reopenTaskInTx, reopenTaskItemInTx } from '../services/backpackService';
import { query as queryRecap } from '../services/recapService';
import { isAutomation, shiftDay as shiftHistoryDay } from '../services/historyService';
import type { Ctx, Snapshot, Transaction } from '../services/commit';
import { assertQueueHealthy, readOperation, readSerial, runOperation } from '../services/commit';
import { clipEntriesInRange, summarizeDay } from '../domain/timeline/stats';
import { activityDay } from '../domain/timeline/day';
import { activeCardOf, insertState } from '../domain/timeline/insert';
import { achieved, dueOn, minutesOnDay, shiftDay, visibleItems } from '../domain/plan/plan';
import type { DayPlan } from '../domain/plan/plan';
import { drawableCandidates } from '../domain/picker/pick';
import { cardTiming } from '../domain/card/edit';
import { inBackpack, trackOf } from '../domain/task/task';
import { canAddTask } from '../domain/task/pool';
import { verifyTaskReopen } from '../domain/task/complete';
import { activeRefInTx, insertStateInTx, openInTx } from '../services/tracking/api';
import { knownTags } from '../domain/timeline/tags';
import { LOOSE } from '../shared/backpack';
import type { AppState } from '../data/repos';
import type { Card } from '../domain/card/card';
import type { RecordEntry } from '../domain/record/record';
import type { Task } from '../domain/task/task';
import type { TimeEntry } from '../domain/timeline/entry';
import type { Notice } from '../shared/notices';
import type { Settings } from '../shared/settings';
import { jsonValue } from '../shared/operation';
import type { JsonValue } from '../shared/operation';
import { ApplicationError, applicationFailure } from '../shared/appError';
import type { ApplicationFailure } from '../shared/appError';
import type { HistoryIntent, HistorySource } from '../shared/history';

function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function summarizeEntry(entry: TimeEntry) {
  return {
    id: entry.id,
    description: entry.description,
    project: entry.project,
    tags: [...entry.tags],
    started_at: entry.started_at,
    ended_at: entry.ended_at,
    card_id: entry.card_id,
    kind: entry.kind,
    source: entry.source,
  };
}

function buildTimerContext(
  state: AppState,
  entries: readonly TimeEntry[],
  cards: readonly Card[],
  tasks: readonly Task[],
  taskMode = true,
): z.infer<typeof timerContextSchema> {
  const open = entries.find(entry => entry.id === state.open_entry && entry.ended_at === null);
  if (!open) {
    throw new Error('STATE_INCONSISTENT：当前计时条目缺失或与运行指针不一致');
  }
  const resumeEntry = state.resume_entry_id ? entries.find(entry => entry.id === state.resume_entry_id) ?? null : null;
  const selectedCard = state.current_card ? cards.find(card => card.id === state.current_card) ?? null : null;
  const activeCard = selectedCard && (selectedCard.status === '待做' || selectedCard.status === '进行中') ? selectedCard : null;
  const cardTask = activeCard?.task_id ? tasks.find(task => task.id === activeCard.task_id) : undefined;
  const timing = activeCard ? cardTiming(activeCard, cardTask) : null;
  const expected = timerStateToken(state, open, activeCard);

  let mode: z.infer<typeof timerContextSchema>['mode'];
  let allowed: string[];
  if (state.rest !== null) {
    mode = 'rest';
    allowed = ['add_time_entry', 'update_time_entry'];
  } else if (open.kind === '插入') {
    mode = 'away';
    // 插入中：替换插入的事（start_timer / start_break）、暂停插入的事、回到任务、结束原任务；插入的事暂停了：继续插入的事、回到任务、结束原任务
    allowed = open.project === '待机'
      ? ['resume_timer', 'return_from_break', 'end_original_task', 'start_timer', 'start_break', 'add_time_entry', 'update_time_entry']
      : ['pause_timer', 'return_from_break', 'end_original_task', 'start_timer', 'start_break', 'add_time_entry', 'update_time_entry'];
  } else if (state.pending_id !== null) {
    mode = 'pending';
    allowed = ['add_time_entry', 'update_time_entry'];
  } else if (open.kind === '暂停') {
    mode = 'paused';
    const hasCurrentPausedCard = Boolean(taskMode && activeCard && resumeEntry?.card_id === activeCard.id);
    allowed = [
      ...(resumeEntry ? ['resume_timer'] : []),
      ...(hasCurrentPausedCard ? ['complete_task_item', 'keep_going_task_item', 'split_task_item'] : []),
      'stop_timer',
      'start_timer',
      ...(taskMode ? ['start_task_item'] : []),
      'start_break',
      'add_time_entry',
      'update_time_entry',
    ];
  } else if (open.project === '待机') {
    mode = 'idle';
    allowed = [
      'start_timer',
      ...(taskMode ? ['start_task_item'] : []),
      'start_break',
      'add_time_entry',
      'update_time_entry',
    ];
  } else {
    mode = 'running';
    const hasCurrentRunningCard = Boolean(taskMode && activeCard && open.card_id === activeCard.id);
    allowed = [
      'pause_timer',
      ...(hasCurrentRunningCard ? ['complete_task_item', 'keep_going_task_item', 'split_task_item'] : []),
      'stop_timer',
      'start_timer',
      ...(taskMode ? ['start_task_item'] : []),
      'start_break',
      'add_time_entry',
      'update_time_entry',
    ];
  }

  return timerContextSchema.parse({
    mode,
    expected_state: expected,
    open_entry: summarizeEntry(open),
    paused_target: resumeEntry ? summarizeEntry(resumeEntry) : null,
    pending: state.pending_id && state.pending_at ? { id: state.pending_id, started_at: state.pending_at } : null,
    current_card: activeCard && timing ? {
      id: activeCard.id,
      content: activeCard.content,
      status: activeCard.status,
      task_id: activeCard.task_id,
      task_name: cardTask?.name ?? LOOSE.name,
      project: timing.project,
      tags: timing.tags,
      goal_minutes: activeCard.type === '时间盒卡' ? activeCard.timebox_minutes : null,
    } : null,
    rest: state.rest ? { suggestion: state.rest.suggestion, started_at: state.rest.started_at } : null,
    away_paused: mode === 'away' && open.project === '待机',
    allowed_actions: allowed,
  });
}

function describeNotice(notice: Notice): string {
  switch (notice.kind) {
    case 'offlineAsk': {
      const d = notice.data as Notice<'offlineAsk'>['data'];
      return `存在离线区间待确认（${d.from} 至 ${d.to}）`;
    }
    case 'idleAsk': {
      const d = notice.data as Notice<'idleAsk'>['data'];
      return `有一段待机待用户说明在做什么（${d.from} 至 ${d.to}，${d.minutes} 分钟）；请提示用户在单轨界面回答`;
    }
    case 'longActivity': {
      const d = notice.data as Notice<'longActivity'>['data'];
      return `「${d.activity}」已持续超过 ${d.hours} 小时`;
    }
    case 'skipSignal': {
      const d = notice.data as Notice<'skipSignal'>['data'];
      return `事项「${d.title}」已跳过 ${d.count} 次，建议拆小或放弃`;
    }
    case 'subconscious': {
      const d = notice.data as Notice<'subconscious'>['data'];
      return `休息活动「${d.answer}」已出现 ${d.count} 次`;
    }
    case 'restReturn':
      return '当前处于降级休息，待在单轨界面确认休息返回';
    case 'inputHint':
      return '近期多次跳过事项，建议切换为输入记录';
    default:
      return `待处理提示：${notice.kind}`;
  }
}

function buildPendingActions(notices: readonly Notice[], entries: readonly TimeEntry[], state: AppState) {
  const result: { id: string; kind: string; summary: string; data: JsonValue }[] = notices.map(notice => ({
    id: notice.id,
    kind: notice.kind,
    summary: describeNotice(notice),
    data: notice.data as unknown as JsonValue,
  }));
  for (const entry of entries) {
    if (entry.source === '离线追问' && entry.project === '离线' && entry.ended_at !== null) {
      const alreadyListed = notices.some(n =>
        n.kind === 'offlineAsk' &&
        (n.data as Notice<'offlineAsk'>['data']).from === entry.started_at &&
        (n.data as Notice<'offlineAsk'>['data']).to === entry.ended_at);
      if (!alreadyListed) {
        result.push({
          id: `offline:${entry.id}`,
          kind: 'offlineAsk',
          summary: `存在未回答的离线区间（${entry.started_at} 至 ${entry.ended_at}）`,
          data: { entry_id: entry.id, from: entry.started_at, to: entry.ended_at },
        });
      }
    }
  }
  if (state.pending_id && state.pending_at) {
    result.push({
      id: `pending:${state.pending_id}`,
      kind: 'pendingConfirmation',
      summary: `界面存在自 ${state.pending_at} 起的待确认计时起点`,
      data: { pending_id: state.pending_id, started_at: state.pending_at },
    });
  }
  if (state.rest) {
    result.push({
      id: `rest:${state.rest.started_at}`,
      kind: 'degradeRest',
      summary: '当前处于降级休息状态，需在界面完成休息返回',
      data: { suggestion: state.rest.suggestion, started_at: state.rest.started_at },
    });
  }
  return result;
}

/** Reads exclusively from the single committed snapshot; never mixes unserialized repository files or masks a blocked journal. */
function readCommittedView(ctx: Ctx): {
  state: AppState;
  cards: Card[];
  tasks: Task[];
  records: RecordEntry[];
  entries: TimeEntry[];
  settings: Settings;
  notices: Notice[];
  plan: Snapshot['plan'] | null;
} {
  assertQueueHealthy(ctx);
  const snap = ctx.snapshot();
  if (!snap) {
    throw new Error('APP_NOT_READY：单轨已提交快照尚未就绪，请等待初始化完成');
  }
  return {
    state: snap.state,
    cards: snap.cards,
    tasks: snap.tasks,
    records: snap.records,
    entries: snap.entries,
    settings: snap.settings,
    notices: ctx.notices(),
    plan: snap.plan ?? null,
  };
}

function nextStepForCode(code: string): string {
  switch (code) {
    case 'STATE_CHANGED':
      return '计时状态已变化；请直接复制错误中附带的 latest_context.expected_state 与 latest_context.operation_id 重新判断是否执行，或向用户确认';
    case 'STATE_REQUIRED':
      return '该操作会停止当前正在计时或暂停的事项卡片；请先调用 get_context 获取 expected_state 并传入';
    case 'PENDING_CONFIRMATION':
    case 'PENDING_START_CONFIRMATION':
      return '单轨界面存在待确认起点；请提示用户在单轨界面完成确认或放弃后再调用计时或卡片工具';
    case 'IN_AWAY_ACTIVITY':
      return '当前正在插入别的事（做卡途中插进来的事，或临时活动）；可以用 start_timer / start_break 换成另一件事、pause_timer / resume_timer 暂停或继续插入的事、return_from_break 回到原来的任务，或调用 end_original_task 结束原任务';
    case 'TASK_MODE_OFF':
      return '用户在单轨设置 02 关掉了任务模式；请改用 start_timer 开始自由计时，或提示用户在设置里打开任务模式';
    case 'IN_DEGRADE_REST':
    case 'IN_REST_MODE':
      return '单轨处于降级休息状态；请提示用户在界面返回或重启单轨';
    case 'NO_RESUME_TARGET':
      return '当前没有可恢复的暂停活动；请改用 start_timer 或 start_task_item 开始新计时';
    case 'NOT_IN_BREAK':
      return '当前不在临时离开/插入活动中；若要恢复已暂停活动请改用 resume_timer';
    case 'TIMEBOX_NOT_REACHED':
      return '当前时间盒卡片尚未达到目标时长；若确认提前完成请传入 finish_early=true，或改用 keep_going_task_item 暂存进度';
    case 'PLAN_DAY_CHANGED':
      return '请先调用 get_task_plan 获取当前有效的今天或明天 YYYY-MM-DD 活动日后再操作';
    case 'CARRY_CONFIRMATION_REQUIRED':
      return '今天任务板存在昨日带入待确认事项；请先调用 confirm_plan_carry 确认保留哪些事项';
    case 'CARD_NOT_DRAWABLE':
      return '该事项不在当前可抽取候选集合中；请先调用 get_task_plan 查看 drawable_card_ids 或排入今天任务板';
    case 'TASK_CAPACITY_FULL':
      return '目标类别背包槽位已满；请调用 get_task_details 查看 make_room_candidates 并显式传入 make_room 腾位';
    case 'MAIN_TASK_ITEMS_FULL':
      return '主线任务待做事项已达上限；请先完成或移出其他待做事项后再恢复';
    case 'MAKE_ROOM_NOT_NEEDED':
      return '目标任务已在背包进行中或事项已是待做状态，无需腾位；请去掉 make_room 参数后重试';
    case 'INVALID_MAKE_ROOM_TARGET':
      return '请从 get_task_details 返回的 make_room_candidates 中选择同槽位进行中任务作为 make_room 目标';
    case 'COMPLETION_ID_MISMATCH':
      return '任务的 completion_id 已变化；请先调用 get_task_details 读取最新 completion_id 后再执行撤销完成';
    case 'TASK_COMPLETION_CHANGED':
      return '任务或事项在完成后已被修改（或任务有完成快照却传入了 completion_id=null）；请调用 get_task_details 检查最新状态';
    case 'TASK_NOT_ACTIVE':
      return '目标任务不在背包进行中（可能已完成、已冷藏或已放弃）；请先用 get_task_details 检查任务状态';
    case 'TASK_NOT_COMPLETED':
      return '目标任务当前未处于已完成状态，无需重新打开';
    case 'TASK_NOT_REOPENABLE':
      return '目标任务已冷藏或已放弃，不支持作为已完成任务恢复';
    case 'CARD_NOT_ACTIVE':
      return '目标事项当前不是待做或进行中状态；请先用 find_items 或 get_task_details 检查状态';
    case 'CARD_NOT_COMPLETED':
      return '目标事项当前不是已完成状态，无需取消完成';
    case 'NOT_CURRENT_CARD':
      return '目标事项不是首页当前正在做或暂停的卡片；请先调用 get_context 确认 current_card';
    case 'INVALID_BUCKET':
      return '所选 bucket 不在当前回看周期的可用分桶列表中；请先不传 bucket 调用 get_recap 查看 buckets 列表';
    case 'IDEA_NOT_COMPLETED':
      return '该想法当前不是已完成状态，无法撤销完成';
    case 'UNKNOWN_PROJECT':
    case 'RESERVED_PROJECT':
      return '请从 latest_context.options.projects 中选择合法项目名称（或省略以使用「未分类」）';
    case 'OPERATION_CONFLICT':
      return '该 operation_id 已绑定到另一条不同请求；新操作请使用 latest_context.operation_id';
    default:
      return '请根据错误码与说明修正参数，或检查单轨当前状态后重试';
  }
}

function inferErrorCode(rawMessage: string): string {
  if (rawMessage.includes('卡片不存在')) return 'CARD_NOT_FOUND';
  if (rawMessage.includes('任务不存在')) return 'TASK_NOT_FOUND';
  if (rawMessage.includes('不在背包')) return 'CARD_NOT_IN_BACKPACK';
  if (rawMessage.includes('不在板子上')) return 'CARD_NOT_ON_PLAN';
  if (rawMessage.includes('已经在今天') || rawMessage.includes('已经在明天')) return 'ALREADY_ON_PLAN';
  if (rawMessage.includes('结果卡不填今天的量') || rawMessage.includes('结果卡不填剩下的分钟')) return 'RESULT_CARD_NO_MINUTES';
  if (rawMessage.includes('今天的量要是正整数分钟')) return 'INVALID_TODAY_MINUTES';
  if (rawMessage.includes('两句都要写') || rawMessage.includes('不能少于今天已经计的时间') || rawMessage.includes('剩下的时长至少')) return 'INVALID_SPLIT_INPUT';
  if (rawMessage.includes('首页卡片已改变')) return 'NOT_CURRENT_CARD';
  return 'EXECUTION_FAILED';
}

function enrichError(ctx: Ctx, error: unknown): Error {
  const rawMessage = error instanceof Error ? error.message : String(error);
  let queueFault: ApplicationFailure | undefined;
  try { assertQueueHealthy(ctx); } catch (failure) { queueFault = applicationFailure(failure); }
  const codeMatch = /^([A-Z][A-Z0-9_]+)[：:]\s*(.*)$/s.exec(rawMessage);
  const code = codeMatch
    ? codeMatch[1]
    : (rawMessage.includes('正在安装更新')
      ? 'UPDATE_IN_PROGRESS'
      : queueFault || rawMessage.includes('提交已阻塞')
        ? queueFault?.code ?? 'JOURNAL_BLOCKED'
        : inferErrorCode(rawMessage));
  const category = queueFault?.category ?? applicationFailure(new Error(`${code}：${rawMessage}`)).category;
  let latestContext: JsonValue | undefined;
  const snap = ctx.snapshot();
  if (!queueFault && snap) {
    const view = readCommittedView(ctx);
    const timer = buildTimerContext(view.state, view.entries, view.cards, view.tasks, view.settings.taskMode);
    latestContext = {
      operation_id: ctx.id(),
      expected_state: timer.expected_state,
      timer,
      allowed_actions: timer.allowed_actions,
      options: {
        projects: ['未分类', ...view.settings.lists.projects.map(p => p.name)],
        known_tags: knownTags([...view.entries, ...view.settings.lists.presets, ...view.cards], view.settings.lists.tags),
      },
    };
  }
  const structured = {
    status: 'error' as const,
    code,
    category,
    message: rawMessage,
    next_step: nextStepForCode(code),
    ...(latestContext ? { latest_context: latestContext } : {}),
  };
  return new ApplicationError(structured, error);
}

function buildTaskPlanBoard(
  plan: DayPlan,
  input: {
    cards: readonly Card[];
    tasks: readonly Task[];
    entries: readonly TimeEntry[];
    runningCard: string | null;
    boundaryHour: number;
    at: string;
    isToday: boolean;
    inserting: boolean;
    legacyRest: boolean;
  },
): z.infer<typeof taskPlanBoardSchema> {
  const byId = new Map(input.cards.map(c => [c.id, c]));
  const items = visibleItems(plan, input.cards, input.tasks).map(item => {
    const card = byId.get(item.card_id)!;
    const minutes = input.isToday ? minutesOnDay(input.entries, card.id, plan.day, input.boundaryHour, input.at) : 0;
    return {
      card_id: card.id,
      title: card.content,
      track: trackOf(card.task_id, [...input.tasks]),
      priority: item.priority,
      today_minutes: item.today_minutes,
      minutes_today: Math.floor(minutes),
      achieved: input.isToday && achieved(item, card, minutes),
      running: input.isToday && input.runningCard === card.id,
      carried: item.carried,
      due_today: dueOn(card, plan.day, input.boundaryHour),
    };
  });
  const carryPending = !plan.carried_confirmed && items.some(item => item.carried);
  const drawableCardIds = input.isToday
    ? drawableCandidates({
        plan,
        cards: input.cards,
        tasks: input.tasks,
        entries: input.entries,
        boundaryHour: input.boundaryHour,
        at: input.at,
        activeCard: input.runningCard,
        inserting: input.inserting,
        legacyRest: input.legacyRest,
      }).map(c => c.card.id)
    : [];
  return taskPlanBoardSchema.parse({
    day: plan.day,
    skip_until_planned: plan.skip_until_planned,
    carry_pending: carryPending,
    items,
    seen_card_ids: [...plan.seen],
    drawable_card_ids: drawableCardIds,
  });
}

async function buildTaskPlanBoardInTx(tx: Transaction, which: 'today' | 'tomorrow'): Promise<z.infer<typeof taskPlanBoardSchema>> {
  const today = activityDay(tx.at, tx.settings.dayBoundaryHour);
  const plan = which === 'today' ? tx.todayPlan : await tx.plan(shiftDay(today, 1));
  return buildTaskPlanBoard(plan, {
    cards: tx.cards,
    tasks: tx.tasks,
    entries: tx.entries,
    runningCard: activeRefInTx(tx),
    boundaryHour: tx.settings.dayBoundaryHour,
    at: tx.at,
    isToday: which === 'today',
    inserting: insertStateInTx(tx) !== null,
    legacyRest: tx.state.rest !== null,
  });
}

function doesTaskTouchTimerInTx(tx: Transaction, taskId: string): boolean {
  if (insertStateInTx(tx)) return false;
  const open = openInTx(tx);
  const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
  return tx.cards.some(
    c =>
      c.task_id === taskId &&
      (c.status === '待做' || c.status === '进行中') &&
      (c.status === '进行中' ||
        open?.card_id === c.id ||
        (open?.kind === '暂停' && resume?.card_id === c.id)),
  );
}

function requireExpectedStateWhenTouchingTimerInTx(
  tx: Transaction,
  expectedState: string | undefined,
  touchesTimer: boolean,
): void {
  if (!touchesTimer) return;
  if (!expectedState) {
    throw new Error('STATE_REQUIRED：该操作会停止当前正在计时或暂停的事项卡片，必须提供 expected_state');
  }
  const actual = timerStateTokenInTx(tx);
  if (actual !== expectedState) {
    throw new Error(`STATE_CHANGED：当前计时状态已改变（expected=${expectedState}, actual=${actual}），请先查看最新状态`);
  }
}

function matchesQuery(needle: string, fields: readonly (string | null | undefined)[]): { matched: boolean; exact: boolean } {
  if (!needle) return { matched: true, exact: false };
  const lower = needle.toLowerCase();
  let exact = false;
  let matched = false;
  for (const field of fields) {
    if (!field) continue;
    const normalized = field.trim().toLowerCase();
    if (normalized === lower) exact = true;
    if (normalized.includes(lower)) matched = true;
  }
  return { matched, exact };
}

/** External requests use the same root transaction queue as desktop actions. */
export async function handleApplicationRequest(ctx: Ctx, input: unknown, signal?: AbortSignal) {
  const request = applicationRequest.parse(input);
  // 操作历史的来源（ADR 0019 第 6 条）：请求带了 origin 就记 MCP / CLI 与调用方；旧客户端没带记「自动化 · 未识别」
  const source: HistorySource = request.origin
    ? { kind: request.origin.kind, agent: request.origin.agent }
    : { kind: 'automation', agent: { name: null, detected_by: 'none' } };
  try {
    if (signal?.aborted) throw new Error('CANCELLED：请求在执行前已取消');

    switch (request.method) {
      case 'get_context': {
        const view = readCommittedView(ctx);
        const asOf = ctx.now();
        const timer = buildTimerContext(view.state, view.entries, view.cards, view.tasks, view.settings.taskMode);
        const sections = new Set(request.arguments.sections ?? ['timer', 'pending_actions', 'options']);
        return contextResult.parse({
          status: 'ready',
          operation_id: ctx.id(),
          expected_state: timer.expected_state,
          as_of: asOf,
          ...(sections.has('timer') ? { timer } : {}),
          ...(sections.has('pending_actions') ? { pending_actions: buildPendingActions(view.notices, view.entries, view.state) } : {}),
          ...(sections.has('options') ? {
            options: {
              projects: ['未分类', ...view.settings.lists.projects.map(p => p.name)],
              known_tags: knownTags([...view.entries, ...view.settings.lists.presets, ...view.cards], view.settings.lists.tags),
              // 0.3.1：快捷活动（place 弹层）永远是插入，不再看 mode（ADR 0021 第 3 条，第 2 轮 S6）
              break_presets: view.settings.lists.presets
                .filter(p => p.place === '弹层')
                .map(p => ({ id: p.id, name: p.name, project: p.project, tags: [...p.tags] })),
            },
          } : {}),
          today_plan: view.settings.taskMode && view.plan ? {
            day: view.plan.today.day, skip_until_planned: view.plan.today.skipUntilPlanned, carry_pending: view.plan.today.carryPending,
            items: view.plan.today.rows.map(r => ({ card_id: r.cardId, title: r.title, track: r.track, priority: r.priority, today_minutes: r.todayMinutes,
              minutes_today: r.minutesToday, achieved: r.achieved, running: r.running, carried: r.carried, due_today: r.dueThatDay })),
          } : null,
        });
      }

      case 'get_operation_result': {
        const id = request.arguments.operation_id.toLowerCase();
        const receipt = await readOperation(ctx, id, signal);
        return lookupResult.parse(receipt ? {
          status: 'committed',
          operation_id: receipt.operation_id,
          command: receipt.command,
          request: {
            method: receipt.command,
            arguments: jsonValue.parse(JSON.parse(receipt.input)),
          },
          data: receipt.data,
          committed_at: receipt.committed_at,
        } : { status: 'not_found', operation_id: id });
      }

      case 'find_items': {
        const view = readCommittedView(ctx);
        const asOf = ctx.now();
        const kind = request.arguments.kind ?? 'all';
        const query = request.arguments.query?.trim() ?? '';
        const includeArchived = request.arguments.include_archived ?? false;

        const ideas = (kind === 'all' || kind === 'idea')
          ? view.records
            .filter(r => r.kind === '想法' && r.pool !== null && (includeArchived || r.pool === '活跃池'))
            .flatMap(r => {
              const m = matchesQuery(query, [r.text, r.needs, ...r.tags]);
              return m.matched ? [{
                id: r.id, text: r.text, tags: [...r.tags], needs: r.needs,
                pool: ideaStatus(r)!, created_at: r.created_at, exact_match: m.exact,
              }] : [];
            })
            .sort((a, b) => Number(b.exact_match) - Number(a.exact_match) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
          : [];

        const todoCards = (kind === 'all' || kind === 'todo_card')
          ? view.cards
            .filter(c => includeArchived || c.status === '待做' || c.status === '进行中')
            .flatMap(c => {
              const task = c.task_id ? view.tasks.find(t => t.id === c.task_id) : undefined;
              const timing = cardTiming(c, task);
              const m = matchesQuery(query, [c.content, c.content.replace(/[[\]]/g, ''), task?.name, timing.project, ...timing.tags]);
              if (!m.matched) return [];
              const slot: '主线' | '支线' | '游离' = task ? task.slot : '游离';
              return [{
                id: c.id,
                content: c.content,
                status: c.status,
                type: c.type,
                task_id: c.task_id,
                task_name: task?.name ?? LOOSE.name,
                slot,
                project: timing.project,
                tags: timing.tags,
                due_at: c.due_at,
                blocking: c.blocking,
                exact_match: m.exact,
              }];
            })
          : [];

        const tasks = (kind === 'all' || kind === 'task')
          ? view.tasks
            .filter(t => includeArchived || inBackpack(t))
            .flatMap(t => {
              const m = matchesQuery(query, [t.name, t.default_project]);
              if (!m.matched) return [];
              const openCount = view.cards.filter(c => c.task_id === t.id && (c.status === '待做' || c.status === '进行中')).length;
              return [{
                id: t.id,
                name: t.name,
                slot: t.slot,
                status: t.status,
                default_project: t.default_project,
                open_card_count: openCount,
                exact_match: m.exact,
              }];
            })
          : [];

        const totalMatched = ideas.length + todoCards.length + tasks.length;
        return findItemsResult.parse({
          as_of: asOf,
          query,
          ambiguous: query.length > 0 && totalMatched > 1,
          ideas,
          todo_cards: todoCards,
          tasks,
        });
      }

      case 'get_time_summary': {
        const view = readCommittedView(ctx);
        const asOf = ctx.now();
        return timeSummaryResult.parse(summarizeDay(view.entries, {
          day: request.arguments.day ?? 'today',
          dayMode: request.arguments.day_mode ?? 'activity',
          boundaryHour: view.settings.dayBoundaryHour,
          asOf,
          timezone: deviceTimezone(),
        }));
      }

      case 'list_time_entries': {
        const view = readCommittedView(ctx);
        const asOf = ctx.now();
        const clipped = clipEntriesInRange(view.entries, request.arguments.from, request.arguments.to, asOf);
        return listTimeEntriesResult.parse({
          ...clipped,
          timezone: deviceTimezone(),
        });
      }

      case 'save_idea': {
        const args = request.arguments;
        const normalized = { text: args.text, needs: args.needs?.trim() || null };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const record = saveRecordInTx(tx, {
            id: tx.id(), text: normalized.text, kind: '想法', created_at: tx.at, needs: normalized.needs,
            due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [],
          });
          return ideaResult.parse({ id: record.id, text: record.text, created_at: record.created_at, tags: record.tags, pool: record.pool });
        }, undefined, signal, { action: 'auto.save_idea', source });
        return saveIdeaResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'capture_todo': {
        const args = request.arguments;
        const normalized = {
          text: args.text,
          task_id: args.task_id?.trim() || null,
          due_at: args.due_at ?? null,
          // 0.3.1 起不起作用（删除阻塞机制，已定 12）：参数照收，记录照写 false
          blocking: false,
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const { record, card, task } = captureTodoInTx(tx, normalized);
          return todoResult.parse({
            record_id: record.id,
            card_id: card.id,
            task_id: task.id,
            task_name: task.name,
            slot: task.slot,
            content: card.content,
            tags: card.tags,
            due_at: card.due_at,
            blocking: card.blocking,
            created_at: record.created_at,
          });
        }, undefined, signal, { action: 'auto.capture_todo', source });
        return captureTodoResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'start_timer': {
        const args = request.arguments;
        const normalized = {
          expected_state: args.expected_state,
          description: args.description,
          project: args.project?.trim() || '未分类',
          tags: args.tags ? [...args.tags] : [],
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = startTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.start_timer', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'start_task_item': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state, card_id: args.card_id };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = await startTaskItemCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.noop ? 'already_running' : null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.start_task_item', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'pause_timer': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = pauseTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.reason,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.pause_timer', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'resume_timer': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = await resumeTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.reason,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.resume_timer', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'stop_timer': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = stopTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.reason,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.stop_timer', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'start_break': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state, activity: args.activity };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = startBreakCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.start_break', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'return_from_break': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = await returnFromBreakCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.return_from_break', source });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'update_time_entry': {
        const args = request.arguments;
        const normalized = {
          expected_state: args.expected_state,
          entry_id: args.entry_id,
          ...(args.start !== undefined ? { start: args.start } : {}),
          ...(args.end !== undefined ? { end: args.end } : {}),
          ...(args.description !== undefined ? { description: args.description } : {}),
          ...(args.project !== undefined ? { project: args.project.trim() || '未分类' } : {}),
          ...(args.tags !== undefined ? { tags: [...args.tags] } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const { entry, overlaps } = updateTimeEntryCheckedInTx(tx, normalized);
          return updateTimeEntryData.parse({ entry: summarizeEntry(entry), overlaps, expected_state: timerStateTokenInTx(tx) });
        }, undefined, signal, { action: 'auto.update_time_entry', subject: { type: 'entry', id: args.entry_id }, source });
        return updateTimeEntryResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'add_time_entry': {
        const args = request.arguments;
        const normalized = {
          description: args.description,
          start: args.start,
          end: args.end,
          project: args.project?.trim() || '未分类',
          tags: args.tags ? [...args.tags] : [],
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const { entry, overlaps } = addTimeEntryCheckedInTx(tx, normalized);
          return addTimeEntryData.parse({
            entry: summarizeEntry(entry),
            overlaps,
            expected_state: timerStateTokenInTx(tx),
          });
        }, undefined, signal, { action: 'auto.add_time_entry', source });
        return addTimeEntryResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'complete_idea': {
        const args = request.arguments;
        const normalized = { idea_id: args.idea_id.toLowerCase() };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const idea = tx.records.find(r => r.id.toLowerCase() === normalized.idea_id);
          if (!idea || idea.kind !== '想法') throw new Error(`IDEA_NOT_FOUND：找不到这个想法（${args.idea_id}），请先用 find_items 查到准确 ID`);
          const status = ideaStatus(idea);
          if (status !== '活跃池' && status !== '已完成') throw new Error(`IDEA_NOT_ACTIVE：这个想法当前是「${status}」，只有想法池里的想法能标记完成`);
          const { record, noop } = completeIdeaInTx(tx, idea.id, completedBy(source));
          return completeIdeaData.parse({ id: record.id, text: record.text, status: '已完成', completed_at: record.completed_at, noop });
        }, undefined, signal, { action: 'auto.complete_idea', subject: { type: 'record', id: normalized.idea_id }, source });
        return completeIdeaResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'reopen_idea': {
        const args = request.arguments;
        const normalized = { idea_id: args.idea_id.toLowerCase() };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const idea = tx.records.find(r => r.id.toLowerCase() === normalized.idea_id);
          if (!idea || idea.kind !== '想法') throw new Error(`IDEA_NOT_FOUND：找不到这个想法（${args.idea_id}），请先用 find_items 查到准确 ID`);
          const status = ideaStatus(idea);
          if (status === '活跃池') {
            return reopenIdeaData.parse({ id: idea.id, text: idea.text, pool: '活跃池', noop: true });
          }
          if (status !== '已完成') {
            throw new Error(`IDEA_NOT_COMPLETED：这个想法当前是「${status}」，只有已完成的想法能撤销完成`);
          }
          const { record, noop } = uncompleteIdeaInTx(tx, idea.id);
          return reopenIdeaData.parse({ id: record.id, text: record.text, pool: '活跃池', noop });
        }, undefined, signal, { action: 'auto.reopen_idea', subject: { type: 'record', id: normalized.idea_id }, source });
        return reopenIdeaResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'get_task_plan': {
        const which = request.arguments.day ?? 'today';
        return readSerial(ctx, async () => {
          const view = readCommittedView(ctx);
          const asOf = ctx.now();
          const today = activityDay(asOf, view.settings.dayBoundaryHour);
          const resolvedDay = which === 'today' ? today : shiftDay(today, 1);
          if (!view.settings.taskMode) {
            return getTaskPlanResult.parse({
              as_of: asOf,
              which,
              resolved_day: resolvedDay,
              day_boundary_hour: view.settings.dayBoundaryHour,
              enabled: false,
              plan: null,
            });
          }
          const planFile = await ctx.repos.plans.read(resolvedDay);
          const entries = ctx.repos.times.snapshot();
          const open = entries.find(e => e.id === view.state.open_entry) ?? null;
          const resume = view.state.resume_entry_id ? entries.find(e => e.id === view.state.resume_entry_id) ?? null : null;
          const runningCard = activeCardOf(open, resume);
          const plan = buildTaskPlanBoard(planFile.value, {
            cards: view.cards,
            tasks: view.tasks,
            entries,
            runningCard,
            boundaryHour: view.settings.dayBoundaryHour,
            at: asOf,
            isToday: which === 'today',
            inserting: insertState(open, resume) !== null,
            legacyRest: view.state.rest !== null,
          });
          return getTaskPlanResult.parse({
            as_of: asOf,
            which,
            resolved_day: resolvedDay,
            day_boundary_hour: view.settings.dayBoundaryHour,
            enabled: true,
            plan,
          });
        }, signal);
      }

      case 'add_plan_item': {
        const args = request.arguments;
        const normalized = {
          day: args.day,
          card_id: args.card_id,
          priority: args.priority ?? '普通',
          ...(args.today_minutes !== undefined ? { today_minutes: args.today_minutes } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const which = resolvePlanDayInTx(tx, normalized.day, false);
          await addPlanItemInTx(tx, which, {
            cardId: normalized.card_id,
            priority: normalized.priority,
            todayMinutes: normalized.today_minutes,
          });
          const plan = await buildTaskPlanBoardInTx(tx, which);
          return planMutationData.parse({
            noop: false,
            which,
            day: normalized.day,
            plan,
          });
        }, undefined, signal, { action: 'auto.add_plan_item', subject: { type: 'card', id: normalized.card_id }, source });
        return planMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'remove_plan_item': {
        const args = request.arguments;
        const normalized = {
          day: args.day,
          card_id: args.card_id,
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const which = resolvePlanDayInTx(tx, normalized.day, false);
          const today = activityDay(tx.at, tx.settings.dayBoundaryHour);
          const beforePlan = which === 'today' ? tx.todayPlan : await tx.plan(shiftDay(today, 1));
          const hadItem = beforePlan.items.some(item => item.card_id === normalized.card_id);
          await removePlanItemInTx(tx, which, normalized.card_id);
          const plan = await buildTaskPlanBoardInTx(tx, which);
          return planMutationData.parse({
            noop: !hadItem,
            which,
            day: normalized.day,
            plan,
          });
        }, undefined, signal, { action: 'auto.remove_plan_item', subject: { type: 'card', id: normalized.card_id }, source });
        return planMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'update_plan_item': {
        const args = request.arguments;
        const normalized = {
          day: args.day,
          card_id: args.card_id,
          ...(args.priority !== undefined ? { priority: args.priority } : {}),
          ...(args.today_minutes !== undefined ? { today_minutes: args.today_minutes } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const which = resolvePlanDayInTx(tx, normalized.day, false);
          const today = activityDay(tx.at, tx.settings.dayBoundaryHour);
          const beforePlan = which === 'today' ? tx.todayPlan : await tx.plan(shiftDay(today, 1));
          const beforeItem = beforePlan.items.find(item => item.card_id === normalized.card_id);
          const unchanged = Boolean(
            beforeItem &&
            (normalized.priority === undefined || beforeItem.priority === normalized.priority) &&
            (normalized.today_minutes === undefined || beforeItem.today_minutes === normalized.today_minutes),
          );
          await editPlanItemInTx(tx, which, {
            cardId: normalized.card_id,
            priority: normalized.priority,
            todayMinutes: normalized.today_minutes,
          });
          const plan = await buildTaskPlanBoardInTx(tx, which);
          return planMutationData.parse({
            noop: unchanged,
            which,
            day: normalized.day,
            plan,
          });
        }, undefined, signal, { action: 'auto.update_plan_item', subject: { type: 'card', id: normalized.card_id }, source });
        return planMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'confirm_plan_carry': {
        const args = request.arguments;
        const normalized = {
          day: args.day,
          keep_card_ids: [...args.keep_card_ids],
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const which = resolvePlanDayInTx(tx, normalized.day, true);
          const wasConfirmed = tx.todayPlan.carried_confirmed;
          confirmCarryInTx(tx, normalized.keep_card_ids);
          const plan = await buildTaskPlanBoardInTx(tx, which);
          return planMutationData.parse({
            noop: wasConfirmed,
            which,
            day: normalized.day,
            plan,
          });
        }, undefined, signal, { action: 'auto.confirm_plan_carry', source });
        return planMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'skip_today_plan': {
        const args = request.arguments;
        const normalized = {
          day: args.day,
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const which = resolvePlanDayInTx(tx, normalized.day, true);
          const wasSkipped = tx.todayPlan.skip_until_planned;
          skipTodayInTx(tx);
          const plan = await buildTaskPlanBoardInTx(tx, which);
          return planMutationData.parse({
            noop: wasSkipped,
            which,
            day: normalized.day,
            plan,
          });
        }, undefined, signal, { action: 'auto.skip_today_plan', source });
        return planMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'draw_task_item': {
        return readSerial(ctx, async () => {
          const view = readCommittedView(ctx);
          const asOf = ctx.now();
          const day = activityDay(asOf, view.settings.dayBoundaryHour);
          const pick = await drawFromPlanInSerial(ctx, asOf);
          if (pick.kind === 'task') {
            const planFile = await ctx.repos.plans.read(day);
            const planItem = planFile.value.items.find(item => item.card_id === pick.card.id);
            const task = pick.card.task_id ? view.tasks.find(t => t.id === pick.card.task_id) : undefined;
            const candidate = pick.candidates.find(c => c.card.id === pick.card.id);
            return drawTaskItemResult.parse({
              as_of: asOf,
              day,
              outcome: 'card',
              card: {
                id: pick.card.id,
                content: pick.card.content,
                task_id: pick.card.task_id,
                task_name: task?.name ?? LOOSE.name,
                track: trackOf(pick.card.task_id, view.tasks),
                type: pick.card.type,
                priority: candidate?.priority ?? planItem?.priority ?? '普通',
                today_minutes: planItem?.today_minutes ?? null,
                goal_minutes: pick.card.type === '时间盒卡' ? pick.card.timebox_minutes : null,
              },
              candidates: pick.candidates.map(c => ({
                card_id: c.card.id,
                title: c.card.content,
                track: trackOf(c.card.task_id, view.tasks),
                priority: c.priority,
                weight: c.weight,
              })),
              reset_round: pick.resetRound,
              blocked_reason: null,
              guide: null,
            });
          }
          const outcomeMap = {
            plan: 'need_plan',
            confirmCarry: 'confirm_carry',
            blocked: 'blocked',
            done: 'done',
            guide: 'guide',
          } as const;
          return drawTaskItemResult.parse({
            as_of: asOf,
            day,
            outcome: outcomeMap[pick.kind],
            card: null,
            candidates: [],
            reset_round: false,
            blocked_reason: pick.kind === 'blocked' ? pick.reason : null,
            guide: pick.kind === 'guide' ? pick.guide : null,
          });
        }, signal);
      }

      case 'skip_task_item': {
        const args = request.arguments;
        const normalized = {
          day: args.day,
          card_id: args.card_id,
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const which = resolvePlanDayInTx(tx, normalized.day, true);
          if (tx.state.rest !== null) {
            throw new Error('IN_REST_MODE：当前处于休息状态，不能跳过事项');
          }
          if (insertStateInTx(tx) !== null) {
            throw new Error('IN_AWAY_ACTIVITY：当前正在插入别的事，不能抽卡或换一张');
          }
          if (!tx.todayPlan.carried_confirmed && tx.todayPlan.items.some(item => item.carried)) {
            throw new Error('CARRY_CONFIRMATION_REQUIRED：今天任务板存在昨日带入待确认事项，请先调用 confirm_plan_carry 确认');
          }
          const candidates = drawableIdsInTx(tx, tx.todayPlan);
          if (!candidates.includes(normalized.card_id)) {
            throw new Error(`CARD_NOT_DRAWABLE：该事项不在当前可抽取候选集合中（${normalized.card_id}）`);
          }
          const beforeSeen = JSON.stringify(tx.todayPlan.seen);
          skipCardInTx(tx, normalized.card_id, plan => drawableIdsInTx(tx, plan));
          const noop = JSON.stringify(tx.todayPlan.seen) === beforeSeen;
          const plan = await buildTaskPlanBoardInTx(tx, which);
          return planMutationData.parse({
            noop,
            which,
            day: normalized.day,
            plan,
          });
        }, undefined, signal, { action: 'auto.skip_task_item', subject: { type: 'card', id: normalized.card_id }, source });
        return planMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'complete_task_item': {
        const args = request.arguments;
        const normalized = {
          ...(args.expected_state !== undefined ? { expected_state: args.expected_state } : {}),
          card_id: args.card_id,
          ...(args.note !== undefined ? { note: args.note } : {}),
          ...(args.finish_early !== undefined ? { finish_early: args.finish_early } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能完成事项卡片');
          const targetCard = tx.cards.find(c => c.id === normalized.card_id);
          const open = openInTx(tx);
          const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) : undefined;
          const touchesTimer = Boolean(
            targetCard &&
            targetCard.status !== '已完成' &&
            !insertStateInTx(tx) &&
            (targetCard.status === '进行中' ||
              open?.card_id === targetCard.id ||
              (open?.kind === '暂停' && resume?.card_id === targetCard.id)),
          );
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, touchesTimer);
          const openBefore = tx.state.open_entry;
          const outcome = completeTaskItemInTx(tx, {
            cardId: normalized.card_id,
            note: normalized.note,
            finishEarly: normalized.finish_early,
          });
          const stoppedTimer = !outcome.noop && tx.state.open_entry !== openBefore;
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          const openCount = outcome.task
            ? tx.cards.filter(c => c.task_id === outcome.task!.id && (c.status === '待做' || c.status === '进行中')).length
            : 0;
          return completeTaskItemData.parse({
            noop: outcome.noop,
            stopped_timer: stoppedTimer,
            card: {
              id: outcome.card.id,
              content: outcome.card.content,
              status: '已完成',
              completed_at: outcome.card.completed_at,
              completed_day: outcome.card.completed_day,
              completed_track: outcome.card.completed_track,
              progress_note: outcome.card.progress_note,
            },
            task: outcome.task
              ? {
                  id: outcome.task.id,
                  name: outcome.task.name,
                  slot: outcome.task.slot,
                  status: outcome.task.status,
                  open_card_count: openCount,
                }
              : null,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.complete_task_item', subject: { type: 'card', id: normalized.card_id }, source });
        return completeTaskItemResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'reopen_task_item': {
        const args = request.arguments;
        const normalized = {
          ...(args.expected_state !== undefined ? { expected_state: args.expected_state } : {}),
          card_id: args.card_id,
          ...(args.make_room ? { make_room: { action: args.make_room.action, task_id: args.make_room.task_id } } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能取消完成事项卡片');
          const targetCard = tx.cards.find(c => c.id === normalized.card_id);
          const parentTask = targetCard?.task_id ? tx.tasks.find(t => t.id === targetCard.task_id) : null;
          const touchesTimer = Boolean(
            targetCard &&
            targetCard.status === '已完成' &&
            parentTask &&
            !inBackpack(parentTask) &&
            normalized.make_room &&
            doesTaskTouchTimerInTx(tx, normalized.make_room.task_id),
          );
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, touchesTimer);
          const outcome = await reopenTaskItemInTx(tx, {
            cardId: normalized.card_id,
            makeRoom: normalized.make_room
              ? { id: normalized.make_room.task_id, action: normalized.make_room.action === 'freeze' ? '冷藏' : '放弃' }
              : null,
          });
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          const openCount = outcome.task
            ? tx.cards.filter(c => c.task_id === outcome.task!.id && (c.status === '待做' || c.status === '进行中')).length
            : 0;
          return reopenTaskItemData.parse({
            noop: outcome.noop,
            reopened_parent_task: outcome.taskReopened,
            card: {
              id: outcome.card.id,
              content: outcome.card.content,
              status: '待做',
              progress_note: outcome.card.progress_note,
            },
            task: outcome.task
              ? {
                  id: outcome.task.id,
                  name: outcome.task.name,
                  slot: outcome.task.slot,
                  status: outcome.task.status,
                  slot_index: outcome.task.slot_index,
                  open_card_count: openCount,
                }
              : null,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.reopen_task_item', subject: { type: 'card', id: normalized.card_id }, source });
        return reopenTaskItemResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'keep_going_task_item': {
        const args = request.arguments;
        const normalized = {
          expected_state: args.expected_state,
          card_id: args.card_id,
          ...(args.note !== undefined ? { note: args.note } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, true);
          const card = keepGoingCheckedInTx(tx, { cardId: normalized.card_id, note: normalized.note });
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return keepGoingTaskItemData.parse({
            card: {
              id: card.id,
              content: card.content,
              status: '待做',
              progress_note: card.progress_note,
            },
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.keep_going_task_item', subject: { type: 'card', id: normalized.card_id }, source });
        return keepGoingTaskItemResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'split_task_item': {
        const args = request.arguments;
        const normalized = {
          expected_state: args.expected_state,
          card_id: args.card_id,
          today_content: args.today_content,
          rest_content: args.rest_content,
          ...(args.rest_minutes !== undefined ? { rest_minutes: args.rest_minutes } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, true);
          const splitOutcome = splitInTx(
            tx,
            normalized.card_id,
            {
              todayContent: normalized.today_content,
              restContent: normalized.rest_content,
              restMinutes: normalized.rest_minutes ?? null,
            },
            { requireTaskMode: true },
          );
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return splitTaskItemData.parse({
            today_card_id: splitOutcome.todayCard.id,
            rest_card_id: splitOutcome.restCard.id,
            today_content: splitOutcome.todayCard.content,
            rest_content: splitOutcome.restCard.content,
            today_minutes: splitOutcome.todayMinutes ?? splitOutcome.todayCard.timebox_minutes,
            rest_minutes: splitOutcome.restCard.timebox_minutes,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.split_task_item', subject: { type: 'card', id: normalized.card_id }, source });
        return splitTaskItemResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'end_original_task': {
        const args = request.arguments;
        const normalized = {
          expected_state: args.expected_state,
        };
        const intent: HistoryIntent = { action: 'auto.end_original_task', source };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, true);
          if (tx.state.rest !== null) {
            throw new Error('IN_DEGRADE_REST：当前处于降级休息状态，请先在单轨界面完成休息返回');
          }
          if (tx.state.pending_id || tx.state.pending_at) {
            throw new Error('PENDING_CONFIRMATION：单轨界面存在未确认的计时起点，请先在界面确认或放弃后再操作');
          }
          const open = openInTx(tx);
          const resume = tx.state.resume_entry_id ? tx.entries.find(e => e.id === tx.state.resume_entry_id) ?? null : null;
          if (!open || !insertStateInTx(tx) || !resume) {
            throw new Error('NOT_IN_BREAK：当前不在临时离开/插入活动中，无需结束原任务');
          }
          const endedEntryId = resume.id;
          const endedCardId = resume.card_id ?? null;
          const promotedEntryId = open.id;
          if (endedCardId) {
            intent.subject = { type: 'card', id: endedCardId };
          } else {
            intent.subject = { type: 'entry', id: endedEntryId };
          }
          endOriginalInTx(tx);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return endOriginalTaskData.parse({
            ended_entry_id: endedEntryId,
            ended_card_id: endedCardId,
            promoted_entry_id: promotedEntryId,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, intent);
        return endOriginalTaskResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'get_task_details': {
        const taskId = request.arguments.task_id;
        return readSerial(ctx, async () => {
          const view = readCommittedView(ctx);
          const asOf = ctx.now();
          const task = view.tasks.find(t => t.id === taskId);
          if (!task) {
            throw new Error(`TASK_NOT_FOUND：找不到指定的任务（${taskId}），请先用 find_items 查到准确 ID`);
          }
          let reopenMode: 'snapshot_batch' | 'task_only' | 'conflict' | null = null;
          let reopenConflictReason: string | null = null;
          let reopenCardIds: string[] = [];
          if (task.status === '已完成') {
            const check = verifyTaskReopen(task, view.cards, task.completion?.id ?? null);
            if (check.ok) {
              reopenMode = check.mode === 'snapshot' ? 'snapshot_batch' : 'task_only';
              reopenCardIds = check.snapshots.map(s => s.id);
            } else {
              reopenMode = 'conflict';
              reopenConflictReason = check.reason;
            }
          }
          const slotFull = !inBackpack(task) && !canAddTask(view.tasks, task.slot, view.settings);
          const makeRoomCandidates = slotFull
            ? view.tasks
                .filter(t => inBackpack(t) && t.slot === task.slot)
                .map(t => ({ id: t.id, name: t.name, slot: t.slot, slot_index: t.slot_index }))
            : [];
          const batchIds = new Set(task.completion?.cards.map(c => c.id) ?? []);
          const items = view.cards
            .filter(c => c.task_id === task.id)
            .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
            .map(c => {
              const timing = cardTiming(c, task);
              return {
                id: c.id,
                content: c.content,
                status: c.status,
                type: c.type,
                timebox_minutes: c.timebox_minutes,
                project: timing.project,
                tags: timing.tags,
                due_at: c.due_at,
                progress_note: c.progress_note,
                completed_at: c.completed_at,
                in_completion_batch: batchIds.has(c.id),
              };
            });
          return getTaskDetailsResult.parse({
            as_of: asOf,
            task: {
              id: task.id,
              name: task.name,
              slot: task.slot,
              slot_index: task.slot_index,
              status: task.status,
              created_at: task.created_at,
              completed_at: task.completed_at,
              bet_ends_at: task.bet_ends_at,
              default_project: task.default_project,
              completion_id: task.completion?.id ?? null,
              reopen_mode: reopenMode,
              reopen_conflict_reason: reopenConflictReason,
              reopen_card_ids: reopenCardIds,
              slot_full: slotFull,
              make_room_candidates: makeRoomCandidates,
            },
            items,
          });
        }, signal);
      }

      case 'complete_task': {
        const args = request.arguments;
        const normalized = {
          ...(args.expected_state !== undefined ? { expected_state: args.expected_state } : {}),
          task_id: args.task_id,
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能完成任务');
          const targetTask = tx.tasks.find(t => t.id === normalized.task_id);
          const touchesTimer = Boolean(targetTask && targetTask.status !== '已完成' && doesTaskTouchTimerInTx(tx, normalized.task_id));
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, touchesTimer);
          const priorSlotIndex = targetTask?.slot_index ?? null;
          const openBefore = tx.state.open_entry;
          const outcome = completeTaskInTx(tx, normalized.task_id);
          const stoppedTimer = !outcome.noop && tx.state.open_entry !== openBefore;
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          return completeTaskData.parse({
            noop: outcome.noop,
            stopped_timer: stoppedTimer,
            completion_id: outcome.completionId,
            affected_card_ids: outcome.affectedCards.map(c => c.id),
            freed_slot: {
              slot: outcome.task.slot,
              slot_index: outcome.noop ? null : priorSlotIndex,
            },
            task: {
              id: outcome.task.id,
              name: outcome.task.name,
              slot: outcome.task.slot,
              status: '已完成',
              completed_at: outcome.task.completed_at,
              bet_ends_at: outcome.task.bet_ends_at,
            },
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.complete_task', subject: { type: 'task', id: normalized.task_id }, source });
        return completeTaskResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'reopen_task': {
        const args = request.arguments;
        const normalized = {
          ...(args.expected_state !== undefined ? { expected_state: args.expected_state } : {}),
          task_id: args.task_id,
          completion_id: args.completion_id,
          ...(args.make_room ? { make_room: { action: args.make_room.action, task_id: args.make_room.task_id } } : {}),
        };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          if (!tx.settings.taskMode) throw new Error('TASK_MODE_OFF：任务模式已关闭，不能重新打开任务');
          const targetTask = tx.tasks.find(t => t.id === normalized.task_id);
          const touchesTimer = Boolean(
            targetTask &&
            !inBackpack(targetTask) &&
            normalized.make_room &&
            doesTaskTouchTimerInTx(tx, normalized.make_room.task_id),
          );
          requireExpectedStateWhenTouchingTimerInTx(tx, normalized.expected_state, touchesTimer);
          const outcome = await reopenTaskInTx(tx, {
            taskId: normalized.task_id,
            completionId: normalized.completion_id,
            makeRoom: normalized.make_room
              ? { id: normalized.make_room.task_id, action: normalized.make_room.action === 'freeze' ? '冷藏' : '放弃' }
              : null,
          });
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks, tx.settings.taskMode);
          const openCount = tx.cards.filter(c => c.task_id === outcome.task.id && (c.status === '待做' || c.status === '进行中')).length;
          return reopenTaskData.parse({
            noop: outcome.noop,
            reopen_mode: outcome.reopenMode === 'snapshot' ? 'snapshot_batch' : 'task_only',
            reopened_card_ids: outcome.restoredCards.map(c => c.id),
            task: {
              id: outcome.task.id,
              name: outcome.task.name,
              slot: outcome.task.slot,
              slot_index: outcome.task.slot_index!,
              status: '进行中',
              bet_ends_at: outcome.task.bet_ends_at,
              open_card_count: openCount,
            },
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.reopen_task', subject: { type: 'task', id: normalized.task_id }, source });
        return reopenTaskResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'get_recap': {
        const args = request.arguments;
        return readSerial(ctx, async () => {
          const view = readCommittedView(ctx);
          const asOf = ctx.now();
          const period = args.period ?? 'week';
          const dim = args.dimension ?? 'project';
          const includeIdle = args.include_idle ?? false;
          const recap = queryRecap(
            ctx,
            {
              period,
              from: args.from,
              to: args.to,
              dim,
              includeIdle,
              bucket: args.bucket ?? null,
            },
            asOf,
          );
          if (args.bucket !== undefined && !recap.buckets.some(b => b.id === args.bucket)) {
            throw new Error(`INVALID_BUCKET：所选 bucket（${args.bucket}）不在当前回看周期的可用分桶列表中`);
          }
          return getRecapResult.parse({
            computed_at: recap.asOf,
            tracking_mode: view.settings.trackingMode,
            range: {
              period: recap.range.period,
              from_day: recap.range.fromDay,
              to_day: recap.range.toDay,
              days: recap.range.days,
              from: recap.range.from,
              to: recap.range.to,
              effective_to: recap.range.effectiveTo,
              after: recap.range.after,
            },
            today: recap.today,
            earliest_day: recap.earliestDay,
            last_review_at: recap.lastReviewAt,
            effective_ms: recap.effectiveMs,
            active_days: recap.activeDays,
            entry_count: recap.entryCount,
            mainline: {
              permille: recap.mainline.permille,
              by_source: { ...recap.mainline.bySource },
            },
            previous: {
              label: recap.previous.label,
              from_day: recap.previous.fromDay,
              to_day: recap.previous.toDay,
              comparable: recap.previous.comparable,
              effective_ms: recap.previous.effectiveMs,
              main_permille: recap.previous.mainPermille,
              done: recap.previous.done,
              notes: recap.previous.notes,
            },
            unit: recap.unit,
            buckets: recap.buckets.map(b => ({
              id: b.id,
              label: b.label,
              sub: b.sub,
              title: b.title,
              weekend: b.weekend,
              days: [...b.days],
              total_ms: b.totalMs,
              by_key: { ...b.byKey },
            })),
            total_ms: recap.totalMs,
            series: recap.series.map(s => ({
              key: s.key,
              ms: s.ms,
              permille: s.permille,
              color: s.color,
              merged: s.merged,
            })),
            groups: recap.groups.map(g => ({
              key: g.key,
              ms: g.ms,
              permille: g.permille,
              count: g.count,
              color: g.color,
              ...(g.previousMs !== undefined ? { previous_ms: g.previousMs } : {}),
              rows: g.rows.map(r => ({
                key: r.key,
                description: r.description,
                ms: r.ms,
                count: r.count,
                first_day: r.firstDay,
                last_day: r.lastDay,
                start: r.start,
                end: r.end,
                project: r.project,
                tags: [...r.tags],
                card: r.card ? { id: r.card.id, content: r.card.content, track: r.card.track } : null,
                source: r.source,
              })),
            })),
            gone_keys: [...recap.goneKeys],
            done: recap.done.map(d => ({
              id: d.id,
              content: d.content,
              task: d.task,
              track: d.track,
              day: d.day,
              at: d.at,
              ms: d.ms,
            })),
            notes: recap.notes.map(n => ({
              id: n.id,
              note: n.note,
              content: n.content,
              task: n.task,
              track: n.track,
              day: n.day,
              at: n.at,
            })),
          });
        }, signal);
      }

      case 'list_operation_history': {
        const args = request.arguments;
        return readSerial(ctx, async () => {
          const view = readCommittedView(ctx);
          const asOf = ctx.now();
          const toDay = args.to_day ?? activityDay(asOf, view.settings.dayBoundaryHour);
          const fromDay = args.from_day ?? shiftHistoryDay(toDay, -6);
          if (fromDay > toDay) {
            throw new Error(`INVALID_DATE_RANGE：from_day（${fromDay}）不能晚于 to_day（${toDay}）`);
          }
          const page = await ctx.repos.history.readDays(fromDay, toDay);
          const filtered = page.records.filter(r => {
            if (args.source !== undefined) {
              if (args.source === 'all_automation') {
                if (!isAutomation(r)) return false;
              } else if (r.source.kind !== args.source) {
                return false;
              }
            }
            if (args.agent !== undefined) {
              const agentName = (r.source.kind === 'mcp' || r.source.kind === 'cli' || r.source.kind === 'automation')
                ? r.source.agent.name
                : null;
              if (!agentName || agentName.toLowerCase() !== args.agent.toLowerCase()) return false;
            }
            if (args.method !== undefined) {
              const needle = args.method.toLowerCase();
              const callMethod = r.call?.method?.toLowerCase();
              const action = r.action.toLowerCase();
              if (callMethod !== needle && action !== needle && action !== `auto.${needle}`) return false;
            }
            if (args.subject_type !== undefined) {
              if (r.subject?.type !== args.subject_type) return false;
            }
            if (args.subject_id !== undefined) {
              if (r.subject?.id !== args.subject_id) return false;
            }
            if (args.operation_id !== undefined) {
              if (r.call?.operation_id?.toLowerCase() !== args.operation_id.toLowerCase()) return false;
            }
            return true;
          });
          return listOperationHistoryResult.parse({
            as_of: asOf,
            from_day: fromDay,
            to_day: toDay,
            bad_count: page.bad,
            older_before_range: page.older,
            records: filtered.map(r => ({
              id: r.id,
              at: r.at,
              day: r.day,
              action: r.action,
              title: r.label,
              summary: r.subject ? `${r.label}：${r.subject.text}` : r.label,
              source: r.source as unknown as JsonValue,
              operation_id: r.call?.operation_id ?? null,
              method: r.call?.method ?? null,
              subject: r.subject
                ? {
                    type: r.subject.type,
                    id: r.subject.id,
                    text: r.subject.text,
                    meta: r.subject.meta,
                  }
                : null,
              changes: r.changes as unknown as JsonValue,
              effects: r.effects as unknown as JsonValue,
              warnings: [],
            })),
          });
        }, signal);
      }
    }
  } catch (error) {
    throw enrichError(ctx, error);
  }
}
