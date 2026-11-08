import { expect, it, vi } from 'vitest';
import { handleApplicationRequest } from './applicationController';
import { at, card, fixture, getCard, open, seed, task } from '../services/serviceFixture';
import { pauseCommits, run } from '../services/commit';
import { beginPending, settleOffline } from '../services/homeService';
import { ApplicationError } from '../shared/appError';
import { createProject } from '../services/presetService';
import {
  addTimeEntryResult,
  captureTodoResult,
  completeIdeaResult,
  completeTaskItemResult,
  completeTaskResult,
  contextResult,
  convertIdeaToTaskResult,
  createIdeaResult,
  createTaskResult,
  drawTaskItemResult,
  endOriginalTaskResult,
  findItemsResult,
  getIdeaDetailsResult,
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
  updateIdeaResult,
} from '../shared/application';

const saveIdeaReq = (args: unknown) => ({ method: 'save_idea', arguments: args });

it('saves an idea through the journal, replays case-insensitively by operation_id, and looks up receipts (with normalized request) without changing the timer', async () => {
  const f = fixture(); await seed(f, []);
  f.publish.mockClear();
  const before = f.ctx.repos.times.snapshot();
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  const context = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  const first = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, saveIdeaReq({
    operation_id: context.operation_id.toUpperCase(),
    text: '  做一个聊天灵感收集器 #产品\n保留正文  ',
    needs: ' 减少遗忘 ',
  })));
  const result = first.data;
  expect(first.replayed).toBe(false);
  expect(first.operation_id).toBe(context.operation_id.toLowerCase());
  expect(result).toMatchObject({ text: '做一个聊天灵感收集器 #产品\n保留正文', tags: ['产品'], pool: '活跃池' });
  expect((await f.ctx.repos.records.get(result.id))!.value).toMatchObject({ kind: '想法', text: '做一个聊天灵感收集器 #产品', needs: '减少遗忘', attachments: [], card_id: null });
  expect((await f.ctx.repos.records.get(result.id))!.hasDetails).toBe(true);
  expect((await f.ctx.repos.records.getDetails(result.id))!.body).toBe('\n保留正文');
  const replay = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, saveIdeaReq({
    operation_id: context.operation_id,
    text: '做一个聊天灵感收集器 #产品\n保留正文',
    needs: '减少遗忘',
  })));
  expect(replay.replayed).toBe(true);
  expect(replay.data).toEqual(result);
  await expect(handleApplicationRequest(f.ctx, saveIdeaReq({ operation_id: context.operation_id.toUpperCase(), text: '另一个内容' }))).rejects.toThrow('OPERATION_CONFLICT');
  const found = lookupResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_operation_result', arguments: { operation_id: context.operation_id.toUpperCase() } }));
  expect(found).toMatchObject({
    status: 'committed',
    operation_id: context.operation_id.toLowerCase(),
    command: 'save_idea',
    request: {
      method: 'save_idea',
      arguments: { text: '做一个聊天灵感收集器 #产品\n保留正文', needs: '减少遗忘' },
    },
    data: result,
  });
  const missingId = crypto.randomUUID().toUpperCase();
  const missing = lookupResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_operation_result', arguments: { operation_id: missingId } }));
  expect(missing).toEqual({ status: 'not_found', operation_id: missingId.toLowerCase() });
  expect(transact).toHaveBeenCalledOnce();
  expect(f.publish).toHaveBeenCalledOnce();
  expect(f.ctx.snapshot()!.backpack.ideas).toContainEqual(expect.objectContaining({ id: result.id, text: '做一个聊天灵感收集器 #产品', hasDetails: true }));
  expect(await f.ctx.repos.cards.list()).toEqual([]);
  expect(await f.ctx.repos.tasks.list()).toEqual([]);
  expect(f.ctx.repos.times.snapshot()).toEqual(before);
});

it('rejects blank content, unknown methods and extra fields before any writes', async () => {
  const f = fixture();
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  for (const input of [
    saveIdeaReq({ operation_id: crypto.randomUUID(), text: ' \n ' }),
    saveIdeaReq({ operation_id: crypto.randomUUID(), text: 'x', path: '../state.yaml' }),
    { method: 'start_timer', arguments: { text: 'x' } },
  ]) {
    await expect(handleApplicationRequest(f.ctx, input)).rejects.toThrow();
  }
  expect(transact).not.toHaveBeenCalled();
});

it('surfaces installation barriers and journal failure instead of returning saved', async () => {
  const f = fixture(); await seed(f, []);
  const barrier = pauseCommits(f.ctx); await barrier.ready;
  await expect(handleApplicationRequest(f.ctx, saveIdeaReq({ operation_id: crypto.randomUUID(), text: '安装期间' }))).rejects.toThrow('正在安装更新');
  barrier.resume();
  vi.spyOn(f.ctx.repos, 'transact').mockRejectedValueOnce(new Error('disk full'));
  const failedId = crypto.randomUUID();
  await expect(handleApplicationRequest(f.ctx, saveIdeaReq({ operation_id: failedId, text: '磁盘满' }))).rejects.toThrow('disk full');
  await expect(handleApplicationRequest(f.ctx, { method: 'get_operation_result', arguments: { operation_id: failedId } })).rejects.toThrow('提交已阻塞');
  expect(await f.ctx.repos.records.list()).toEqual([]);
});

it('M6: get_context retains accumulated notices across later transactions, captures todos atomically, and finds ambiguous items', async () => {
  const f = fixture();
  const mainTask = task('t-main', '主线', 1);
  await seed(f, [card('c-existing', { content: '复习操作系统', task_id: 't-main' })], [mainTask]);

  f.clock(at(10));
  await settleOffline(f.ctx, { start: at(2), end: at(10) });
  const ctx1 = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  expect(ctx1.pending_actions?.some(a => a.kind === 'offlineAsk')).toBe(true);

  const ideaCommitted = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'save_idea',
    arguments: { operation_id: ctx1.operation_id, text: '复习操作系统内存管理 #408' },
  }));
  const ctx2 = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  expect(ctx2.pending_actions?.some(a => a.kind === 'offlineAsk')).toBe(true);
  expect(ctx2.expected_state).toBe(ctx1.expected_state);

  const todo1 = captureTodoResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'capture_todo',
    arguments: { operation_id: ideaCommitted.next_operation_id, text: '复习操作系统进程调度 #408', blocking: true },
  }));
  // 0.3.1：blocking 参数照收、不起作用（删除阻塞机制，已定 12），记录和卡照写 false
  expect(todo1.data).toMatchObject({
    slot: '支线',
    content: '复习操作系统进程调度 #408',
    tags: ['408'],
    blocking: false,
  });

  const todo2 = captureTodoResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'capture_todo',
    arguments: { operation_id: todo1.next_operation_id, text: '完成真题卷', task_id: 't-main' },
  }));
  expect(todo2.data).toMatchObject({ task_id: 't-main', slot: '主线', content: '完成真题卷' });

  await expect(handleApplicationRequest(f.ctx, {
    method: 'capture_todo',
    arguments: { operation_id: todo2.next_operation_id, text: '无效任务', task_id: 'no-such-task' },
  })).rejects.toThrow('TASK_NOT_IN_BACKPACK');

  const found = findItemsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'find_items',
    arguments: { kind: 'todo_card', query: '复习操作系统' },
  }));
  expect(found.ambiguous).toBe(true);
  expect(found.todo_cards).toHaveLength(2);
  expect(found.todo_cards[0].exact_match).toBe(true);
});

it('M6 & M7: executes full timer lifecycle, break/return, manual backfill, time summary and enforces preconditions', async () => {
  const f = fixture();
  const mainTask = task('t-main', '主线', 1);
  await seed(f, [card('c1', { content: '写编译器前端', task_id: 't-main' })], [mainTask]);
  await createProject(f.ctx, '学习', at(0));

  let ctx = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  expect(ctx.timer?.mode).toBe('idle');

  await expect(handleApplicationRequest(f.ctx, {
    method: 'start_timer',
    arguments: { operation_id: ctx.operation_id, expected_state: ctx.expected_state, description: '看书', project: '待机' },
  })).rejects.toThrow('RESERVED_PROJECT');

  await expect(handleApplicationRequest(f.ctx, {
    method: 'start_timer',
    arguments: { operation_id: ctx.operation_id, expected_state: ctx.expected_state, description: '看书', project: '不存在项目' },
  })).rejects.toThrow('UNKNOWN_PROJECT');

  const startedFree = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_timer',
    arguments: { operation_id: ctx.operation_id, expected_state: ctx.expected_state, description: '看龙书', project: '学习', tags: ['编译'] },
  }));
  expect(startedFree.data.noop).toBe(false);
  expect(startedFree.data.timer.mode).toBe('running');
  expect(startedFree.data.timer.open_entry).toMatchObject({ description: '看龙书', project: '学习', tags: ['编译'] });

  // Verify get_operation_result returns normalized request including expected_state
  const timerLookup = lookupResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_operation_result',
    arguments: { operation_id: ctx.operation_id },
  }));
  expect(timerLookup).toMatchObject({
    status: 'committed',
    command: 'start_timer',
    request: {
      method: 'start_timer',
      arguments: {
        expected_state: ctx.expected_state,
        description: '看龙书',
        project: '学习',
        tags: ['编译'],
      },
    },
  });

  await expect(handleApplicationRequest(f.ctx, {
    method: 'pause_timer',
    arguments: { operation_id: startedFree.next_operation_id, expected_state: ctx.expected_state },
  })).rejects.toThrow('STATE_CHANGED');

  const replayedStart = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_timer',
    arguments: { operation_id: ctx.operation_id, expected_state: ctx.expected_state, description: '看龙书', project: '学习', tags: ['编译'] },
  }));
  expect(replayedStart.replayed).toBe(true);

  f.clock(at(15));
  const startedCard = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_task_item',
    arguments: { operation_id: startedFree.next_operation_id, expected_state: startedFree.data.expected_state, card_id: 'c1' },
  }));
  expect(startedCard.data.timer.open_entry.card_id).toBe('c1');
  expect((await getCard(f, 'c1')).status).toBe('进行中');

  const noopCard = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_task_item',
    arguments: { operation_id: startedCard.next_operation_id, expected_state: startedCard.data.expected_state, card_id: 'c1' },
  }));
  expect(noopCard.data.noop).toBe(true);
  expect(noopCard.data.reason).toBe('already_running');

  f.clock(at(25));
  const breakStarted = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_break',
    arguments: { operation_id: noopCard.next_operation_id, expected_state: noopCard.data.expected_state, activity: '上厕所' },
  }));
  expect(breakStarted.data.timer.mode).toBe('away');
  expect(breakStarted.data.timer.paused_target?.card_id).toBe('c1');

  expect(breakStarted.data.timer.away_paused).toBe(false);
  expect(breakStarted.data.timer.allowed_actions).toEqual(expect.arrayContaining(['pause_timer', 'return_from_break', 'start_timer']));
  // 0.3.1（ADR 0021 第 3 条方法表）：插入中 pause_timer 暂停插入的事；resume_timer 继续插入的事；stop_timer 拒绝
  await expect(handleApplicationRequest(f.ctx, {
    method: 'stop_timer',
    arguments: { operation_id: breakStarted.next_operation_id, expected_state: breakStarted.data.expected_state },
  })).rejects.toThrow('IN_AWAY_ACTIVITY');
  f.clock(at(26));
  const breakPaused = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'pause_timer',
    arguments: { operation_id: breakStarted.next_operation_id, expected_state: breakStarted.data.expected_state },
  }));
  expect(breakPaused.data.timer).toMatchObject({ mode: 'away', away_paused: true, paused_target: { card_id: 'c1' } });
  f.clock(at(28));
  const breakContinued = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'resume_timer',
    arguments: { operation_id: breakPaused.next_operation_id, expected_state: breakPaused.data.expected_state },
  }));
  expect(breakContinued.data.timer).toMatchObject({ mode: 'away', away_paused: false, open_entry: { description: '上厕所', kind: '插入' }, paused_target: { card_id: 'c1' } });

  f.clock(at(30));
  const returned = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'return_from_break',
    arguments: { operation_id: breakContinued.next_operation_id, expected_state: breakContinued.data.expected_state },
  }));
  expect(returned.data.timer.mode).toBe('running');
  expect(returned.data.timer.open_entry.card_id).toBe('c1');

  f.clock(at(40));
  const paused = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'pause_timer',
    arguments: { operation_id: returned.next_operation_id, expected_state: returned.data.expected_state },
  }));
  expect(paused.data.timer.mode).toBe('paused');
  expect((await getCard(f, 'c1')).status).toBe('进行中');

  f.clock(at(45));
  const stoppedFromPause = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'stop_timer',
    arguments: { operation_id: paused.next_operation_id, expected_state: paused.data.expected_state },
  }));
  expect(stoppedFromPause.data.noop).toBe(false);
  expect(stoppedFromPause.data.timer.mode).toBe('idle');
  expect(stoppedFromPause.data.timer.paused_target).toBeNull();
  expect((await getCard(f, 'c1')).status).toBe('待做');

  await expect(handleApplicationRequest(f.ctx, {
    method: 'resume_timer',
    arguments: { operation_id: stoppedFromPause.next_operation_id, expected_state: stoppedFromPause.data.expected_state },
  })).rejects.toThrow('NO_RESUME_TARGET');

  f.clock(at(46));
  const idleBreak = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_break',
    arguments: { operation_id: stoppedFromPause.next_operation_id, expected_state: stoppedFromPause.data.expected_state, activity: '喝水' },
  }));
  // 0.3.1：什么都没在计时开始快捷活动就是直接开始（没有要等的事，不出插入卡，ADR 0021 第 3 条入口表）
  expect(idleBreak.data.timer.mode).toBe('running');
  expect(idleBreak.data.timer.open_entry).toMatchObject({ description: '喝水', kind: '普通' });
  expect(idleBreak.data.timer.paused_target).toBeNull();

  f.clock(at(48));
  await expect(handleApplicationRequest(f.ctx, {
    method: 'return_from_break',
    arguments: { operation_id: idleBreak.next_operation_id, expected_state: idleBreak.data.expected_state },
  })).rejects.toThrow('NOT_IN_BREAK');
  const idleReturned = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'stop_timer',
    arguments: { operation_id: idleBreak.next_operation_id, expected_state: idleBreak.data.expected_state },
  }));
  expect(idleReturned.data.timer.mode).toBe('idle');
  expect(open(f).project).toBe('待机');

  f.clock(at(50));
  const backfilled = addTimeEntryResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'add_time_entry',
    arguments: {
      operation_id: idleReturned.next_operation_id,
      description: '听技术播客',
      start: at(10),
      end: at(20),
      project: '学习',
      tags: ['播客'],
    },
  }));
  expect(backfilled.data.overlaps.length).toBeGreaterThanOrEqual(2);

  const summary = timeSummaryResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_time_summary',
    arguments: { day: 'today', day_mode: 'activity' },
  }));
  expect(summary.non_idle_covered_ms + summary.idle_ms + summary.untracked_ms).toBe(summary.interval_elapsed_ms);
  expect(summary.overlap_excess_ms).toBe(10 * 60000);

  const listed = listTimeEntriesResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'list_time_entries',
    arguments: { from: at(0), to: at(50) },
  }));
  expect(listed.entries.length).toBeGreaterThanOrEqual(5);

  await beginPending(f.ctx, at(50));
  ctx = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  expect(ctx.timer?.mode).toBe('pending');
  await expect(handleApplicationRequest(f.ctx, {
    method: 'start_timer',
    arguments: { operation_id: ctx.operation_id, expected_state: ctx.expected_state, description: '抢占起点' },
  })).rejects.toThrow('PENDING_CONFIRMATION');

  await run(f.ctx, async tx => {
    tx.state.pending_id = null;
    tx.state.pending_at = null;
    tx.state.rest = { suggestion: '散步', started_at: at(50) };
    tx.state.home_mode = 'rest';
  }, undefined, { action: 'test.direct' });
  ctx = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  expect(ctx.timer?.mode).toBe('rest');
  await expect(handleApplicationRequest(f.ctx, {
    method: 'start_timer',
    arguments: { operation_id: ctx.operation_id, expected_state: ctx.expected_state, description: '跳过休息' },
  })).rejects.toThrow('IN_DEGRADE_REST');
});

it('R2 & D1: isolates reads from in-flight/failed journal writes, survives post-commit projection errors, and attaches structured context on errors', async () => {
  const f = fixture();
  await seed(f, []);

  let reachReceipt!: () => void;
  let releaseReceipt!: () => void;
  const reached = new Promise<void>(r => { reachReceipt = r; });
  const released = new Promise<void>(r => { releaseReceipt = r; });
  const fs = (f.ctx.repos.records as unknown as { fs: { atomicWrite(p: string, t: string): Promise<void> } }).fs;
  const originalWrite = fs.atomicWrite.bind(fs);
  vi.spyOn(fs, 'atomicWrite').mockImplementation(async (path: string, text: string) => {
    if (path.startsWith('receipts/')) {
      reachReceipt();
      await released;
      throw new Error('interrupted receipt write');
    }
    return originalWrite(path, text);
  });

  const opId = crypto.randomUUID();
  const pendingSave = handleApplicationRequest(f.ctx, {
    method: 'save_idea',
    arguments: { operation_id: opId, text: '未完成提交的想法' },
  }).then(v => ({ value: v }), e => ({ error: e as Error }));

  await reached;
  const duringContext = contextResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_context',
    arguments: {},
  }));
  expect(duringContext.timer?.mode).toBe('idle');
  let duringFindSettled = false;
  const duringFind = handleApplicationRequest(f.ctx, {
    method: 'find_items',
    arguments: { kind: 'idea', query: '未完成提交的想法' },
  }).finally(() => {
    duringFindSettled = true;
  });
  await Promise.resolve();
  expect(duringFindSettled).toBe(false);

  releaseReceipt();
  const failedOutcome = await pendingSave;
  expect('error' in failedOutcome).toBe(true);
  if ('error' in failedOutcome) {
    expect(failedOutcome.error).toBeInstanceOf(ApplicationError);
    const structured = (failedOutcome.error as ApplicationError).failure;
    expect(structured).toMatchObject({ status: 'error', code: 'JOURNAL_BLOCKED', category: 'result_unknown' });
  }

  await expect(duringFind).rejects.toThrow('提交已阻塞');
  await expect(handleApplicationRequest(f.ctx, {
    method: 'find_items',
    arguments: { kind: 'idea', query: '未完成提交的想法' },
  })).rejects.toThrow('提交已阻塞');
  await expect(handleApplicationRequest(f.ctx, {
    method: 'get_context',
    arguments: {},
  })).rejects.toThrow('提交已阻塞');

  const f2 = fixture();
  await seed(f2, []);
  f2.publish.mockImplementationOnce(() => { throw new Error('ui listener failed'); });
  const ctx0 = contextResult.parse(await handleApplicationRequest(f2.ctx, { method: 'get_context', arguments: {} }));
  const savedWithWarning = saveIdeaResult.parse(await handleApplicationRequest(f2.ctx, {
    method: 'save_idea',
    arguments: { operation_id: ctx0.operation_id, text: '投影告警但已提交的想法' },
  }));
  expect(savedWithWarning.warnings).toEqual([{ phase: 'projection', message: 'ui listener failed' }]);
  const foundAfterWarning = findItemsResult.parse(await handleApplicationRequest(f2.ctx, {
    method: 'find_items',
    arguments: { kind: 'idea', query: '投影告警但已提交的想法' },
  }));
  expect(foundAfterWarning.ideas).toHaveLength(1);

  let stateChangedError: Error | undefined;
  try {
    await handleApplicationRequest(f2.ctx, {
      method: 'start_timer',
      arguments: { operation_id: savedWithWarning.next_operation_id, expected_state: 'ts1:stale', description: '写文档' },
    });
  } catch (error) {
    stateChangedError = error as Error;
  }
  expect(stateChangedError).toBeDefined();
  expect(stateChangedError).toBeInstanceOf(ApplicationError);
  const payload = (stateChangedError as ApplicationError).failure;
  expect(payload).toMatchObject({
    status: 'error',
    code: 'STATE_CHANGED',
    category: 'not_executed',
    latest_context: {
      expected_state: ctx0.expected_state,
      timer: { mode: 'idle' },
      allowed_actions: expect.arrayContaining(['start_timer', 'start_task_item']),
    },
  });
});

it('R2: refuses stale context when committed projection generation fails, while keeping the durable receipt readable', async () => {
  const f = fixture();
  await seed(f, []);
  const context = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  const originalNow = f.ctx.now;
  let calls = 0;
  f.ctx.now = () => { if (++calls === 4) throw new Error('projection clock unavailable'); return originalNow(); };
  const result = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'save_idea', arguments: { operation_id: context.operation_id, text: '已落盘，快照生成失败' },
  }));
  expect(result.warnings).toContainEqual({ phase: 'projection', message: 'projection clock unavailable' });
  await expect(handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} })).rejects.toMatchObject({
    failure: { code: 'SNAPSHOT_UNAVAILABLE', category: 'result_unknown' },
  });
  expect(await handleApplicationRequest(f.ctx, { method: 'get_operation_result', arguments: { operation_id: context.operation_id } })).toMatchObject({
    status: 'committed', data: result.data,
  });
  f.ctx.now = originalNow;
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  const found = findItemsResult.parse(await handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea', query: '已落盘，快照生成失败' } }));
  expect(found.ideas).toHaveLength(1);
});

// ===== 0.3.0-beta.4 D2：complete_idea（ADR 0020 第 4 条） =====
it('complete_idea marks an active idea done, records the caller, replays by operation_id and reports noop on a second mark', async () => {
  const f = fixture(); await seed(f, []);
  const ctx1 = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  const saved = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, saveIdeaReq({ operation_id: ctx1.operation_id, text: '试试新开的咖啡店' })));
  const origin = { kind: 'cli' as const, agent: { name: 'Claude Code', detected_by: 'env' as const } };
  const req = { method: 'complete_idea', arguments: { operation_id: saved.next_operation_id, idea_id: saved.data.id.toUpperCase() }, origin };
  const done = completeIdeaResult.parse(await handleApplicationRequest(f.ctx, req));
  expect(done.data).toMatchObject({ id: saved.data.id, status: '已完成', noop: false });
  const record = (await f.ctx.repos.records.get(saved.data.id))!.value;
  expect(record).toMatchObject({ pool: '冷库', completed_at: done.data.completed_at, completed_by: { kind: 'cli', agent: 'Claude Code' } });
  expect(f.ctx.snapshot()!.backpack.doneIdeas.map(i => i.id)).toEqual([saved.data.id]);
  const replay = completeIdeaResult.parse(await handleApplicationRequest(f.ctx, req));
  expect(replay.replayed).toBe(true);
  const again = completeIdeaResult.parse(await handleApplicationRequest(f.ctx, { method: 'complete_idea', arguments: { operation_id: done.next_operation_id, idea_id: saved.data.id } }));
  expect(again.data.noop).toBe(true);
  // find_items：默认只列活跃池；include_archived 时状态是「已完成」
  const active = findItemsResult.parse(await handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea' } }));
  expect(active.ideas).toEqual([]);
  const all = findItemsResult.parse(await handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea', include_archived: true } }));
  expect(all.ideas.map(i => i.pool)).toEqual(['已完成']);
});
it('complete_idea rejects unknown ideas and ideas outside the pool without writing', async () => {
  const f = fixture(); await seed(f, []);
  const ctx1 = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  await expect(handleApplicationRequest(f.ctx, { method: 'complete_idea', arguments: { operation_id: ctx1.operation_id, idea_id: crypto.randomUUID() } }))
    .rejects.toMatchObject({ failure: { code: 'IDEA_NOT_FOUND', category: 'not_executed' } });
  const saved = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, saveIdeaReq({ operation_id: crypto.randomUUID(), text: '冷库里的想法' })));
  await run(f.ctx, async tx => { const r = tx.records.find(x => x.id === saved.data.id)!; tx.saveRecord({ ...r, pool: '冷库', cold_since: tx.at }); }, undefined, { action: 'test.direct' });
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  await expect(handleApplicationRequest(f.ctx, { method: 'complete_idea', arguments: { operation_id: crypto.randomUUID(), idea_id: saved.data.id } }))
    .rejects.toMatchObject({ failure: { code: 'IDEA_NOT_ACTIVE' } });
  expect(transact).not.toHaveBeenCalled();
});

// 0.3.1 代码审核 S3 / S4：「插入的事暂停了」这一状态下 MCP 的方法表（ADR 0021 第 3 条）；away_paused 始终给出
it('0.3.1 MCP：插入的事暂停了时 pause noop、resume 继续插入的事、stop / start_task_item 拒绝；away_paused 一直在', async () => {
  const f = fixture(); await seed(f, [card('c1', { task_id: 'main' }), card('c2', { task_id: 'main', order: 2 })], [task('main')]);
  const ctx = async () => contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  const call = async (method: string, extra: Record<string, unknown> = {}) => {
    const c = await ctx();
    return handleApplicationRequest(f.ctx, { method, arguments: { operation_id: c.operation_id, expected_state: c.expected_state, ...extra } } as never);
  };
  expect((await ctx()).timer?.away_paused).toBe(false);   // idle 时也给 false
  await call('start_task_item', { card_id: 'c1' });
  f.clock(at(10)); await call('start_break', { activity: '上厕所' });
  f.clock(at(15)); await call('pause_timer');
  const paused = await ctx();
  expect(paused.timer).toMatchObject({ mode: 'away', away_paused: true, paused_target: { card_id: 'c1' } });
  expect(paused.timer?.allowed_actions).toEqual(expect.arrayContaining(['resume_timer', 'return_from_break', 'end_original_task']));
  expect(paused.timer?.allowed_actions).not.toContain('pause_timer');
  expect(timerMutationResult.parse(await call('pause_timer')).data).toMatchObject({ noop: true, reason: 'already_paused' });
  await expect(call('stop_timer')).rejects.toThrow('IN_AWAY_ACTIVITY');
  await expect(call('start_task_item', { card_id: 'c2' })).rejects.toThrow('IN_AWAY_ACTIVITY');
  f.clock(at(20));
  expect(timerMutationResult.parse(await call('resume_timer')).data.timer).toMatchObject({ mode: 'away', away_paused: false, open_entry: { description: '上厕所', kind: '插入' } });
  expect((await getCard(f, 'c1')).status).toBe('进行中');
});

it('0.3.2 Module A: get_task_plan, add/update/remove_plan_item, confirm_plan_carry, skip_today_plan, draw_task_item, and 3-card skip_task_item round reset', async () => {
  const f = fixture();
  await seed(
    f,
    [
      card('c1', { task_id: 'main', content: '主线一', type: '时间盒卡', timebox_minutes: 60, order: 1 }),
      card('c2', { task_id: 'main', content: '主线二', order: 2 }),
      card('c3', { task_id: 'side', content: '支线三', order: 3 }),
    ],
    [
      task('main'),
      { ...task('side'), slot: '支线', slot_index: 2, bet_ends_at: null },
    ],
  );

  const plan0 = getTaskPlanResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_task_plan', arguments: { day: 'today' } }));
  expect(plan0.enabled).toBe(true);
  const today = plan0.resolved_day;
  expect(plan0.plan?.items).toEqual([]);

  // Need plan before skip_today_plan
  const draw0 = drawTaskItemResult.parse(await handleApplicationRequest(f.ctx, { method: 'draw_task_item', arguments: {} }));
  expect(draw0.outcome).toBe('need_plan');

  // Wrong day rejected with PLAN_DAY_CHANGED
  await expect(handleApplicationRequest(f.ctx, {
    method: 'skip_today_plan',
    arguments: { operation_id: crypto.randomUUID(), day: '2099-01-01' },
  })).rejects.toThrow('PLAN_DAY_CHANGED');

  // skip_today_plan enables drawing from all 3 backpack cards; skip_task_item accumulates seen across 3 cards then resets round
  const skippedToday = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'skip_today_plan',
    arguments: { operation_id: crypto.randomUUID(), day: today },
  }));
  expect(skippedToday.data.plan.skip_until_planned).toBe(true);
  expect(skippedToday.data.plan.drawable_card_ids).toEqual(['c1', 'c2', 'c3']);

  const s1 = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'skip_task_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c1' },
  }));
  expect(s1.data.plan.seen_card_ids).toEqual(['c1']);

  const s2 = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'skip_task_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c2' },
  }));
  expect(s2.data.plan.seen_card_ids).toEqual(['c1', 'c2']);

  const s3 = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'skip_task_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c3' },
  }));
  // All 3 candidates seen -> round resets to [c3]
  expect(s3.data.plan.seen_card_ids).toEqual(['c3']);

  // Adding first item to today clears skip_until_planned
  const added = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'add_plan_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c1', priority: '高', today_minutes: 45 },
  }));
  expect(added.data.plan.skip_until_planned).toBe(false);
  expect(added.data.plan.items).toEqual([expect.objectContaining({ card_id: 'c1', priority: '高', today_minutes: 45 })]);

  const updated = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'update_plan_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c1', priority: '普通', today_minutes: 30 },
  }));
  expect(updated.data.noop).toBe(false);
  expect(updated.data.plan.items[0]).toMatchObject({ card_id: 'c1', priority: '普通', today_minutes: 30 });

  const draw1 = drawTaskItemResult.parse(await handleApplicationRequest(f.ctx, { method: 'draw_task_item', arguments: {} }));
  expect(draw1.outcome).toBe('card');
  expect(draw1.card).toMatchObject({ id: 'c1', today_minutes: 30, goal_minutes: 60 });

  const removed = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'remove_plan_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c1' },
  }));
  expect(removed.data.noop).toBe(false);
  expect(removed.data.plan.items).toEqual([]);

  // Seed carried items and confirm carry
  await run(f.ctx, async tx => {
    const p = structuredClone(tx.todayPlan);
    p.items = [
      { card_id: 'c1', priority: '普通', today_minutes: 30, added_at: tx.at, carried: true },
      { card_id: 'c2', priority: '高', today_minutes: null, added_at: tx.at, carried: true },
    ];
    p.carried_confirmed = false;
    tx.savePlan(p);
  }, undefined, { action: 'test.direct' });

  await expect(handleApplicationRequest(f.ctx, {
    method: 'skip_task_item',
    arguments: { operation_id: crypto.randomUUID(), day: today, card_id: 'c1' },
  })).rejects.toThrow('CARRY_CONFIRMATION_REQUIRED');

  const carried = planMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'confirm_plan_carry',
    arguments: { operation_id: crypto.randomUUID(), day: today, keep_card_ids: ['c2'] },
  }));
  expect(carried.data.plan.carry_pending).toBe(false);
  expect(carried.data.plan.items.map(i => i.card_id)).toEqual(['c2']);
});

it('0.3.2 Module B & C: complete_task_item (todo & timebox finish_early & optional expected_state replay), keep_going, split, end_original_task, complete_task & reopen_task', async () => {
  const f = fixture();
  await seed(
    f,
    [
      card('c1', { task_id: 'main', content: '时间盒任务', type: '时间盒卡', timebox_minutes: 60, order: 1 }),
      card('c2', { task_id: 'main', content: '待做子任务', progress_note: '原笔记', order: 2 }),
      card('c3', { task_id: 'side', content: '支线事项', order: 3 }),
    ],
    [
      task('main'),
      { ...task('side'), slot: '支线', slot_index: 2, bet_ends_at: null },
    ],
  );

  // 1. Direct completion of 待做 sub-task without expected_state; later timer changes; same operation_id replays cleanly!
  const directDoneOpId = crypto.randomUUID();
  const directDone = completeTaskItemResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'complete_task_item',
    arguments: { operation_id: directDoneOpId, card_id: 'c2' },
  }));
  expect(directDone.data).toMatchObject({
    noop: false,
    stopped_timer: false,
    card: { id: 'c2', status: '已完成', progress_note: '原笔记' },
  });

  // Start c1
  const ctx1 = contextResult.parse(await handleApplicationRequest(f.ctx, { method: 'get_context', arguments: {} }));
  const started = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_task_item',
    arguments: { operation_id: ctx1.operation_id, expected_state: ctx1.expected_state, card_id: 'c1' },
  }));
  expect(started.data.timer.allowed_actions).toEqual(
    expect.arrayContaining(['complete_task_item', 'keep_going_task_item', 'split_task_item']),
  );

  // Replay directDoneOpId AFTER timer state changed — must succeed with replayed=true!
  const directReplay = completeTaskItemResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'complete_task_item',
    arguments: { operation_id: directDoneOpId, card_id: 'c2' },
  }));
  expect(directReplay.replayed).toBe(true);
  // Replay with an explicit expected_state when original had none -> OPERATION_CONFLICT
  await expect(handleApplicationRequest(f.ctx, {
    method: 'complete_task_item',
    arguments: { operation_id: directDoneOpId, expected_state: started.data.expected_state, card_id: 'c2' },
  })).rejects.toThrow('OPERATION_CONFLICT');

  // 2. Completing running c1 without expected_state -> STATE_REQUIRED; without finish_early -> TIMEBOX_NOT_REACHED
  f.clock(at(10));
  await expect(handleApplicationRequest(f.ctx, {
    method: 'complete_task_item',
    arguments: { operation_id: crypto.randomUUID(), card_id: 'c1' },
  })).rejects.toThrow('STATE_REQUIRED');

  await expect(handleApplicationRequest(f.ctx, {
    method: 'complete_task_item',
    arguments: { operation_id: crypto.randomUUID(), expected_state: started.data.expected_state, card_id: 'c1' },
  })).rejects.toThrow('TIMEBOX_NOT_REACHED');

  // 3. Pause c1 -> paused card still allows split_task_item and keep_going_task_item
  const paused = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'pause_timer',
    arguments: { operation_id: crypto.randomUUID(), expected_state: started.data.expected_state },
  }));
  expect(paused.data.timer.allowed_actions).toEqual(
    expect.arrayContaining(['complete_task_item', 'keep_going_task_item', 'split_task_item']),
  );

  const splitRes = splitTaskItemResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'split_task_item',
    arguments: {
      operation_id: crypto.randomUUID(),
      expected_state: paused.data.expected_state,
      card_id: 'c1',
      today_content: '今天前半',
      rest_content: '后面剩余',
      rest_minutes: 20,
    },
  }));
  expect(splitRes.data).toMatchObject({
    today_card_id: 'c1',
    today_content: '今天前半',
    rest_content: '后面剩余',
    today_minutes: 30,
    rest_minutes: 20,
  });

  const kept = keepGoingTaskItemResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'keep_going_task_item',
    arguments: {
      operation_id: crypto.randomUUID(),
      expected_state: splitRes.data.expected_state,
      card_id: 'c1',
      note: '先做到第 2 节',
    },
  }));
  expect(kept.data.card).toMatchObject({ id: 'c1', status: '待做', progress_note: '先做到第 2 节' });
  expect(kept.data.timer.mode).toBe('idle');

  // 4. Start c1 again, insert break, then end_original_task promotes break to ordinary free timer and releases c1 to 待做
  f.clock(at(12));
  const restarted = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_task_item',
    arguments: { operation_id: crypto.randomUUID(), expected_state: kept.data.expected_state, card_id: 'c1' },
  }));
  f.clock(at(15));
  const away = timerMutationResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'start_break',
    arguments: { operation_id: crypto.randomUUID(), expected_state: restarted.data.expected_state, activity: '接电话' },
  }));
  expect(away.data.timer.allowed_actions).toContain('end_original_task');
  f.clock(at(18));
  const endedOrig = endOriginalTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'end_original_task',
    arguments: { operation_id: crypto.randomUUID(), expected_state: away.data.expected_state },
  }));
  expect(endedOrig.data).toMatchObject({
    ended_card_id: 'c1',
    timer: { mode: 'running', open_entry: { description: '接电话', kind: '普通' } },
  });
  expect((await getCard(f, 'c1')).status).toBe('待做');

  // 5. Complete whole task `main` while free timer is running (does not touch timer -> expected_state optional!)
  const doneTask = completeTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'complete_task',
    arguments: { operation_id: crypto.randomUUID(), task_id: 'main' },
  }));
  expect(doneTask.data).toMatchObject({
    noop: false,
    stopped_timer: false,
    freed_slot: { slot: '主线', slot_index: 1 },
    task: { id: 'main', status: '已完成' },
  });
  expect(doneTask.data.affected_card_ids).toEqual(['c1', splitRes.data.rest_card_id]);

  // 6. get_task_details returns completion_id, reopen_mode=snapshot_batch, and batch flags
  const details = getTaskDetailsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_task_details',
    arguments: { task_id: 'main' },
  }));
  expect(details.task).toMatchObject({
    id: 'main',
    status: '已完成',
    completion_id: doneTask.data.completion_id,
    reopen_mode: 'snapshot_batch',
    reopen_card_ids: ['c1', splitRes.data.rest_card_id],
    slot_full: false,
  });
  // Passing completion_id: null (--legacy) when snapshot exists must reject TASK_COMPLETION_CHANGED
  await expect(handleApplicationRequest(f.ctx, {
    method: 'reopen_task',
    arguments: { operation_id: crypto.randomUUID(), task_id: 'main', completion_id: null },
  })).rejects.toThrow('TASK_COMPLETION_CHANGED');

  // Reopen task with completion_id restores only batch items (c2 stays 已完成)
  const reopenedTask = reopenTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'reopen_task',
    arguments: { operation_id: crypto.randomUUID(), task_id: 'main', completion_id: doneTask.data.completion_id },
  }));
  expect(reopenedTask.data).toMatchObject({
    noop: false,
    reopen_mode: 'snapshot_batch',
    reopened_card_ids: ['c1', splitRes.data.rest_card_id],
    task: { id: 'main', status: '进行中', slot_index: 1, open_card_count: 2 },
  });
  expect((await getCard(f, 'c2')).status).toBe('已完成');

  // Reopen single item c2 via reopen_task_item
  const reopenedC2 = reopenTaskItemResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'reopen_task_item',
    arguments: { operation_id: crypto.randomUUID(), card_id: 'c2' },
  }));
  expect(reopenedC2.data).toMatchObject({
    noop: false,
    reopened_parent_task: false,
    card: { id: 'c2', status: '待做', progress_note: '原笔记' },
    task: { id: 'main', open_card_count: 3 },
  });
});

it('0.3.2 Module C & D: reopen_idea, get_recap (bucket validation & cached computed_at), and list_operation_history filtering', async () => {
  const f = fixture();
  await seed(f, []);
  await createProject(f.ctx, '研发', at());

  const saved = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'save_idea',
    arguments: { operation_id: crypto.randomUUID(), text: '可恢复的想法' },
    origin: { kind: 'mcp', agent: { name: 'Cursor', version: '1.0', detected_by: 'clientInfo' } },
  }));
  await handleApplicationRequest(f.ctx, {
    method: 'complete_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: saved.data.id },
    origin: { kind: 'cli', agent: { name: 'Codex', detected_by: 'env' } },
  });

  const reopenedIdea = reopenIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'reopen_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: saved.data.id },
    origin: { kind: 'cli', agent: { name: 'Codex', detected_by: 'env' } },
  }));
  expect(reopenedIdea.data).toEqual({ id: saved.data.id, text: '可恢复的想法', pool: '活跃池', noop: false });
  const noopIdea = reopenIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'reopen_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: saved.data.id },
  }));
  expect(noopIdea.data.noop).toBe(true);

  f.clock(at(35));
  await handleApplicationRequest(f.ctx, {
    method: 'add_time_entry',
    arguments: {
      operation_id: crypto.randomUUID(),
      description: '写自动化测试',
      start: at(0),
      end: at(30),
      project: '研发',
      tags: ['测试'],
    },
  });

  const recap = getRecapResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_recap',
    arguments: { period: 'week', dimension: 'project' },
  }));
  expect(recap.computed_at).toBe(at(35));
  expect(recap.effective_ms).toBe(30 * 60000);
  expect(recap.groups.map(g => g.key)).toContain('研发');

  await expect(handleApplicationRequest(f.ctx, {
    method: 'get_recap',
    arguments: { period: 'week', dimension: 'project', bucket: 'non-existent-bucket' },
  })).rejects.toThrow('INVALID_BUCKET');

  const history = listOperationHistoryResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'list_operation_history',
    arguments: { source: 'all_automation', agent: 'Codex', method: 'reopen_idea' },
  }));
  expect(history.records).toHaveLength(1);
  expect(history.records[0]).toMatchObject({
    action: 'auto.reopen_idea',
    method: 'reopen_idea',
    subject: { type: 'record', id: saved.data.id },
  });
});

it('0.3.3 ADR 0026 & ADR 0029: create_idea, get_idea_details, update_idea, create_task, convert_idea_to_task, legacy multiline C(title,details), and durable receipt replay', async () => {
  const f = fixture();
  await seed(f, []);
  await createProject(f.ctx, '学习', at(0));

  // 1. Legacy save_idea multiline sample: data.text echoes full multiline, stored as title + first-LF details, find_items matches body
  const legacySaved = saveIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'save_idea',
    arguments: {
      operation_id: crypto.randomUUID(),
      text: '看视频\n稍后看 https://example.com/a\n#服务器',
    },
  }));
  expect(legacySaved.data.text).toBe('看视频\n稍后看 https://example.com/a\n#服务器');
  expect(legacySaved.data.tags).toEqual(['服务器']);

  const legacyDoc = getIdeaDetailsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_idea_details',
    arguments: { idea_id: legacySaved.data.id },
  }));
  expect(legacyDoc.idea.title).toBe('看视频');
  expect(legacyDoc.idea.details_markdown).toBe('\n稍后看 https://example.com/a\n#服务器');
  expect(legacyDoc.idea.has_details).toBe(true);

  const foundLegacy = findItemsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'find_items',
    arguments: { kind: 'idea', query: '稍后看' },
  }));
  expect(foundLegacy.ideas).toHaveLength(1);
  expect(foundLegacy.ideas[0].text).toBe('看视频\n稍后看 https://example.com/a\n#服务器');

  // Legacy complete_idea / reopen_idea also return compatible full text C(title, details)
  const completedLegacy = completeIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'complete_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: legacySaved.data.id },
  }));
  expect(completedLegacy.data.text).toBe('看视频\n稍后看 https://example.com/a\n#服务器');
  const reopenedLegacy = reopenIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'reopen_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: legacySaved.data.id },
  }));
  expect(reopenedLegacy.data.text).toBe('看视频\n稍后看 https://example.com/a\n#服务器');

  // 2. create_idea + get_idea_details + update_idea (preserve / clear / RECORD_CHANGED / replay)
  const createOpId = crypto.randomUUID();
  const created = createIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'create_idea',
    arguments: {
      operation_id: createOpId,
      title: '多主线架构演进 #架构',
      details_markdown: '## 阶段目标\r\n- 拆分标题与详情 #存储\r\n- 支持独立窗口',
      needs: ' 整块下午 ',
    },
  }));
  expect(created.data.idea).toMatchObject({
    title: '多主线架构演进 #架构',
    tags: ['架构', '存储'],
    needs: '整块下午',
    has_details: true,
    pool: '活跃池',
  });
  const rev1 = created.data.idea.record_revision;
  expect(rev1).toMatch(/^ir3:[0-9a-f]{64}$/);

  const details1 = getIdeaDetailsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_idea_details',
    arguments: { idea_id: created.data.idea.id },
  }));
  expect(details1.idea.details_markdown).toBe('## 阶段目标\n- 拆分标题与详情 #存储\n- 支持独立窗口');
  expect(details1.idea.record_revision).toBe(rev1);

  // Title-only update preserves details_markdown and non-first-line #存储 tag!
  const updateOpId = crypto.randomUUID();
  const updated1 = updateIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: updateOpId,
      idea_id: created.data.idea.id,
      record_revision: rev1,
      title: '多主线架构演进 v2 #架构',
    },
  }));
  expect(updated1.data.noop).toBe(false);
  expect(updated1.data.idea.title).toBe('多主线架构演进 v2 #架构');
  expect(updated1.data.idea.tags).toEqual(['架构', '存储']);
  expect(updated1.data.idea.has_details).toBe(true);
  const rev2 = updated1.data.idea.record_revision;
  expect(rev2).not.toBe(rev1);

  // Stale rev1 rejected with RECORD_CHANGED and latest_context.idea summary
  await expect(handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: crypto.randomUUID(),
      idea_id: created.data.idea.id,
      record_revision: rev1,
      title: '过期修订写入',
    },
  })).rejects.toMatchObject({
    failure: {
      code: 'RECORD_CHANGED',
      category: 'not_executed',
      latest_context: {
        idea: expect.objectContaining({ id: created.data.idea.id, record_revision: rev2 }),
      },
    },
  });

  // Replay updateOpId with original rev1 succeeds with replayed=true even though current revision is rev2!
  const replayedUpdate = updateIdeaResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: updateOpId,
      idea_id: created.data.idea.id,
      record_revision: rev1,
      title: '多主线架构演进 v2 #架构',
    },
  }));
  expect(replayedUpdate.replayed).toBe(true);
  expect(replayedUpdate.data.idea.record_revision).toBe(rev2);

  // Same updateOpId with different title -> OPERATION_CONFLICT
  await expect(handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: updateOpId,
      idea_id: created.data.idea.id,
      record_revision: rev1,
      title: '篡改标题',
    },
  })).rejects.toThrow('OPERATION_CONFLICT');

  // 3. create_task: 2 coexisting main tasks (default mainTasks = 2), 3rd rejected with TASK_CAPACITY_FULL
  const task1Res = createTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'create_task',
    arguments: {
      operation_id: crypto.randomUUID(),
      name: '主线一：核心存储',
      slot: '主线',
      default_project: '学习',
      items: [
        { content: '实现 v3 迁移', type: '结果卡', timebox_minutes: null },
        { content: '压测 1000 条记录', type: '时间盒卡', timebox_minutes: 45 },
      ],
    },
  }));
  expect(task1Res.data.task).toMatchObject({ name: '主线一：核心存储', slot: '主线', slot_index: 1, status: '进行中', default_project: '学习' });
  expect(task1Res.data.created_card_ids).toHaveLength(2);

  const task2Res = createTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'create_task',
    arguments: {
      operation_id: crypto.randomUUID(),
      name: '主线二：独立窗口',
      slot: '主线',
    },
  }));
  expect(task2Res.data.task).toMatchObject({ name: '主线二：独立窗口', slot: '主线', slot_index: 2, status: '进行中' });
  expect(task2Res.data.created_card_ids).toEqual([]);

  // 3rd main task rejected with TASK_CAPACITY_FULL and task_capacity context
  await expect(handleApplicationRequest(f.ctx, {
    method: 'create_task',
    arguments: {
      operation_id: crypto.randomUUID(),
      name: '主线三：超限',
      slot: '主线',
    },
  })).rejects.toMatchObject({
    failure: {
      code: 'TASK_CAPACITY_FULL',
      category: 'not_executed',
      latest_context: {
        task_capacity: {
          slot: '主线',
          limit: 2,
          active_tasks: [
            { id: task1Res.data.task.id, name: '主线一：核心存储' },
            { id: task2Res.data.task.id, name: '主线二：独立窗口' },
          ],
        },
      },
    },
  });

  // 4. convert_idea_to_task into explicit 2nd main task (task2Res.data.task.id): preserves idea details & creates typed items
  const convertOpId = crypto.randomUUID();
  const converted = convertIdeaToTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'convert_idea_to_task',
    arguments: {
      operation_id: convertOpId,
      idea_id: created.data.idea.id,
      record_revision: rev2,
      target: { kind: 'existing_task', task_id: task2Res.data.task.id },
      items: [
        { content: '多主线架构演进 v2 #架构', type: '结果卡', timebox_minutes: null },
        { content: '验证跨窗口修订同步', type: '时间盒卡', timebox_minutes: 30 },
      ],
    },
  }));
  expect(converted.data.created_new_task).toBe(false);
  expect(converted.data.task.id).toBe(task2Res.data.task.id);
  expect(converted.data.idea.pool).toBe('已转任务');
  expect(converted.data.idea.has_details).toBe(true);
  expect(converted.data.created_card_ids).toHaveLength(2);

  // Original idea details remain intact after conversion, and card content only contains the single-line item!
  const detailsAfterConvert = getIdeaDetailsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'get_idea_details',
    arguments: { idea_id: created.data.idea.id },
  }));
  expect(detailsAfterConvert.idea.details_markdown).toBe('## 阶段目标\n- 拆分标题与详情 #存储\n- 支持独立窗口');
  const firstCreatedCard = await getCard(f, converted.data.created_card_ids[0]);
  expect(firstCreatedCard.content).toBe('多主线架构演进 v2 #架构');
  expect(firstCreatedCard.task_id).toBe(task2Res.data.task.id);

  // Replaying convertOpId after task is completed still returns original receipt without re-executing!
  await handleApplicationRequest(f.ctx, {
    method: 'complete_task',
    arguments: { operation_id: crypto.randomUUID(), task_id: task2Res.data.task.id },
  });
  const replayedConvert = convertIdeaToTaskResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'convert_idea_to_task',
    arguments: {
      operation_id: convertOpId,
      idea_id: created.data.idea.id,
      record_revision: rev2,
      target: { kind: 'existing_task', task_id: task2Res.data.task.id },
      items: [
        { content: '多主线架构演进 v2 #架构', type: '结果卡', timebox_minutes: null },
        { content: '验证跨窗口修订同步', type: '时间盒卡', timebox_minutes: 30 },
      ],
    },
  }));
  expect(replayedConvert.replayed).toBe(true);
  expect(replayedConvert.data).toEqual(converted.data);
});

it('0.3.3 A1–A3: find_items serializes detail reads against concurrent writers, surfaces missing details explicitly, and create_idea/create_task replay receipts before domain checks', async () => {
  const f = fixture();
  await seed(f, []);

  const createOpId = crypto.randomUUID();
  const createReq = {
    method: 'create_idea',
    arguments: { operation_id: createOpId, title: '标题A #旧', details_markdown: '正文A' },
  };
  const created = createIdeaResult.parse(await handleApplicationRequest(f.ctx, createReq));
  const id = created.data.idea.id;

  // A1: find_items holds readSerial queue turn across detail reads so concurrent writer cannot commit mid-read
  const repo = f.ctx.repos.records;
  const origGetDetails = repo.getDetails.bind(repo);
  let announceRead!: () => void;
  let releaseRead!: () => void;
  const reading = new Promise<void>(r => { announceRead = r; });
  const gate = new Promise<void>(r => { releaseRead = r; });
  vi.spyOn(repo, 'getDetails').mockImplementationOnce(async target => {
    announceRead();
    await gate;
    return origGetDetails(target);
  });

  const pendingFind = handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea' } });
  await reading;
  let writerCommitted = false;
  const writer = handleApplicationRequest(f.ctx, {
    method: 'update_idea',
    arguments: {
      operation_id: crypto.randomUUID(),
      idea_id: id,
      record_revision: created.data.idea.record_revision,
      title: '标题B #新',
      details_markdown: '正文B',
    },
  }).then(res => { writerCommitted = true; return res; });
  await new Promise<void>(r => setTimeout(r, 0));
  expect(writerCommitted).toBe(false);
  releaseRead();
  const [foundRaw, updatedRaw] = await Promise.all([pendingFind, writer]);
  const foundItem = findItemsResult.parse(foundRaw).ideas[0];
  expect(foundItem.text).toBe('标题A #旧\n正文A');
  expect(foundItem.tags).toEqual(['旧']);
  const updated = updateIdeaResult.parse(updatedRaw);
  expect(updated.data.idea.title).toBe('标题B #新');

  // A2: Missing details in find_items / complete_idea / reopen_idea fails explicitly instead of returning empty body
  vi.spyOn(repo, 'getDetails').mockResolvedValueOnce(null);
  await expect(handleApplicationRequest(f.ctx, { method: 'find_items', arguments: { kind: 'idea' } })).rejects.toThrow('IDEA_DETAILS_MISSING');
  vi.spyOn(repo, 'getDetails').mockResolvedValueOnce(null);
  await expect(handleApplicationRequest(f.ctx, {
    method: 'complete_idea',
    arguments: { operation_id: crypto.randomUUID(), idea_id: id },
  })).rejects.toThrow(/IDEA_DETAILS_MISSING|External edit/);

  // A3: create_idea replays original receipt even after idea was edited and removed
  await run(f.ctx, async tx => { tx.removeRecord(id); }, undefined, { action: 'test.direct' });
  const replayedCreate = createIdeaResult.parse(await handleApplicationRequest(f.ctx, createReq));
  expect(replayedCreate.replayed).toBe(true);
  expect(replayedCreate.data).toEqual(created.data);
  expect(await repo.get(id)).toBeNull();
});
