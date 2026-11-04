import {
  addTimeEntryData,
  addTimeEntryResult,
  applicationRequest,
  captureTodoResult,
  contextResult,
  findItemsResult,
  ideaResult,
  listTimeEntriesResult,
  lookupResult,
  saveIdeaResult,
  timeSummaryResult,
  timerContextSchema,
  timerMutationData,
  timerMutationResult,
  todoResult,
} from '../shared/application';
import type { z } from 'zod';
import { captureTodoInTx, saveRecordInTx } from '../services/recordService';
import {
  addTimeEntryCheckedInTx,
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
import type { Ctx } from '../services/commit';
import { assertQueueHealthy, readOperation, runOperation } from '../services/commit';
import { clipEntriesInRange, summarizeDay } from '../domain/timeline/stats';
import { cardTiming } from '../domain/card/edit';
import { inBackpack } from '../domain/task/task';
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
    allowed = ['add_time_entry'];
  } else if (open.kind === '插入') {
    mode = 'away';
    allowed = ['return_from_break', 'start_break', 'add_time_entry'];
  } else if (state.pending_id !== null) {
    mode = 'pending';
    allowed = ['add_time_entry'];
  } else if (open.kind === '暂停') {
    mode = 'paused';
    allowed = [
      ...(resumeEntry ? ['resume_timer'] : []),
      'stop_timer',
      'start_timer',
      'start_task_item',
      'start_break',
      'add_time_entry',
    ];
  } else if (open.project === '待机') {
    mode = 'idle';
    allowed = ['start_timer', 'start_task_item', 'start_break', 'add_time_entry'];
  } else {
    mode = 'running';
    allowed = ['pause_timer', 'stop_timer', 'start_timer', 'start_task_item', 'start_break', 'add_time_entry'];
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
    allowed_actions: allowed,
  });
}

function describeNotice(notice: Notice): string {
  switch (notice.kind) {
    case 'offlineAsk': {
      const d = notice.data as Notice<'offlineAsk'>['data'];
      return `存在离线区间待确认（${d.from} 至 ${d.to}）`;
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
  };
}

function nextStepForCode(code: string): string {
  switch (code) {
    case 'STATE_CHANGED':
      return '计时状态已变化；请直接复制错误中附带的 latest_context.expected_state 与 latest_context.operation_id 重新判断是否执行，或向用户确认';
    case 'PENDING_CONFIRMATION':
      return '单轨界面存在待确认起点；请提示用户在单轨界面完成确认或放弃后再调用计时工具';
    case 'IN_AWAY_ACTIVITY':
      return '当前处于临时离开活动中；请先调用 return_from_break 结束临时活动，再执行普通计时控制';
    case 'IN_DEGRADE_REST':
      return '当前处于降级休息状态；请提示用户在单轨界面完成休息返回后再开始计时';
    case 'NO_RESUME_TARGET':
      return '当前没有可恢复的暂停活动；请改用 start_timer 或 start_task_item 开始新计时';
    case 'NOT_IN_BREAK':
      return '当前不在临时离开活动中；若要恢复已暂停活动请改用 resume_timer';
    case 'UNKNOWN_PROJECT':
    case 'RESERVED_PROJECT':
      return '请从 latest_context.options.projects 中选择合法项目名称（或省略以使用「未分类」）';
    case 'OPERATION_CONFLICT':
      return '该 operation_id 已绑定到另一条不同请求；新操作请使用 latest_context.operation_id';
    default:
      return '请根据错误码与说明修正参数，或检查单轨当前状态后重试';
  }
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
        : 'EXECUTION_FAILED');
  const category = queueFault?.category ?? applicationFailure(new Error(`${code}：${rawMessage}`)).category;
  let latestContext: JsonValue | undefined;
  const snap = ctx.snapshot();
  if (!queueFault && snap) {
    const view = readCommittedView(ctx);
    const timer = buildTimerContext(view.state, view.entries, view.cards, view.tasks);
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
  try {
    if (signal?.aborted) throw new Error('CANCELLED：请求在执行前已取消');

    switch (request.method) {
      case 'get_context': {
        const view = readCommittedView(ctx);
        const asOf = ctx.now();
        const timer = buildTimerContext(view.state, view.entries, view.cards, view.tasks);
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
              break_presets: view.settings.lists.presets
                .filter(p => p.mode === '插入')
                .map(p => ({ id: p.id, name: p.name, project: p.project, tags: [...p.tags] })),
            },
          } : {}),
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
                pool: r.pool!, created_at: r.created_at, exact_match: m.exact,
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
        }, undefined, signal, { action: 'auto.save_idea' });
        return saveIdeaResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'capture_todo': {
        const args = request.arguments;
        const normalized = {
          text: args.text,
          task_id: args.task_id?.trim() || null,
          due_at: args.due_at ?? null,
          blocking: args.blocking ?? false,
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
        }, undefined, signal, { action: 'auto.capture_todo' });
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
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.start_timer' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'start_task_item': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state, card_id: args.card_id };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = await startTaskItemCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.noop ? 'already_running' : null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.start_task_item' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'pause_timer': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = pauseTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.reason,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.pause_timer' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'resume_timer': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = await resumeTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.reason,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.resume_timer' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'stop_timer': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = stopTimerCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: outcome.reason,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.stop_timer' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'start_break': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state, activity: args.activity };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = startBreakCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.start_break' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
      }

      case 'return_from_break': {
        const args = request.arguments;
        const normalized = { expected_state: args.expected_state };
        const result = await runOperation(ctx, { id: args.operation_id, command: request.method, input: normalized }, async tx => {
          const outcome = await returnFromBreakCheckedInTx(tx, normalized);
          const timer = buildTimerContext(tx.state, tx.entries, tx.cards, tx.tasks);
          return timerMutationData.parse({
            noop: outcome.noop,
            reason: null,
            effective_at: tx.at,
            expected_state: timer.expected_state,
            timer,
          });
        }, undefined, signal, { action: 'auto.return_from_break' });
        return timerMutationResult.parse({ ...result, next_operation_id: ctx.id() });
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
        }, undefined, signal, { action: 'auto.add_time_entry' });
        return addTimeEntryResult.parse({ ...result, next_operation_id: ctx.id() });
      }
    }
  } catch (error) {
    throw enrichError(ctx, error);
  }
}
