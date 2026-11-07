import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer as createPipeServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  addTimeEntryResult,
  applicationContracts,
  applicationRequest,
  captureTodoResult,
  completeIdeaResult,
  completeTaskItemResult,
  completeTaskResult,
  contextResult,
  drawTaskItemResult,
  endOriginalTaskResult,
  findItemsResult,
  getRecapResult,
  getTaskDetailsResult,
  getTaskPlanResult,
  keepGoingTaskItemResult,
  listOperationHistoryResult,
  listTimeEntriesResult,
  lookupResult,
  planMutationResult,
  reopenIdeaResult,
  reopenTaskItemResult,
  reopenTaskResult,
  saveIdeaResult,
  splitTaskItemResult,
  timeSummaryResult,
  timerMutationResult,
  updateTimeEntryResult,
  type ApplicationMethod,
  type ApplicationRequest,
} from '../src/shared/application.ts';
import { ApplicationError, applicationErrorSchema } from '../src/shared/appError.ts';
import { createApplicationClient } from '../client/applicationClient.ts';
import { runCli } from './main.ts';
import { AGENT_RULES } from '../src/shared/agentRules.ts';
import { detectAgent } from './agentDetect.ts';
import pkg from '../package.json' with { type: 'json' };

const bundledCli = fileURLToPath(new URL('../dist-cli/monorail-cli.mjs', import.meta.url));
const bundledMcp = fileURLToPath(new URL('../dist-mcp/monorail-mcp.mjs', import.meta.url));

interface FakeReceipt {
  command: ApplicationMethod;
  request: { method: ApplicationMethod; arguments: Record<string, unknown> };
  data: unknown;
  committed_at: string;
}

/**
 * Stateful application peer fixture supporting all 16 application methods,
 * canonical receipt idempotency & conflict checks, expected_state transitions,
 * and cross-entrypoint testing over either in-memory transport or a Windows Named Pipe.
 */
function createStatefulPeer() {
  let stateSeq = 1;
  let expectedState = `ts1:state-${stateSeq}`;
  let mode: 'idle' | 'running' | 'paused' | 'away' = 'idle';
  let openEntry = {
    id: 'e-idle',
    description: '',
    project: '待机',
    tags: [] as string[],
    started_at: '2026-11-03T08:00:00+08:00',
    ended_at: null as string | null,
    card_id: null as string | null,
    kind: '普通' as '普通' | '插入' | '暂停',
    source: '自动' as '计时' | '手动' | '日历' | '自动' | '离线追问',
  };
  let pausedTarget: typeof openEntry | null = null;

  const receipts = new Map<string, FakeReceipt>();
  const ideas: Array<{
    id: string;
    text: string;
    tags: string[];
    needs: string | null;
    pool: '活跃池' | '冷库' | '已转任务' | '已完成';
    created_at: string;
  }> = [];
  const cards: Array<{
    id: string;
    content: string;
    status: '待做' | '进行中' | '已完成' | '已缩小' | '已放弃';
    type: '结果卡' | '时间盒卡';
    task_id: string | null;
    task_name: string;
    slot: '主线' | '支线' | '游离';
    project: string;
    tags: string[];
    due_at: string | null;
    blocking: boolean;
  }> = [
    {
      id: 'card-1',
      content: '复习编译原理语法分析',
      status: '待做',
      type: '结果卡',
      task_id: 'task-main',
      task_name: '编译原理主线',
      slot: '主线',
      project: '学习',
      tags: ['408'],
      due_at: null,
      blocking: false,
    },
  ];
  const entries: Array<typeof openEntry & { ended_at: string }> = [];
  const calls: ApplicationRequest[] = [];
  let nextWarnings: Array<{ phase: 'settings' | 'projection' | 'reminders' | 'logging'; message: string }> = [];

  function advanceState() {
    stateSeq++;
    expectedState = `ts1:state-${stateSeq}`;
    return expectedState;
  }

  function timerSnapshot() {
    const currentCard = openEntry.card_id ? cards.find(c => c.id === openEntry.card_id) ?? null : null;
    return {
      mode,
      expected_state: expectedState,
      open_entry: openEntry,
      paused_target: pausedTarget,
      pending: null,
      current_card: currentCard
        ? {
            id: currentCard.id,
            content: currentCard.content,
            status: (currentCard.status === '进行中' ? '进行中' : '待做') as '待做' | '进行中',
            task_id: currentCard.task_id,
            task_name: currentCard.task_name,
            project: currentCard.project,
            tags: currentCard.tags,
            goal_minutes: null,
          }
        : null,
      rest: null,
      allowed_actions:
        mode === 'idle'
          ? ['start_timer', 'start_task_item', 'start_break']
          : mode === 'running'
            ? ['start_timer', 'start_task_item', 'pause_timer', 'stop_timer', 'start_break']
            : mode === 'paused'
              ? ['start_timer', 'start_task_item', 'resume_timer', 'stop_timer', 'start_break']
              : ['return_from_break'],
    };
  }

  function canonicalJson(obj: Record<string, unknown>): string {
    const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
    const sorted: Record<string, unknown> = {};
    for (const k of keys) sorted[k] = obj[k];
    return JSON.stringify(sorted);
  }

  function runWrite<T>(
    operationIdRaw: string,
    command: ApplicationMethod,
    normalizedArgsWithoutOpId: Record<string, unknown>,
    exec: () => T,
  ) {
    const opId = operationIdRaw.toLowerCase();
    const existing = receipts.get(opId);
    if (existing) {
      if (
        existing.command !== command ||
        canonicalJson(existing.request.arguments) !== canonicalJson(normalizedArgsWithoutOpId)
      ) {
        throw new ApplicationError({
          status: 'error',
          code: 'OPERATION_CONFLICT',
          category: 'not_executed',
          message: `OPERATION_CONFLICT：operation_id ${opId} 已用于不同的请求参数或命令`,
          next_step: '请调用 get_context 获取新的 operation_id，不要复用旧 ID 提交新内容',
        });
      }
      return {
        status: 'committed' as const,
        operation_id: opId,
        data: existing.data as T,
        committed_at: existing.committed_at,
        replayed: true,
        warnings: [],
        next_operation_id: randomUUID(),
      };
    }

    const data = exec();
    const now = '2026-11-03T10:00:00+08:00';
    receipts.set(opId, {
      command,
      request: { method: command, arguments: normalizedArgsWithoutOpId },
      data,
      committed_at: now,
    });
    const warnings = nextWarnings;
    nextWarnings = [];
    return {
      status: 'committed' as const,
      operation_id: opId,
      data,
      committed_at: now,
      replayed: false,
      warnings,
      next_operation_id: randomUUID(),
    };
  }

  function assertExpectedState(given: string) {
    if (given !== expectedState) {
      throw new ApplicationError({
        status: 'error',
        code: 'STATE_CHANGED',
        category: 'not_executed',
        message: 'STATE_CHANGED：单轨当前计时状态已变化，请先根据最新状态确认后再执行',
        next_step: '读取 latest_context 中的 expected_state 与 timer，确认仍需执行后再用新 operation_id 调用',
        latest_context: {
          operation_id: randomUUID(),
          expected_state: expectedState,
          timer: timerSnapshot(),
          allowed_actions: timerSnapshot().allowed_actions,
        },
      });
    }
  }

  async function handle(rawRequest: unknown): Promise<unknown> {
    const req = applicationRequest.parse(rawRequest);
    calls.push(req);
    const now = '2026-11-03T10:00:00+08:00';

    switch (req.method) {
      case 'get_context': {
        const want = new Set(req.arguments.sections ?? ['timer', 'pending_actions', 'options']);
        return {
          status: 'ready',
          operation_id: randomUUID(),
          expected_state: expectedState,
          as_of: now,
          ...(want.has('timer') ? { timer: timerSnapshot() } : {}),
          ...(want.has('pending_actions') ? { pending_actions: [] } : {}),
          ...(want.has('options')
            ? {
                options: {
                  projects: ['未分类', '学习', '工作'],
                  known_tags: ['408', '产品'],
                  break_presets: [{ id: 'bp-water', name: '喝水', project: '生活', tags: [] }],
                },
              }
            : {}),
        };
      }

      case 'get_operation_result': {
        const opId = req.arguments.operation_id.toLowerCase();
        const r = receipts.get(opId);
        if (!r) return { status: 'not_found', operation_id: opId };
        return {
          status: 'committed',
          operation_id: opId,
          command: r.command,
          request: r.request,
          data: r.data,
          committed_at: r.committed_at,
        };
      }

      case 'save_idea': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'save_idea', rest, () => {
          const item = {
            id: randomUUID(),
            text: req.arguments.text,
            created_at: now,
            tags: ['测试'],
            pool: '活跃池' as const,
          };
          ideas.push({ ...item, needs: req.arguments.needs ?? null });
          return item;
        });
      }

      case 'complete_idea': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'complete_idea', rest, () => {
          const idea = ideas.find(i => i.id === req.arguments.idea_id);
          if (!idea) {
            throw new ApplicationError({ status: 'error', code: 'IDEA_NOT_FOUND', category: 'not_executed',
              message: 'IDEA_NOT_FOUND：找不到这个想法', next_step: '先用 find_items 查到准确 ID' });
          }
          const noop = idea.pool === '已完成';
          idea.pool = '已完成';
          return { id: idea.id, text: idea.text, status: '已完成' as const, completed_at: now, noop };
        });
      }

      case 'capture_todo': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'capture_todo', rest, () => {
          const cardId = `card-${cards.length + 1}`;
          const taskId = req.arguments.task_id ?? `task-${cards.length + 1}`;
          const slot = req.arguments.task_id === 'task-main' ? ('主线' as const) : ('支线' as const);
          const taskName = slot === '主线' ? '编译原理主线' : req.arguments.text;
          cards.push({
            id: cardId,
            content: req.arguments.text,
            status: '待做',
            type: '结果卡',
            task_id: taskId,
            task_name: taskName,
            slot,
            project: '学习',
            tags: [],
            due_at: req.arguments.due_at ?? null,
            blocking: req.arguments.blocking ?? false,
          });
          return {
            record_id: randomUUID(),
            card_id: cardId,
            task_id: taskId,
            task_name: taskName,
            slot,
            content: req.arguments.text,
            tags: [],
            due_at: req.arguments.due_at ?? null,
            blocking: req.arguments.blocking ?? false,
            created_at: now,
          };
        });
      }

      case 'find_items': {
        const q = (req.arguments.query ?? '').trim();
        const kind = req.arguments.kind ?? 'all';
        const matchedIdeas =
          kind === 'idea' || kind === 'all'
            ? ideas
                .filter(i => !q || i.text.includes(q))
                .map(i => ({ ...i, exact_match: i.text === q }))
            : [];
        const matchedCards =
          kind === 'todo_card' || kind === 'all'
            ? cards
                .filter(c => !q || c.content.includes(q))
                .map(c => ({ ...c, exact_match: c.content === q }))
            : [];
        const matchedTasks =
          kind === 'task' || kind === 'all'
            ? [
                {
                  id: 'task-main',
                  name: '编译原理主线',
                  slot: '主线' as const,
                  status: '进行中' as const,
                  default_project: '学习',
                  open_card_count: cards.filter(c => c.task_id === 'task-main' && c.status !== '已完成').length,
                  exact_match: q === '编译原理主线',
                },
              ].filter(t => !q || t.name.includes(q))
            : [];
        const total = matchedIdeas.length + matchedCards.length + matchedTasks.length;
        return {
          as_of: now,
          query: q,
          ambiguous: Boolean(q) && total > 1,
          ideas: matchedIdeas,
          todo_cards: matchedCards,
          tasks: matchedTasks,
        };
      }

      case 'get_time_summary': {
        return {
          resolved_day: '2026-11-03',
          day_mode: req.arguments.day_mode ?? 'activity',
          day_boundary_hour: 4,
          timezone: 'Asia/Shanghai',
          start: '2026-11-03T04:00:00+08:00',
          end: '2026-11-04T04:00:00+08:00',
          effective_end: now,
          as_of: now,
          interval_elapsed_ms: 3600000,
          non_idle_recorded_ms: 1800000,
          non_idle_covered_ms: 1800000,
          overlap_excess_ms: 0,
          idle_ms: 1800000,
          idle_plain_ms: 1800000,
          paused_ms: 0,
          untracked_ms: 0,
          by_project: { 学习: 1800000 },
          by_tag: { '408': 1800000 },
          entry_count: entries.length + 1,
        };
      }

      case 'list_time_entries': {
        return {
          from: req.arguments.from,
          to: req.arguments.to,
          effective_to: req.arguments.to,
          as_of: now,
          timezone: 'Asia/Shanghai',
          entries: entries.map(e => ({
            ...e,
            is_open: false,
            clipped_start: e.started_at,
            clipped_end: e.ended_at,
            clipped_ms: 600000,
          })),
        };
      }

      case 'add_time_entry': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'add_time_entry', rest, () => {
          const entry = {
            id: `entry-${entries.length + 1}`,
            description: req.arguments.description,
            project: req.arguments.project ?? '未分类',
            tags: req.arguments.tags ?? [],
            started_at: req.arguments.start,
            ended_at: req.arguments.end,
            card_id: null,
            kind: '普通' as const,
            source: '手动' as const,
          };
          entries.push(entry);
          return {
            entry,
            overlaps: [],
            expected_state: expectedState,
          };
        });
      }

      case 'update_time_entry': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'update_time_entry', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          const index = entries.findIndex(e => e.id === req.arguments.entry_id);
          if (index < 0) throw new Error('ENTRY_NOT_FOUND：找不到这条计时记录');
          const old = entries[index];
          const entry = {
            ...old,
            ...(req.arguments.start !== undefined ? { started_at: req.arguments.start } : {}),
            ...(req.arguments.end !== undefined ? { ended_at: req.arguments.end } : {}),
            ...(req.arguments.description !== undefined ? { description: req.arguments.description } : {}),
            ...(req.arguments.project !== undefined ? { project: req.arguments.project } : {}),
            ...(req.arguments.tags !== undefined ? { tags: req.arguments.tags } : {}),
          };
          entries[index] = entry;
          return { entry, overlaps: [], expected_state: expectedState };
        });
      }

      case 'start_timer': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'start_timer', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          mode = 'running';
          pausedTarget = null;
          openEntry = {
            id: `entry-run-${stateSeq}`,
            description: req.arguments.description,
            project: req.arguments.project ?? '未分类',
            tags: req.arguments.tags ?? [],
            started_at: now,
            ended_at: null,
            card_id: null,
            kind: '普通',
            source: '计时',
          };
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'start_task_item': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'start_task_item', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          const targetCard = cards.find(c => c.id === req.arguments.card_id);
          if (!targetCard) {
            throw new ApplicationError({
              status: 'error',
              code: 'CARD_NOT_FOUND',
              category: 'not_executed',
              message: `CARD_NOT_FOUND：未找到待办卡片 ${req.arguments.card_id}`,
              next_step: '请先调用 find_items 获取准确的 card_id',
            });
          }
          targetCard.status = '进行中';
          mode = 'running';
          pausedTarget = null;
          openEntry = {
            id: `entry-card-${stateSeq}`,
            description: targetCard.content,
            project: targetCard.project,
            tags: targetCard.tags,
            started_at: now,
            ended_at: null,
            card_id: targetCard.id,
            kind: '普通',
            source: '计时',
          };
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'pause_timer': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'pause_timer', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          if (mode === 'away') {
            throw new ApplicationError({
              status: 'error',
              code: 'IN_AWAY_ACTIVITY',
              category: 'not_executed',
              message: 'IN_AWAY_ACTIVITY：当前处于临时离开活动，请先调用 return_from_break',
              next_step: '先执行 monorail break return 再暂停',
            });
          }
          pausedTarget = { ...openEntry, ended_at: now };
          mode = 'paused';
          openEntry = {
            id: `entry-pause-${stateSeq}`,
            description: '',
            project: '待机',
            tags: [],
            started_at: now,
            ended_at: null,
            card_id: null,
            kind: '暂停',
            source: '自动',
          };
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'resume_timer': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'resume_timer', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          if (!pausedTarget) {
            throw new ApplicationError({
              status: 'error',
              code: 'NO_RESUME_TARGET',
              category: 'not_executed',
              message: 'NO_RESUME_TARGET：当前没有可恢复的已暂停活动',
              next_step: '请使用 start_timer 或 start_task_item 开始新计时',
            });
          }
          mode = 'running';
          openEntry = { ...pausedTarget, id: `entry-resume-${stateSeq}`, ended_at: null };
          pausedTarget = null;
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'stop_timer': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'stop_timer', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          for (const c of cards) {
            if (c.status === '进行中') c.status = '待做';
          }
          mode = 'idle';
          pausedTarget = null;
          openEntry = {
            id: `entry-idle-${stateSeq}`,
            description: '',
            project: '待机',
            tags: [],
            started_at: now,
            ended_at: null,
            card_id: null,
            kind: '普通',
            source: '自动',
          };
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'start_break': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'start_break', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          if (mode === 'running') {
            pausedTarget = { ...openEntry, ended_at: now };
          }
          mode = 'away';
          openEntry = {
            id: `entry-break-${stateSeq}`,
            description: req.arguments.activity,
            project: '生活',
            tags: [],
            started_at: now,
            ended_at: null,
            card_id: null,
            kind: '插入',
            source: '计时',
          };
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'return_from_break': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'return_from_break', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          if (mode !== 'away') {
            throw new ApplicationError({
              status: 'error',
              code: 'NOT_IN_BREAK',
              category: 'not_executed',
              message: 'NOT_IN_BREAK：当前不在临时离开活动中',
              next_step: '若要恢复已暂停计时请调用 timer resume',
            });
          }
          if (pausedTarget) {
            mode = 'running';
            openEntry = { ...pausedTarget, id: `entry-ret-${stateSeq}`, ended_at: null };
            pausedTarget = null;
          } else {
            mode = 'idle';
            openEntry = {
              id: `entry-idle-${stateSeq}`,
              description: '',
              project: '待机',
              tags: [],
              started_at: now,
              ended_at: null,
              card_id: null,
              kind: '普通',
              source: '自动',
            };
          }
          const nextState = advanceState();
          return {
            noop: false,
            reason: null,
            effective_at: now,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'end_original_task': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'end_original_task', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          const endedId = pausedTarget?.id ?? 'entry-orig';
          const endedCardId = pausedTarget?.card_id ?? null;
          pausedTarget = null;
          mode = 'running';
          openEntry = { ...openEntry, kind: '普通', card_id: null };
          const nextState = advanceState();
          return {
            ended_entry_id: endedId,
            ended_card_id: endedCardId,
            promoted_entry_id: openEntry.id,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'reopen_idea': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'reopen_idea', rest, () => {
          const idea = ideas.find(i => i.id === req.arguments.idea_id);
          if (!idea) {
            throw new ApplicationError({
              status: 'error',
              code: 'IDEA_NOT_FOUND',
              category: 'not_executed',
              message: 'IDEA_NOT_FOUND：找不到这个想法',
              next_step: '先用 find_items 查到准确 ID',
            });
          }
          const noop = idea.pool === '活跃池';
          idea.pool = '活跃池';
          return { id: idea.id, text: idea.text, pool: '活跃池' as const, noop };
        });
      }

      case 'get_task_plan': {
        const which = req.arguments.day ?? 'today';
        const resolvedDay = which === 'today' ? '2026-11-03' : '2026-11-04';
        return {
          as_of: now,
          which,
          resolved_day: resolvedDay,
          day_boundary_hour: 4,
          enabled: true,
          plan: {
            day: resolvedDay,
            skip_until_planned: false,
            carry_pending: false,
            items: [
              {
                card_id: 'card-1',
                title: '复习编译原理语法分析',
                track: '主线' as const,
                priority: '高' as const,
                today_minutes: null,
                minutes_today: 0,
                achieved: false,
                running: false,
                carried: false,
                due_today: false,
              },
            ],
            seen_card_ids: [],
            drawable_card_ids: ['card-1'],
          },
        };
      }

      case 'add_plan_item':
      case 'remove_plan_item':
      case 'update_plan_item':
      case 'confirm_plan_carry':
      case 'skip_today_plan':
      case 'skip_task_item': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, req.method, rest, () => ({
          noop: false,
          which: 'today' as const,
          day: req.arguments.day,
          plan: {
            day: req.arguments.day,
            skip_until_planned: req.method === 'skip_today_plan',
            carry_pending: false,
            items: [],
            seen_card_ids: req.method === 'skip_task_item' ? [req.arguments.card_id] : [],
            drawable_card_ids: ['card-1'],
          },
        }));
      }

      case 'draw_task_item': {
        return {
          as_of: now,
          day: '2026-11-03',
          outcome: 'card' as const,
          card: {
            id: 'card-1',
            content: '复习编译原理语法分析',
            task_id: 'task-main',
            task_name: '编译原理主线',
            track: '主线' as const,
            type: '结果卡' as const,
            priority: '高' as const,
            today_minutes: null,
            goal_minutes: null,
          },
          candidates: [
            {
              card_id: 'card-1',
              title: '复习编译原理语法分析',
              track: '主线' as const,
              priority: '高' as const,
              weight: 3,
            },
          ],
          reset_round: false,
          blocked_reason: null,
          guide: null,
        };
      }

      case 'complete_task_item': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'complete_task_item', rest, () => {
          const card = cards.find(c => c.id === req.arguments.card_id) ?? cards[0];
          const touches = openEntry.card_id === card.id;
          if (touches && req.arguments.expected_state !== undefined) {
            assertExpectedState(req.arguments.expected_state);
          }
          card.status = '已完成';
          return {
            noop: false,
            stopped_timer: touches,
            card: {
              id: card.id,
              content: card.content,
              status: '已完成' as const,
              completed_at: now,
              completed_day: '2026-11-03',
              completed_track: '主线' as const,
              progress_note: req.arguments.note ?? '',
            },
            task: {
              id: 'task-main',
              name: '编译原理主线',
              slot: '主线' as const,
              status: '进行中' as const,
              open_card_count: 0,
            },
            expected_state: expectedState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'reopen_task_item': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'reopen_task_item', rest, () => {
          const card = cards.find(c => c.id === req.arguments.card_id) ?? cards[0];
          card.status = '待做';
          return {
            noop: false,
            reopened_parent_task: Boolean(req.arguments.make_room),
            card: {
              id: card.id,
              content: card.content,
              status: '待做' as const,
              progress_note: '',
            },
            task: {
              id: 'task-main',
              name: '编译原理主线',
              slot: '主线' as const,
              status: '进行中' as const,
              slot_index: 1,
              open_card_count: 1,
            },
            expected_state: expectedState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'keep_going_task_item': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'keep_going_task_item', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          const card = cards.find(c => c.id === req.arguments.card_id) ?? cards[0];
          card.status = '待做';
          const nextState = advanceState();
          return {
            card: {
              id: card.id,
              content: card.content,
              status: '待做' as const,
              progress_note: req.arguments.note ?? '',
            },
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'split_task_item': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'split_task_item', rest, () => {
          assertExpectedState(req.arguments.expected_state);
          const nextState = advanceState();
          return {
            today_card_id: 'card-split-today',
            rest_card_id: 'card-split-rest',
            today_content: req.arguments.today_content,
            rest_content: req.arguments.rest_content,
            today_minutes: 25,
            rest_minutes: req.arguments.rest_minutes ?? null,
            expected_state: nextState,
            timer: timerSnapshot(),
          };
        });
      }

      case 'get_task_details': {
        return {
          as_of: now,
          task: {
            id: req.arguments.task_id,
            name: '编译原理主线',
            slot: '主线' as const,
            slot_index: 1,
            status: '进行中' as const,
            created_at: now,
            completed_at: null,
            bet_ends_at: null,
            default_project: '学习',
            completion_id: null,
            reopen_mode: null,
            reopen_conflict_reason: null,
            reopen_card_ids: [],
            slot_full: false,
            make_room_candidates: [],
          },
          items: cards.map(c => ({
            id: c.id,
            content: c.content,
            status: c.status,
            type: c.type,
            timebox_minutes: null,
            project: c.project,
            tags: c.tags,
            due_at: c.due_at,
            progress_note: '',
            completed_at: null,
            in_completion_batch: false,
          })),
        };
      }

      case 'complete_task': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'complete_task', rest, () => ({
          noop: false,
          stopped_timer: false,
          completion_id: '11111111-1111-4111-8111-111111111111',
          affected_card_ids: ['card-1'],
          freed_slot: { slot: '主线' as const, slot_index: 1 },
          task: {
            id: req.arguments.task_id,
            name: '编译原理主线',
            slot: '主线' as const,
            status: '已完成' as const,
            completed_at: now,
            bet_ends_at: null,
          },
          expected_state: expectedState,
          timer: timerSnapshot(),
        }));
      }

      case 'reopen_task': {
        const { operation_id, ...rest } = req.arguments;
        return runWrite(operation_id, 'reopen_task', rest, () => ({
          noop: false,
          reopen_mode: req.arguments.completion_id ? ('snapshot_batch' as const) : ('task_only' as const),
          reopened_card_ids: req.arguments.completion_id ? ['card-1'] : [],
          task: {
            id: req.arguments.task_id,
            name: '编译原理主线',
            slot: '主线' as const,
            slot_index: 1,
            status: '进行中' as const,
            bet_ends_at: null,
            open_card_count: 1,
          },
          expected_state: expectedState,
          timer: timerSnapshot(),
        }));
      }

      case 'get_recap': {
        const period = req.arguments.period ?? 'week';
        return {
          computed_at: now,
          tracking_mode: 'strict' as const,
          range: {
            period,
            from_day: req.arguments.from ?? '2026-11-02',
            to_day: req.arguments.to ?? '2026-11-08',
            days: 7,
            from: '2026-11-02T04:00:00+08:00',
            to: '2026-11-09T04:00:00+08:00',
            effective_to: now,
            after: null,
          },
          today: '2026-11-03',
          earliest_day: '2026-11-01',
          last_review_at: null,
          effective_ms: 1800000,
          active_days: 1,
          entry_count: 1,
          mainline: { permille: 1000, by_source: { 主线任务: 1800000 } },
          previous: {
            label: '上周',
            from_day: '2026-10-26',
            to_day: '2026-11-01',
            comparable: true,
            effective_ms: 0,
            main_permille: 0,
            done: 0,
            notes: 0,
          },
          unit: 'day' as const,
          buckets: [
            {
              id: '2026-11-03',
              label: '二',
              sub: '11/03',
              title: '2026-11-03',
              weekend: false,
              days: ['2026-11-03'],
              total_ms: 1800000,
              by_key: { 学习: 1800000 },
            },
          ],
          total_ms: 1800000,
          series: [{ key: '学习', ms: 1800000, permille: 1000, color: '#3b82f6', merged: 0 }],
          groups: [
            {
              key: '学习',
              ms: 1800000,
              permille: 1000,
              count: 1,
              color: '#3b82f6',
              previous_ms: 0,
              rows: [],
            },
          ],
          gone_keys: [],
          done: [],
          notes: [],
        };
      }

      case 'list_operation_history': {
        return {
          as_of: now,
          from_day: req.arguments.from_day ?? '2026-10-28',
          to_day: req.arguments.to_day ?? '2026-11-03',
          bad_count: 0,
          older_before_range: false,
          records: [
            {
              id: 'hist-1',
              at: now,
              day: '2026-11-03',
              action: 'auto.save_idea',
              title: '保存想法',
              summary: '保存想法到活跃池',
              source: { kind: 'cli' },
              operation_id: null,
              method: 'save_idea',
              subject: null,
              changes: [],
              warnings: [],
            },
          ],
        };
      }
    }
  }

  return {
    handle,
    calls,
    advanceState,
    getExpectedState: () => expectedState,
    setNextWarnings: (w: typeof nextWarnings) => {
      nextWarnings = w;
    },
  };
}

async function createPipeServerForPeer(peer: ReturnType<typeof createStatefulPeer>) {
  const pipe = String.raw`\\.\pipe\monorail-cli-test-${randomUUID()}.mcp`;
  const server = createPipeServer(socket => {
    const lines = createInterface({ input: socket });
    lines.once('line', async line => {
      try {
        const req = JSON.parse(line);
        const result = await peer.handle(req);
        socket.end(JSON.stringify({ result }) + '\n');
      } catch (error) {
        if (error instanceof ApplicationError) {
          socket.end(JSON.stringify({ error: error.failure }) + '\n');
        } else {
          socket.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, resolve);
  });
  return {
    pipe,
    close: () => new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve()))),
  };
}

async function execCli(
  argv: string[],
  peer: ReturnType<typeof createStatefulPeer>,
  extra: { stdin?: string; files?: Record<string, string>; signal?: AbortSignal } = {},
) {
  let stdout = '';
  let stderr = '';
  const client = createApplicationClient({
    send: req => peer.handle(req),
  });
  const exitCode = await runCli(argv, {
    createClient: () => client,
    readStdin: extra.stdin !== undefined ? async () => extra.stdin! : undefined,
    readTextFile: extra.files
      ? p => {
          if (!(p in extra.files!)) throw new Error(`ENOENT: no such file ${p}`);
          return extra.files![p];
        }
      : undefined,
    signal: extra.signal,
    writeStdout: t => {
      stdout += t;
    },
    writeStderr: t => {
      stderr += t;
    },
  });
  return { exitCode, stdout, stderr };
}

test('CLI --help and --version (human and --json) succeed with exit 0 without touching the application client or starting background host', async () => {
  let clientCreated = false;
  const failCreateClient = () => {
    clientCreated = true;
    throw new Error('must not create application client for help/version/usage errors');
  };

  for (const args of [['--help'], ['-h'], ['help'], ['--version'], ['-v'], ['version']]) {
    let stdout = '';
    const code = await runCli(args, { createClient: failCreateClient, writeStdout: t => { stdout += t; } });
    assert.equal(code, 0);
    assert.ok(stdout.length > 0);
  }

  let helpJsonOut = '';
  const helpCode = await runCli(['--help', '--json'], {
    createClient: failCreateClient,
    writeStdout: t => { helpJsonOut += t; },
  });
  assert.equal(helpCode, 0);
  const parsedHelp = JSON.parse(helpJsonOut);
  assert.equal(parsedHelp.status, 'ok');
  assert.equal(parsedHelp.kind, 'help');
  assert.equal(parsedHelp.version, pkg.version);
  // 0.3.1 G8：给 agent 的规则在 --help 开头和 --help --json 的 rules 字段
  assert.equal(parsedHelp.rules, AGENT_RULES);
  let helpText = '';
  await runCli(['--help'], { createClient: failCreateClient, writeStdout: t => { helpText += t; } });
  assert.ok(helpText.split('\n').slice(0, 4).join('\n').includes(AGENT_RULES));

  let verJsonOut = '';
  const verCode = await runCli(['--version', '--json'], {
    createClient: failCreateClient,
    writeStdout: t => { verJsonOut += t; },
  });
  assert.equal(verCode, 0);
  const parsedVer = JSON.parse(verJsonOut);
  assert.deepEqual(parsedVer, {
    status: 'ok',
    kind: 'version',
    name: 'monorail',
    version: pkg.version,
  });
  assert.equal(clientCreated, false);
});

test('CLI usage validation rejects unknown commands, unknown/duplicate flags, conflicting text sources, missing timezone offsets and file errors with exit code 2 before calling backend', async () => {
  let clientCreated = false;
  const failCreateClient = () => {
    clientCreated = true;
    throw new Error('must not call backend on usage error');
  };

  const invalidCases: Array<{ argv: string[]; stdin?: string; files?: Record<string, string> }> = [
    { argv: ['unknown-cmd'] },
    { argv: ['idea', 'unknown-sub'] },
    { argv: ['idea', 'add'] }, // missing text
    { argv: ['idea', 'add', '   '] }, // blank text
    { argv: ['idea', 'add', 'pos-text', '--stdin'], stdin: 'stdin-text' }, // conflicting sources
    { argv: ['idea', 'add', 'pos-text', '--text-file', 'a.txt'], files: { 'a.txt': 'file-text' } }, // conflicting sources
    { argv: ['idea', 'add', '--stdin', '--text-file', 'a.txt'], stdin: 's', files: { 'a.txt': 'f' } }, // conflicting sources
    { argv: ['idea', 'add', '--text-file', 'missing.txt'], files: {} }, // file read failure
    { argv: ['idea', 'add', 'x', '--needs', 'a', '--needs', 'b'] }, // duplicate single flag
    { argv: ['idea', 'add', 'x', '--operation-id', 'not-a-uuid'] }, // invalid UUID
    { argv: ['todo', 'add', 'x', '--blocking=false'] }, // boolean flag with inline value
    { argv: ['todo', 'add', 'x', '--due-at', '2026-11-03 10:00:00'] }, // missing timezone offset
    { argv: ['time', 'entries', '--from', '2026-11-03T08:00:00Z'] }, // missing --to
    { argv: ['time', 'summary', '--day-mode', 'invalid'] },
    { argv: ['context', '--section', 'invalid'] },
    { argv: ['timer', 'start-item'] }, // missing card-id
    { argv: ['timer', 'pause', 'extra-arg'] },
    { argv: ['operation', 'get'] },
    { argv: ['plan', 'show', '--day', '2026-11-07'] }, // plan show only accepts today|tomorrow
    { argv: ['plan', 'add', 'card-1', '--day', 'today'] }, // plan write commands require YYYY-MM-DD
    { argv: ['plan', 'add', 'card-1', '--day', '2026-02-31'] }, // invalid calendar date
    { argv: ['plan', 'edit', 'card-1', '--day', '2026-11-07'] }, // must change at least one field
    { argv: ['plan', 'carry', '--day', '2026-11-07'] }, // must specify --keep or --keep-none
    { argv: ['plan', 'carry', '--day', '2026-11-07', '--keep', 'card-1', '--keep-none'] }, // mutually exclusive
    { argv: ['plan', 'carry', '--day', '2026-11-07', '--keep', 'card-1', '--keep', 'card-1'] }, // duplicate keep IDs
    { argv: ['item', 'split', 'card-1', '--today-content', 'a'] }, // missing --rest-content
    { argv: ['task', 'reopen', 'task-main'] }, // missing --completion-id or --legacy
    { argv: ['task', 'reopen', 'task-main', '--legacy', '--completion-id', '11111111-1111-4111-8111-111111111111'] },
    { argv: ['task', 'reopen', 'task-main', '--legacy', '--make-room', 'invalid-format'] },
    { argv: ['recap', 'show', '--period', 'custom', '--from', '2026-11-01'] }, // custom requires both --from and --to
    { argv: ['recap', 'show', '--period', 'week', '--from', '2026-11-01'] }, // non-custom forbids --from/--to
    { argv: ['history', 'list', '--from-day', '2026-11-08', '--to-day', '2026-11-07'] }, // from_day > to_day
    { argv: ['idea', 'reopen', 'not-a-uuid'] },
  ];

  for (const c of invalidCases) {
    let stdout = '';
    let stderr = '';
    const code = await runCli([...c.argv, '--json'], {
      createClient: failCreateClient,
      readStdin: c.stdin !== undefined ? async () => c.stdin! : undefined,
      readTextFile: c.files
        ? p => {
            if (!(p in c.files!)) throw new Error(`ENOENT: ${p}`);
            return c.files![p];
          }
        : undefined,
      writeStdout: t => { stdout += t; },
      writeStderr: t => { stderr += t; },
    });
    assert.equal(code, 2, `Expected exit code 2 for argv: ${JSON.stringify(c.argv)}`);
    assert.equal(stderr, '', '--json mode must not pollute stderr on usage error');
    const body = JSON.parse(stdout);
    assert.equal(body.status, 'error');
    const err = applicationErrorSchema.parse(body.error);
    assert.equal(err.code, 'USAGE_ERROR');
    assert.equal(err.category, 'not_executed');
  }

  // CliUsageError 默认下一步带规则（未知子命令用默认下一步）
  let subJson = '';
  assert.equal(await runCli(['idea', 'unknown-sub', '--json'], { createClient: failCreateClient, writeStdout: t => { subJson += t; } }), 2);
  assert.match(applicationErrorSchema.parse(JSON.parse(subJson).error).next_step, /不要直接改单轨数据目录里的文件/);
  // 报错里的子命令名不带 .trim() 字样（G8 审核 N1）
  assert.match(applicationErrorSchema.parse(JSON.parse(subJson).error).message, /未知子命令 "idea unknown-sub"；/);

  // 未知命令：人读与 --json 都说明 CLI 没有这个命令、要停下告诉用户（0.3.1 G8）
  let unknownErr = '';
  assert.equal(await runCli(['entry', 'delete', 'x'], { createClient: failCreateClient, writeStdout: () => {}, writeStderr: t => { unknownErr += t; } }), 2);
  assert.match(unknownErr, /不要直接改单轨数据目录里的文件/);
  let unknownJson = '';
  assert.equal(await runCli(['rewrite-timelog', '--json'], { createClient: failCreateClient, writeStdout: t => { unknownJson += t; } }), 2);
  const unknownBody = applicationErrorSchema.parse(JSON.parse(unknownJson).error);
  assert.match(unknownBody.next_step, /CLI 没有这个命令.*告诉用户做不到、缺什么/);

  assert.equal(clientCreated, false);
});

test('CLI reaches all 36 application methods and preserves multiline Chinese text and shell metacharacters (& | ` $()) across positional, --text-file, and --stdin', async () => {
  const peer = createStatefulPeer();

  // 1. context (get_context) - read-only, 1 call
  const ctxRes = await execCli(['context', '--section', 'timer', '--section', 'options', '--json'], peer);
  assert.equal(ctxRes.exitCode, 0);
  const ctxBody = JSON.parse(ctxRes.stdout);
  assert.equal(ctxBody.method, 'get_context');
  const ctx = contextResult.parse(ctxBody.result);
  assert.equal(ctx.timer?.mode, 'idle');
  assert.equal(peer.calls.length, 1);

  // 2. idea add (save_idea) via --text-file with multiline Chinese + shell metacharacters
  const specialIdea = '第一行：灵感收集 & 管道 | 重定向 > 符号\n第二行：`反引号` 与 $(whoami) "$HOME" #架构';
  const ideaRes = await execCli(
    ['idea', 'add', '--text-file', 'idea.txt', '--needs', '验证特殊字符原样保存', '--json'],
    peer,
    { files: { 'idea.txt': specialIdea } },
  );
  assert.equal(ideaRes.exitCode, 0);
  const savedIdea = saveIdeaResult.parse(JSON.parse(ideaRes.stdout).result);
  assert.equal(savedIdea.data.text, specialIdea);

  // 3. todo add (capture_todo) via --stdin + warning preservation
  peer.setNextWarnings([{ phase: 'projection', message: 'ui listener minor warning' }]);
  const todoText = '完成 0.3.0 CLI 验收测试 & 校验 `$()` #0.3.0';
  const todoRes = await execCli(
    ['todo', 'add', '--stdin', '--task-id', 'task-main', '--due-at', '2026-11-05T18:00:00+08:00', '--blocking', '--json'],
    peer,
    { stdin: `\n  ${todoText}  \n` },
  );
  assert.equal(todoRes.exitCode, 0);
  const capturedTodo = captureTodoResult.parse(JSON.parse(todoRes.stdout).result);
  assert.equal(capturedTodo.data.content, todoText);
  assert.equal(capturedTodo.data.slot, '主线');
  assert.deepEqual(capturedTodo.warnings, [{ phase: 'projection', message: 'ui listener minor warning' }]);

  // 4. find (find_items) - read-only (does not call get_context)
  const callsBeforeFind = peer.calls.length;
  const findRes = await execCli(['find', '编译原理', '--kind', 'all', '--include-archived', '--json'], peer);
  assert.equal(findRes.exitCode, 0);
  assert.equal(peer.calls.length, callsBeforeFind + 1);
  const found = findItemsResult.parse(JSON.parse(findRes.stdout).result);
  assert.equal(found.todo_cards.length, 1);
  assert.equal(found.tasks.length, 1);
  assert.equal(found.ambiguous, true);

  // 5. timer start (start_timer)
  const startRes = await execCli(
    ['timer', 'start', '推导 LR(1) 分析表', '--project', '学习', '--tag', '408', '--tag', '编译', '--json'],
    peer,
  );
  assert.equal(startRes.exitCode, 0);
  const started = timerMutationResult.parse(JSON.parse(startRes.stdout).result);
  assert.equal(started.data.timer.mode, 'running');
  assert.deepEqual(started.data.timer.open_entry.tags, ['408', '编译']);

  // 6. timer pause (pause_timer)
  const pauseRes = await execCli(['timer', 'pause', '--json'], peer);
  assert.equal(pauseRes.exitCode, 0);
  assert.equal(timerMutationResult.parse(JSON.parse(pauseRes.stdout).result).data.timer.mode, 'paused');

  // 7. timer resume (resume_timer)
  const resumeRes = await execCli(['timer', 'resume', '--json'], peer);
  assert.equal(resumeRes.exitCode, 0);
  assert.equal(timerMutationResult.parse(JSON.parse(resumeRes.stdout).result).data.timer.mode, 'running');

  // 8. timer start-item (start_task_item)
  const startItemRes = await execCli(['timer', 'start-item', capturedTodo.data.card_id, '--json'], peer);
  assert.equal(startItemRes.exitCode, 0);
  const startedItem = timerMutationResult.parse(JSON.parse(startItemRes.stdout).result);
  assert.equal(startedItem.data.timer.open_entry.card_id, capturedTodo.data.card_id);

  // 9. break start (start_break)
  const breakRes = await execCli(['break', 'start', '泡茶休息', '--json'], peer);
  assert.equal(breakRes.exitCode, 0);
  const onBreak = timerMutationResult.parse(JSON.parse(breakRes.stdout).result);
  assert.equal(onBreak.data.timer.mode, 'away');
  assert.equal(onBreak.data.timer.paused_target?.card_id, capturedTodo.data.card_id);

  // 10. break return (return_from_break)
  const returnRes = await execCli(['break', 'return', '--json'], peer);
  assert.equal(returnRes.exitCode, 0);
  const returned = timerMutationResult.parse(JSON.parse(returnRes.stdout).result);
  assert.equal(returned.data.timer.mode, 'running');
  assert.equal(returned.data.timer.open_entry.card_id, capturedTodo.data.card_id);

  // 11. timer stop (stop_timer)
  const stopRes = await execCli(['timer', 'stop', '--json'], peer);
  assert.equal(stopRes.exitCode, 0);
  assert.equal(timerMutationResult.parse(JSON.parse(stopRes.stdout).result).data.timer.mode, 'idle');

  // 12. time add (add_time_entry)
  const addTimeRes = await execCli(
    [
      'time', 'add', '整理学习笔记',
      '--start', '2026-11-03T08:00:00+08:00',
      '--end', '2026-11-03T08:45:00+08:00',
      '--project', '学习',
      '--tag', '笔记',
      '--json',
    ],
    peer,
  );
  assert.equal(addTimeRes.exitCode, 0);
  assert.equal(addTimeEntryResult.parse(JSON.parse(addTimeRes.stdout).result).data.entry.description, '整理学习笔记');

  // 12b. entry edit (update_time_entry, 0.3.1 G8)：改结束时间和标签；一项都不改在本地就被拒绝
  const addedId = addTimeEntryResult.parse(JSON.parse(addTimeRes.stdout).result).data.entry.id;
  const editRes = await execCli(['entry', 'edit', addedId, '--end', '2026-11-03T08:50:00+08:00', '--tag', '复习', '--json'], peer);
  assert.equal(editRes.exitCode, 0, editRes.stderr);
  const edited = updateTimeEntryResult.parse(JSON.parse(editRes.stdout).result).data.entry;
  assert.deepEqual([edited.id, edited.ended_at, edited.tags], [addedId, '2026-11-03T08:50:00+08:00', ['复习']]);
  const callsBeforeEmptyEdit = peer.calls.length;
  const emptyEdit = await execCli(['entry', 'edit', addedId], peer);
  assert.equal(emptyEdit.exitCode, 2);
  assert.match(emptyEdit.stderr, /至少要改一项/);
  assert.equal(peer.calls.length, callsBeforeEmptyEdit);

  // 13. time summary (get_time_summary)
  const summaryRes = await execCli(['time', 'summary', '--day', 'today', '--day-mode', 'activity', '--json'], peer);
  assert.equal(summaryRes.exitCode, 0);
  assert.equal(timeSummaryResult.parse(JSON.parse(summaryRes.stdout).result).resolved_day, '2026-11-03');

  // 14. time entries (list_time_entries)
  const entriesRes = await execCli(
    ['time', 'entries', '--from', '2026-11-03T08:00:00+08:00', '--to', '2026-11-03T10:00:00+08:00', '--json'],
    peer,
  );
  assert.equal(entriesRes.exitCode, 0);
  assert.equal(listTimeEntriesResult.parse(JSON.parse(entriesRes.stdout).result).entries.length, 1);

  // 16. idea done (complete_idea, 0.3.0-beta.4 D2)：第一次改动，第二次 noop；不是 UUID 的 ID 在本地就被拒绝
  const doneRes = await execCli(['idea', 'done', savedIdea.data.id, '--json'], peer);
  assert.equal(doneRes.exitCode, 0);
  const done = completeIdeaResult.parse(JSON.parse(doneRes.stdout).result);
  assert.deepEqual([done.data.status, done.data.noop], ['已完成', false]);
  const againRes = await execCli(['idea', 'done', savedIdea.data.id], peer);
  assert.equal(againRes.exitCode, 0);
  assert.match(againRes.stdout, /想法本来就已完成/);
  const callsBeforeBad = peer.calls.length;
  const badRes = await execCli(['idea', 'done', 'not-a-uuid'], peer);
  assert.equal(badRes.exitCode, 2);
  assert.equal(peer.calls.length, callsBeforeBad);

  // 15. operation get (get_operation_result)
  const opGetRes = await execCli(['operation', 'get', savedIdea.operation_id, '--json'], peer);
  assert.equal(opGetRes.exitCode, 0);
  const lookedUp = lookupResult.parse(JSON.parse(opGetRes.stdout).result);
  assert.equal(lookedUp.status, 'committed');
  if (lookedUp.status === 'committed') {
    assert.equal(lookedUp.command, 'save_idea');
    assert.deepEqual(lookedUp.request, {
      method: 'save_idea',
      arguments: { text: specialIdea, needs: '验证特殊字符原样保存' },
    });
  }

  // 17. idea reopen (reopen_idea)
  const reopenIdeaRes = await execCli(['idea', 'reopen', savedIdea.data.id, '--json'], peer);
  assert.equal(reopenIdeaRes.exitCode, 0);
  const reopenedIdea = reopenIdeaResult.parse(JSON.parse(reopenIdeaRes.stdout).result);
  assert.deepEqual([reopenedIdea.data.pool, reopenedIdea.data.noop], ['活跃池', false]);

  // 18. break end-original (end_original_task)
  await execCli(['timer', 'start-item', capturedTodo.data.card_id, '--json'], peer);
  await execCli(['break', 'start', '上厕所', '--json'], peer);
  const endOrigRes = await execCli(['break', 'end-original', '--json'], peer);
  assert.equal(endOrigRes.exitCode, 0);
  const endedOrig = endOriginalTaskResult.parse(JSON.parse(endOrigRes.stdout).result);
  assert.equal(endedOrig.data.ended_card_id, capturedTodo.data.card_id);
  await execCli(['timer', 'stop', '--json'], peer);

  // 19. item done / reopen / keep / split (complete_task_item / reopen_task_item / keep_going_task_item / split_task_item)
  const itemDoneRes = await execCli(['item', 'done', capturedTodo.data.card_id, '--note', '完成了第一步', '--json'], peer);
  assert.equal(itemDoneRes.exitCode, 0);
  assert.equal(completeTaskItemResult.parse(JSON.parse(itemDoneRes.stdout).result).data.card.status, '已完成');

  const itemReopenRes = await execCli(['item', 'reopen', capturedTodo.data.card_id, '--json'], peer);
  assert.equal(itemReopenRes.exitCode, 0);
  assert.equal(reopenTaskItemResult.parse(JSON.parse(itemReopenRes.stdout).result).data.card.status, '待做');

  await execCli(['timer', 'start-item', capturedTodo.data.card_id, '--json'], peer);
  const itemKeepRes = await execCli(
    ['item', 'keep', capturedTodo.data.card_id, '--note', '整理后续步骤', '--json'],
    peer,
  );
  assert.equal(itemKeepRes.exitCode, 0);
  const keptItem = keepGoingTaskItemResult.parse(JSON.parse(itemKeepRes.stdout).result);
  assert.equal(keptItem.data.card.status, '待做');

  await execCli(['timer', 'start-item', capturedTodo.data.card_id, '--json'], peer);
  const itemSplitRes = await execCli(
    ['item', 'split', capturedTodo.data.card_id, '--today-content', '第一步', '--rest-content', '第二步', '--json'],
    peer,
  );
  assert.equal(itemSplitRes.exitCode, 0);
  const splitRes = splitTaskItemResult.parse(JSON.parse(itemSplitRes.stdout).result);
  assert.ok(splitRes.data.rest_card_id);

  // 20. plan show / add / edit / carry / skip-today / remove / draw / skip
  const planShowRes = await execCli(['plan', 'show', '--json'], peer);
  assert.equal(planShowRes.exitCode, 0);
  getTaskPlanResult.parse(JSON.parse(planShowRes.stdout).result);

  const secondCardId = splitRes.data.rest_card_id;
  const planAddRes = await execCli(['plan', 'add', secondCardId, '--day', '2026-11-03', '--json'], peer);
  assert.equal(planAddRes.exitCode, 0);
  planMutationResult.parse(JSON.parse(planAddRes.stdout).result);

  const planEditRes = await execCli(['plan', 'edit', secondCardId, '--day', '2026-11-03', '--priority', '高', '--json'], peer);
  assert.equal(planEditRes.exitCode, 0);
  planMutationResult.parse(JSON.parse(planEditRes.stdout).result);

  const planCarryRes = await execCli(['plan', 'carry', '--day', '2026-11-03', '--keep', secondCardId, '--json'], peer);
  assert.equal(planCarryRes.exitCode, 0);
  planMutationResult.parse(JSON.parse(planCarryRes.stdout).result);

  const planSkipTodayRes = await execCli(['plan', 'skip-today', '--day', '2026-11-03', '--json'], peer);
  assert.equal(planSkipTodayRes.exitCode, 0);
  planMutationResult.parse(JSON.parse(planSkipTodayRes.stdout).result);

  const planRemoveRes = await execCli(['plan', 'remove', secondCardId, '--day', '2026-11-03', '--json'], peer);
  assert.equal(planRemoveRes.exitCode, 0);
  planMutationResult.parse(JSON.parse(planRemoveRes.stdout).result);

  const planDrawRes = await execCli(['plan', 'draw', '--json'], peer);
  assert.equal(planDrawRes.exitCode, 0);
  drawTaskItemResult.parse(JSON.parse(planDrawRes.stdout).result);

  const planSkipRes = await execCli(['plan', 'skip', secondCardId, '--day', '2026-11-03', '--json'], peer);
  assert.equal(planSkipRes.exitCode, 0);
  planMutationResult.parse(JSON.parse(planSkipRes.stdout).result);

  // 21. task show / done / reopen
  const taskShowRes = await execCli(['task', 'show', capturedTodo.data.task_id, '--json'], peer);
  assert.equal(taskShowRes.exitCode, 0);
  getTaskDetailsResult.parse(JSON.parse(taskShowRes.stdout).result);

  const taskDoneRes = await execCli(['task', 'done', capturedTodo.data.task_id, '--json'], peer);
  assert.equal(taskDoneRes.exitCode, 0);
  const completedTask = completeTaskResult.parse(JSON.parse(taskDoneRes.stdout).result);
  assert.equal(completedTask.data.task.status, '已完成');

  const taskReopenRes = await execCli(
    ['task', 'reopen', capturedTodo.data.task_id, '--completion-id', completedTask.data.completion_id!, '--json'],
    peer,
  );
  assert.equal(taskReopenRes.exitCode, 0);
  assert.equal(reopenTaskResult.parse(JSON.parse(taskReopenRes.stdout).result).data.task.status, '进行中');

  // 22. recap show & history list
  const recapRes = await execCli(['recap', 'show', '--period', 'week', '--json'], peer);
  assert.equal(recapRes.exitCode, 0);
  getRecapResult.parse(JSON.parse(recapRes.stdout).result);

  const historyRes = await execCli(['history', 'list', '--source', 'all_automation', '--json'], peer);
  assert.equal(historyRes.exitCode, 0);
  listOperationHistoryResult.parse(JSON.parse(historyRes.stdout).result);

  const calledMethods = new Set(peer.calls.map((c) => c.method));
  for (const method of Object.keys(applicationContracts) as ApplicationMethod[]) {
    assert.equal(calledMethods.has(method), true, `Expected CLI test to exercise ${method}`);
  }
});

test('CLI idempotent retry (§5.2) replays committed timer mutations after state advances and rejects conflicting business parameters', async () => {
  const peer = createStatefulPeer();
  const opId = randomUUID();

  // First timer start with explicit --operation-id
  const first = await execCli(
    ['timer', 'start', '阅读论文', '--project', '学习', '--operation-id', opId, '--json'],
    peer,
  );
  assert.equal(first.exitCode, 0);
  const firstResult = timerMutationResult.parse(JSON.parse(first.stdout).result);
  assert.equal(firstResult.replayed, false);

  // Advance timer state (stop timer)
  const stop = await execCli(['timer', 'stop', '--json'], peer);
  assert.equal(stop.exitCode, 0);

  // Retry the exact same timer start command with --operation-id (no --expected-state) after state advanced
  const replay = await execCli(
    ['timer', 'start', '阅读论文', '--project', '学习', '--operation-id', opId, '--json'],
    peer,
  );
  assert.equal(replay.exitCode, 0);
  const replayResult = timerMutationResult.parse(JSON.parse(replay.stdout).result);
  assert.equal(replayResult.replayed, true);
  assert.deepEqual(replayResult.data, firstResult.data);

  // Retry with same --operation-id but changed description -> exit 3 OPERATION_CONFLICT
  const conflict = await execCli(
    ['timer', 'start', '阅读另一篇论文', '--project', '学习', '--operation-id', opId, '--json'],
    peer,
  );
  assert.equal(conflict.exitCode, 3);
  const conflictBody = JSON.parse(conflict.stdout);
  assert.equal(conflictBody.error.code, 'OPERATION_CONFLICT');
});

test('CLI maps exit codes 3 (business rejection), 4 (environment/setup), 5 (result_unknown + operation_id preservation), and 130 (cancelled before send)', async () => {
  const peer = createStatefulPeer();

  // Exit 3: business precondition rejection (resume when not paused)
  const res3 = await execCli(['timer', 'resume', '--json'], peer);
  assert.equal(res3.exitCode, 3);
  assert.equal(JSON.parse(res3.stdout).error.code, 'NO_RESUME_TARGET');

  // Exit 4: environment/setup error (SETUP_REQUIRED)
  let out4 = '';
  const code4 = await runCli(['context', '--json'], {
    createClient: () =>
      createApplicationClient({
        send: async () => {
          throw new Error('SETUP_REQUIRED：单轨尚未完成首次数据目录初始化');
        },
      }),
    writeStdout: t => { out4 += t; },
  });
  assert.equal(code4, 4);
  assert.equal(JSON.parse(out4).error.code, 'SETUP_REQUIRED');

  // Exit 5: result_unknown during a write after get_context issued an operation_id -> preserves operation_id in error output!
  const issuedOpId = randomUUID();
  let out5 = '';
  let err5Human = '';
  const unknownClient = () =>
    createApplicationClient({
      send: async req => {
        if (req.method === 'get_context') {
          return {
            status: 'ready',
            operation_id: issuedOpId,
            expected_state: 'ts1:init',
            as_of: '2026-11-03T10:00:00+08:00',
          };
        }
        throw new Error('CANCELLED_AFTER_SEND：请求在发送后被取消');
      },
    });

  const code5Json = await runCli(['idea', 'add', '结果未知测试', '--json'], {
    createClient: unknownClient,
    writeStdout: t => { out5 += t; },
  });
  assert.equal(code5Json, 5);
  const parsed5 = JSON.parse(out5);
  assert.equal(parsed5.status, 'error');
  assert.equal(parsed5.method, 'save_idea');
  assert.equal(parsed5.operation_id, issuedOpId);
  assert.equal(parsed5.error.code, 'CANCELLED_AFTER_SEND');
  assert.equal(parsed5.error.category, 'result_unknown');
  assert.match(parsed5.error.next_step, new RegExp(issuedOpId));

  // Verify human mode also prints the recovery operation_id to stderr
  const code5Human = await runCli(['idea', 'add', '结果未知测试'], {
    createClient: unknownClient,
    writeStderr: t => { err5Human += t; },
  });
  assert.equal(code5Human, 5);
  assert.match(err5Human, new RegExp(`monorail operation get ${issuedOpId}`));

  // Exit 130: cancelled before send
  let out130 = '';
  const code130 = await runCli(['context', '--json'], {
    createClient: () =>
      createApplicationClient({
        send: async () => {
          throw new Error('CANCELLED：请求在发送前已取消');
        },
      }),
    writeStdout: t => { out130 += t; },
  });
  assert.equal(code130, 130);
  assert.equal(JSON.parse(out130).error.code, 'CANCELLED');
});

test('self-contained dist-cli/monorail-cli.mjs and dist-mcp/monorail-mcp.mjs run from a clean directory with spaces and Chinese characters, share state, and CLI bundle excludes @modelcontextprotocol', async () => {
  assert.ok(existsSync(bundledCli), 'dist-cli/monorail-cli.mjs must be built before smoke tests');
  assert.ok(existsSync(bundledMcp), 'dist-mcp/monorail-mcp.mjs must be built before smoke tests');

  const cliBundleSource = readFileSync(bundledCli, 'utf8');
  assert.equal(
    cliBundleSource.includes('node_modules/@modelcontextprotocol') || cliBundleSource.includes('McpServer'),
    false,
    'CLI bundle must not contain @modelcontextprotocol SDK code',
  );

  const peer = createStatefulPeer();
  const server = await createPipeServerForPeer(peer);
  const isolatedDir = mkdtempSync(join(tmpdir(), '单轨 CLI 发行测试 '));
  const standaloneCli = join(isolatedDir, 'monorail-cli.mjs');
  copyFileSync(bundledCli, standaloneCli);
  const noteFile = join(isolatedDir, '多行笔记 1.txt');
  const noteContent = '来自干净目录的中文笔记 & $(echo unsafe) | `反引号`\n第二行内容 #CLI';
  writeFileSync(noteFile, noteContent, 'utf8');

  const env = { ...process.env, MONORAIL_PIPE: server.pipe } as Record<string, string>;

  function runStandaloneCli(args: string[], stdinText?: string) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const proc = spawn(process.execPath, [standaloneCli, ...args], {
        cwd: isolatedDir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += String(d); });
      proc.stderr.on('data', d => { stderr += String(d); });
      proc.once('error', reject);
      proc.once('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      if (stdinText !== undefined) {
        proc.stdin.end(stdinText, 'utf8');
      } else {
        proc.stdin.end();
      }
    });
  }

  try {
    // 1. --version --json without touching pipe
    const ver = await runStandaloneCli(['--version', '--json']);
    assert.equal(ver.code, 0);
    assert.equal(JSON.parse(ver.stdout).version, pkg.version);

    // 2. Save idea from file in path with spaces & Chinese characters
    const saved = await runStandaloneCli(['idea', 'add', '--text-file', noteFile, '--json']);
    assert.equal(saved.code, 0);
    assert.equal(saved.stderr, '');
    const savedBody = JSON.parse(saved.stdout);
    const parsedIdea = saveIdeaResult.parse(savedBody.result);
    assert.equal(parsedIdea.data.text, noteContent);

    // 3. Concurrent duplicate submission with the same --operation-id across two CLI child processes
    const sharedOpId = randomUUID();
    const [p1, p2] = await Promise.all([
      runStandaloneCli(['timer', 'start', '并发幂等计时', '--project', '学习', '--operation-id', sharedOpId, '--json']),
      runStandaloneCli(['timer', 'start', '并发幂等计时', '--project', '学习', '--operation-id', sharedOpId, '--json']),
    ]);
    assert.equal(p1.code, 0);
    assert.equal(p2.code, 0);
    const r1 = timerMutationResult.parse(JSON.parse(p1.stdout).result);
    const r2 = timerMutationResult.parse(JSON.parse(p2.stdout).result);
    assert.equal(r1.operation_id, sharedOpId);
    assert.equal(r2.operation_id, sharedOpId);
    // Exactly one executed fresh and the other replayed the receipt
    assert.equal(Number(r1.replayed) + Number(r2.replayed), 1);
  } finally {
    await server.close();
  }
});

test('origin (ADR 0019 §6) travels as an optional top-level request field: per-call wins over the client default, absent stays absent, bad values are dropped instead of failing the call', async () => {
  const sent: ApplicationRequest[] = [];
  const reply = { ok: true };
  const transport = { send: async (req: ApplicationRequest) => { sent.push(req); return reply; } };
  const cliOrigin = { kind: 'cli' as const, agent: { name: 'Claude Code', detected_by: 'env' as const, evidence: 'CLAUDECODE=1' } };
  const mcpOrigin = { kind: 'mcp' as const, agent: { name: null, raw: 'claude-ai', version: '0.14.2', detected_by: 'mcp_handshake' as const } };
  const call = (client: ReturnType<typeof createApplicationClient>, origin?: typeof mcpOrigin) =>
    client.call('get_context', {}, origin ? { origin } : undefined).catch(() => undefined);
  await call(createApplicationClient(transport));
  await call(createApplicationClient(transport, { origin: cliOrigin }));
  await call(createApplicationClient(transport, { origin: cliOrigin }), mcpOrigin);
  assert.deepEqual(sent.map(req => req.origin), [undefined, cliOrigin, mcpOrigin]);
  assert.equal('origin' in sent[0], false);
  assert.deepEqual(sent.map(req => req.arguments), [{}, {}, {}]);

  const parsed = applicationRequest.parse({ method: 'get_context', arguments: {}, origin: {
    kind: 'cli', agent: { name: `a\u0007b${'x'.repeat(80)}`, version: '1'.repeat(40), detected_by: 'flag' } } });
  assert.equal(parsed.origin?.agent.name, `ab${'x'.repeat(62)}`);
  assert.equal(parsed.origin?.agent.version, '1'.repeat(32));
  const dropped = applicationRequest.parse({ method: 'get_context', arguments: {}, origin: { kind: 'browser', agent: {} } });
  assert.equal(dropped.origin, undefined);
  assert.throws(() => applicationRequest.parse({ method: 'get_context', arguments: {}, origin: undefined, extra: 1 }));
});

test('caller agent (ADR 0019 §6): --agent / MONORAIL_AGENT win over known env variables, otherwise none; every request of one process carries the same origin', async () => {
  assert.deepEqual(detectAgent(' 手环同步 ', { CLAUDECODE: '1' }), { name: '手环同步', detected_by: 'flag', evidence: '--agent 手环同步' });
  assert.deepEqual(detectAgent(undefined, { MONORAIL_AGENT: 'cron', CLAUDECODE: '1' }), { name: 'cron', detected_by: 'flag', evidence: 'MONORAIL_AGENT=cron' });
  assert.deepEqual(detectAgent(undefined, { CLAUDECODE: '1' }), { name: 'Claude Code', detected_by: 'env', evidence: 'CLAUDECODE=1' });
  assert.deepEqual(detectAgent(undefined, { CODEX_SANDBOX: 'x'.repeat(40) }), { name: 'Codex', detected_by: 'env', evidence: 'CODEX_SANDBOX' });
  assert.deepEqual(detectAgent('  ', { CLAUDECODE: '', MONORAIL_AGENT: ' ' }), { name: null, detected_by: 'none' });

  const peer = createStatefulPeer();
  const sent: ApplicationRequest[] = [];
  const run = (argv: string[], env: Record<string, string>) => {
    const client = createApplicationClient({ send: req => { sent.push(req); return peer.handle(req); } });
    return runCli(argv, { createClient: () => client, env, writeStdout: () => {}, writeStderr: () => {} });
  };
  assert.equal(await run(['idea', 'add', '来自命令行', '--agent', '手环同步'], { CLAUDECODE: '1' }), 0);
  assert.deepEqual(sent.map(r => r.method), ['get_context', 'save_idea']);
  for (const req of sent) assert.deepEqual(req.origin, { kind: 'cli', agent: { name: '手环同步', detected_by: 'flag', evidence: '--agent 手环同步' } });
  assert.equal((sent[1].arguments as { text?: string }).text, '来自命令行');

  sent.length = 0;
  assert.equal(await run(['--agent=cron', 'context', '--json'], {}), 0);
  assert.equal(sent[0].origin?.agent.name, 'cron');
  sent.length = 0;
  assert.equal(await run(['context'], { CLAUDECODE: '1' }), 0);
  assert.deepEqual(sent[0].origin, { kind: 'cli', agent: { name: 'Claude Code', detected_by: 'env', evidence: 'CLAUDECODE=1' } });
  sent.length = 0;
  assert.equal(await run(['context'], {}), 0);
  assert.deepEqual(sent[0].origin, { kind: 'cli', agent: { name: null, detected_by: 'none' } });

  sent.length = 0;
  for (const argv of [['context', '--agent'], ['context', '--agent', 'a', '--agent=b'], ['context', '--agent=']]) assert.equal(await run(argv, {}), 2);
  assert.equal(sent.length, 0);
});
