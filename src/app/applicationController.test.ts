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
  contextResult,
  findItemsResult,
  listTimeEntriesResult,
  lookupResult,
  saveIdeaResult,
  timeSummaryResult,
  timerMutationResult,
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
  expect((await f.ctx.repos.records.get(result.id))!.value).toMatchObject({ kind: '想法', needs: '减少遗忘', attachments: [], card_id: null });
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
  expect(f.ctx.snapshot()!.backpack.ideas).toContainEqual(expect.objectContaining({ id: result.id, text: result.text }));
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
  expect(todo1.data).toMatchObject({
    slot: '支线',
    content: '复习操作系统进程调度 #408',
    tags: ['408'],
    blocking: true,
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
  const during = findItemsResult.parse(await handleApplicationRequest(f.ctx, {
    method: 'find_items',
    arguments: { kind: 'idea', query: '未完成提交的想法' },
  }));
  expect(during.ideas).toEqual([]);

  releaseReceipt();
  const failedOutcome = await pendingSave;
  expect('error' in failedOutcome).toBe(true);
  if ('error' in failedOutcome) {
    expect(failedOutcome.error).toBeInstanceOf(ApplicationError);
    const structured = (failedOutcome.error as ApplicationError).failure;
    expect(structured).toMatchObject({ status: 'error', code: 'JOURNAL_BLOCKED', category: 'result_unknown' });
  }

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
