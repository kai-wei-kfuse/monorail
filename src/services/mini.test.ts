import { expect, it, vi } from 'vitest';
import { fixture, at, card, seed, task, open, entries, getCard } from './serviceFixture';
import { startFree, startCard, pause, beginPending, cancelPending, commitReadout, dispatchMiniCommand } from './homeService';
import { change } from './settingsService';
import { projectMini } from './miniProjection';
import { connectMini } from './miniController';
import { run } from './commit';
import { miniCommandSchema, decodeMiniCommand, miniUnresponsive, MINI_HEARTBEAT_MS } from '../platform/windowBus';
import type { MainWindowBus, MiniCommand, MiniMessage, MiniReply } from '../platform/windowBus';

const value = { description: 'A', project: '学习', tags: [] };
function seen(f: ReturnType<typeof fixture>) {
  const snapshot = projectMini(f.ctx.snapshot()!, f.ctx.mainEpoch);
  return { requestId: crypto.randomUUID(), at: f.ctx.now(), entryId: snapshot.entryId, cardId: snapshot.cardId, epoch: snapshot.epoch };
}
function editSeen(f: ReturnType<typeof fixture>) { return { ...seen(f), revision: f.home().dataVersion }; }
it('schema validates timestamps, action-specific identities and full readout plans before dispatch', () => {
  const base = { requestId: 'r', at: at(), entryId: 'e', cardId: null, epoch: 0 };
  expect(miniCommandSchema.safeParse({ ...base, type: 'pause' }).success).toBe(true);
  for (const command of [{ ...base, type: 'complete' }, { ...base, type: 'beginPending' }, { ...base, epoch: undefined, type: 'pause' },
    { ...base, type: 'editOpen', patch: {} }, { ...base, at: 'tomorrow', type: 'pause' }, { ...base, type: 'pause', other: true }])
    expect(decodeMiniCommand(command)).toMatchObject({ requestId: 'r', error: expect.any(String) });
});
it('late pause/edit/complete commands for A reject after switching to B, without writing', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't' }), card('b', { task_id: 't' })], [task('t')]);
  await startCard(f.ctx, 'a', at());
  const base = seen(f), edit = editSeen(f);
  f.clock(at(10)); await startCard(f.ctx, 'b', at(10)); const current = open(f), before = entries(f);
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  const commands: MiniCommand[] = [{ ...base, type: 'pause' }, { ...base, type: 'complete', cardId: 'a' },
    { ...edit, type: 'editCard', cardId: 'a', content: '错误修改' }];
  for (const command of commands) await expect(dispatchMiniCommand(f.ctx, command)).rejects.toThrow('已经换成');
  expect(open(f)).toEqual(current); expect(entries(f)).toEqual(before); expect(transact).not.toHaveBeenCalled();
});
it('target validation runs inside the queue, not before the previous command commits', async () => {
  const f = fixture(); await startFree(f.ctx, value, at()); const old = seen(f);
  f.clock(at(10)); const switchToB = startFree(f.ctx, { ...value, description: 'B' }, at(10));
  const stale = dispatchMiniCommand(f.ctx, { ...old, type: 'pause' });
  await switchToB; await expect(stale).rejects.toThrow('已经换成'); expect(open(f).description).toBe('B');
});
it('editing requires revision, but unrelated commits do not invalidate same-session cancellation', async () => {
  const f = fixture(); await startFree(f.ctx, value, at());
  const old: MiniCommand = { ...editSeen(f), type: 'editOpen', pending_id: null, patch: { description: '过时' } };
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  await expect(dispatchMiniCommand(f.ctx, old)).rejects.toThrow('已经换成');
  await beginPending(f.ctx, at()); const pending = f.home().pending!.id, target = seen(f);
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  await dispatchMiniCommand(f.ctx, { ...target, type: 'cancelPending', pending_id: pending });
  expect(f.home().pending).toBeNull();
});
it('an old pending ID cannot cancel or change the next session even when its start is identical', async () => {
  const f = fixture(); await beginPending(f.ctx, at()); const first = f.home().pending!.id, base = seen(f);
  await cancelPending(f.ctx, first, at()); f.clock(at(5)); await beginPending(f.ctx, at(5));
  const second = f.home().pending!.id;
  await commitReadout(f.ctx, { target: { mode: 'pending', id: second }, milliseconds: 300000, at: at(5) }, null);
  expect(f.home().pending!.startedAt).toBe(at());
  await expect(dispatchMiniCommand(f.ctx, { ...base, type: 'cancelPending', pending_id: first })).rejects.toThrow('已经换成');
  await expect(dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'setReadout', pending_id: first,
    target: { mode: 'pending', id: first }, milliseconds: 0, seen: null })).rejects.toThrow('已经换成');
  expect(f.home().pending!.id).toBe(second);
});
it('mini pause/edit card/resume uses current card metadata and complete only requests the main dialog', async () => {
  const f = fixture(); await seed(f, [card('c', { task_id: 't' })], [task('t')]); await startCard(f.ctx, 'c', at()); f.clock(at(10));
  await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'pause' });
  await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'editCard', cardId: 'c', content: '新卡', project: '工作', tags: ['新'] });
  await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'resume' });
  expect(open(f)).toMatchObject({ description: '新卡', project: '工作', tags: ['新'], card_id: 'c' });
  expect(await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'complete', cardId: 'c' })).toEqual({ kind: 'complete', cardId: 'c', at: at(10) });
  expect((await getCard(f, 'c')).status).toBe('进行中');
});
it('mini pending input starts at the pending anchor and readout uses the same preview/confirm flow', async () => {
  const f = fixture(); await startFree(f.ctx, value, at()); f.clock(at(10));
  await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'beginPending', pending_id: null });
  f.clock(at(20)); await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'editOpen', pending_id: f.home().pending!.id,
    patch: { description: 'B', project: '工作', tags: [] } });
  expect(open(f).started_at).toBe(at(10));
  const request = { ...editSeen(f), type: 'setReadout' as const, pending_id: null,
    target: { mode: 'entry' as const, id: open(f).id }, milliseconds: 15 * 60000, seen: null };
  const before = entries(f); const preview = await dispatchMiniCommand(f.ctx, request);
  expect(preview.kind).toBe('confirm'); expect(entries(f)).toEqual(before);
  if (preview.kind !== 'confirm') throw new Error('expected confirmation');
  await dispatchMiniCommand(f.ctx, { ...request, revision: f.home().dataVersion, seen: preview.plan });
  expect(open(f).started_at).toBe(at(5));
});
it('controller replies with fresh snapshots after rejection and heartbeats do not write or advance revision', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); await startFree(f.ctx, value, at());
    let command!: (message: MiniMessage) => void;
    let resolveReply!: (reply: MiniReply) => void;
    const replied = new Promise<MiniReply>(resolve => { resolveReply = resolve; });
    const off = vi.fn(), push = vi.fn(async () => {});
    const bus: MainWindowBus = { onCommand: async fn => { command = fn; return off; }, onReady: async () => off, push,
      reply: async reply => { resolveReply(reply); } };
    const effects = { openMain: vi.fn(async () => {}), complete: vi.fn(async () => {}), report: vi.fn() };
    const stop = await connectMini(f.ctx, bus, effects, MINI_HEARTBEAT_MS);
    const old = seen(f); f.clock(at(10)); await startFree(f.ctx, { ...value, description: 'B' }, at(10));
    command({ command: { ...old, type: 'pause' } });
    expect((await replied).outcome).toMatchObject({ kind: 'error', message: '已经换成别的事了' });
    await Promise.resolve(); expect(push.mock.calls.at(-1)).toEqual([expect.objectContaining({ entry: expect.objectContaining({ description: 'B' }) })]);
    const revision = f.home().dataVersion, writes = vi.spyOn(f.ctx.repos, 'transact');
    await vi.advanceTimersByTimeAsync(4000); expect(writes).not.toHaveBeenCalled(); expect(f.home().dataVersion).toBe(revision);
    stop(); const count = push.mock.calls.length; await vi.advanceTimersByTimeAsync(2000); expect(push).toHaveBeenCalledTimes(count);
    expect(off).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it('unresponsive status follows received heartbeats, including startup without any snapshot', () => {
  expect(miniUnresponsive(null, 1000, 4000)).toBe(false);
  expect(miniUnresponsive(null, 1000, 4001)).toBe(true);
  expect(miniUnresponsive(3500, 1000, 4001)).toBe(false);
});
it('controller focuses main before opening the completion dialog with the original click time', async () => {
  const f = fixture(); await seed(f, [card('c')]); await startCard(f.ctx, 'c', at());
  let receive!: (message: MiniMessage) => void;
  let replied!: () => void; const done = new Promise<void>(resolve => { replied = resolve; });
  const calls: string[] = [];
  const bus: MainWindowBus = { onCommand: async fn => { receive = fn; return () => {}; }, onReady: async () => () => {},
    push: async () => {}, reply: async () => { replied(); } };
  const stop = await connectMini(f.ctx, bus, { openMain: async () => { calls.push('open'); },
    complete: async (id, time) => { calls.push(`${id}:${time}`); }, report: error => { throw error; } }, MINI_HEARTBEAT_MS);
  try {
    receive({ command: { ...seen(f), type: 'complete', cardId: 'c' } }); await done;
    expect(calls).toEqual(['open', `c:${at()}`]); expect((await getCard(f, 'c')).status).toBe('进行中');
  } finally { stop(); }
});
it('native effect failures return an error reply instead of leaving the mini command unresolved', async () => {
  const f = fixture(); await startFree(f.ctx, value, at());
  let receive!: (message: MiniMessage) => void;
  let replied!: (value: MiniReply) => void; const done = new Promise<MiniReply>(resolve => { replied = resolve; });
  const bus: MainWindowBus = { onCommand: async fn => { receive = fn; return () => {}; }, onReady: async () => () => {},
    push: async () => {}, reply: async value => { replied(value); } };
  const stop = await connectMini(f.ctx, bus, { openMain: async () => { throw new Error('window failed'); },
    complete: async () => {}, report: error => { throw error; } }, MINI_HEARTBEAT_MS);
  try {
    receive({ command: { ...seen(f), type: 'openMain' } });
    expect((await done).outcome).toEqual({ kind: 'error', message: 'window failed' });
  } finally { stop(); }
});
it('projects miniMode from settings onto MiniSnapshot', async () => {
  const f = fixture(); await startFree(f.ctx, value, at());
  expect(projectMini(f.ctx.snapshot()!, 0).miniMode).toBe('mini');
  await change(f.ctx, 'miniMode', 'tiny', at(5));
  expect(projectMini(f.ctx.snapshot()!, 0).miniMode).toBe('tiny');
});
it('idle and pending setReadout preview overlapping entries before committing and reject if idle state changed', async () => {
  const f = fixture(); await seed(f, []);
  await startFree(f.ctx, { description: '专注', project: '学习', tags: [] }, at(0));
  f.clock(at(50)); await pause(f.ctx, at(50));
  f.clock(at(60));
  const idleEntry = open(f);
  expect(idleEntry.project).toBe('待机');
  // 10 分钟落在 50..60 的待机段内，无重叠，直接进入待确认
  const withinIdle = await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'setReadout', pending_id: null,
    target: { mode: 'idle', id: idleEntry.id }, milliseconds: 5 * 60000, seen: null });
  expect(withinIdle.kind).toBe('done');
  expect(f.home().pending).toMatchObject({ startedAt: at(55) });
  // Once pending has started, another idle setReadout for the old idle state must reject
  await expect(dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'setReadout', pending_id: f.home().pending!.id,
    target: { mode: 'idle', id: idleEntry.id }, milliseconds: 10 * 60000, seen: null })).rejects.toThrow('已经换成');
  // 取消待确认回到待机，再把读数改成 30 分钟（会覆盖专注 0..50 的后 20 分钟），必须先返回 confirm 预览
  await cancelPending(f.ctx, f.home().pending!.id, at(60));
  const overlapReq = { ...editSeen(f), type: 'setReadout' as const, pending_id: null,
    target: { mode: 'idle' as const, id: idleEntry.id }, milliseconds: 30 * 60000, seen: null };
  const preview = await dispatchMiniCommand(f.ctx, overlapReq);
  expect(preview.kind).toBe('confirm');
  expect(f.home().pending).toBeNull();
  if (preview.kind !== 'confirm') throw new Error('expected confirmation');
  expect(preview.hit).toEqual([expect.objectContaining({ description: '专注', from: at(30), to: at(50) })]);
  const confirmed = await dispatchMiniCommand(f.ctx, { ...overlapReq, revision: f.home().dataVersion, seen: preview.plan });
  expect(confirmed.kind).toBe('done');
  expect(f.home().pending).toMatchObject({ startedAt: at(30) });
});
it('a command from an older main-window session is rejected with a fresh snapshot and writes nothing (D4)', async () => {
  const f = fixture(); await startFree(f.ctx, value, at());
  // 主窗口重载后的新 Ctx：世代 5；小窗手里还是世代 4 那份快照发起的命令
  const reloaded = { ...f, ctx: (await import('./commit')).createContext({ ...f.ctx, mainEpoch: 5 }) };
  await run(reloaded.ctx, async () => {}, undefined, { action: 'test.direct' });
  let receive!: (message: MiniMessage) => void;
  let replied!: (value: MiniReply) => void; const done = new Promise<MiniReply>(resolve => { replied = resolve; });
  const push = vi.fn(async () => {});
  const bus: MainWindowBus = { onCommand: async fn => { receive = fn; return () => {}; }, onReady: async () => () => {},
    push, reply: async value => { replied(value); } };
  const stop = await connectMini(reloaded.ctx, bus, { openMain: async () => {}, complete: async () => {}, report: error => { throw error; } }, MINI_HEARTBEAT_MS);
  try {
    const before = entries(reloaded), transact = vi.spyOn(reloaded.ctx.repos, 'transact');
    const stale = { ...seen(reloaded), epoch: 4 };
    receive({ command: { ...stale, type: 'pause' } });
    expect((await done).outcome).toEqual({ kind: 'error', message: '主窗口已重新载入，请再操作一次' });
    await Promise.resolve();
    expect(push.mock.calls.at(-1)).toEqual([expect.objectContaining({ epoch: 5 })]);
    expect(transact).not.toHaveBeenCalled(); expect(entries(reloaded)).toEqual(before);
  } finally { stop(); }
});

// ===== 0.3.0-beta.4 D1：小窗自动完成与写新事件 =====
it('D1 snapshot carries favorites, todo cards and deduplicated recent entries, cached per published snapshot', async () => {
  const f = fixture(); await seed(f, [card('k1', { task_id: 't', content: '沿 [Python] 往下学' }), card('k2', { task_id: 't', status: '已完成' })], [task('t')]);
  f.ctx.settings.lists.presets = [{ id: 'fav', name: '背单词', project: '学习', tags: ['英语'], mode: '切换', place: '计时条' },
    { id: 'wc', name: '厕所', project: '生活', tags: [], mode: '插入', place: '弹层' }];
  f.clock(at(1)); await startFree(f.ctx, { description: '回邮件', project: '工作', tags: [] }, at(1));
  f.clock(at(2)); await startFree(f.ctx, { description: '午休', project: '休息', tags: [] }, at(2));
  f.clock(at(3)); await startFree(f.ctx, { description: '回邮件', project: '工作', tags: ['新'] }, at(3));
  const snapshot = f.ctx.snapshot()!;
  const mini = projectMini(snapshot, 0);
  expect(mini.suggest.favorites).toEqual([{ id: 'fav', name: '背单词', project: '学习', tags: ['英语'] }]);
  expect(mini.suggest.cards).toEqual([{ id: 'k1', content: '沿 Python 往下学', track: '主线' }]);
  // 同名只留最新；休息、待机不列
  expect(mini.suggest.recent.map(r => [r.description, r.tags])).toEqual([['回邮件', ['新']]]);
  expect(projectMini(snapshot, 0).suggest).toEqual(mini.suggest);
});
it('D1 recent entries sent to the mini window are capped after deduplication', async () => {
  const f = fixture(); await seed(f, []);
  for (let n = 0; n < 105; n++) { f.clock(at(n)); await startFree(f.ctx, { description: `事${n}`, project: '工作', tags: [] }, at(n)); }
  const recent = projectMini(f.ctx.snapshot()!, 0).suggest.recent;
  expect(recent).toHaveLength(100);
  expect(recent[0].description).toBe('事104');
});
it('D1 picking a favorite, a card or a recent entry while writing starts it at the pending anchor', async () => {
  const f = fixture(); await seed(f, [card('k', { task_id: 't', content: '写接口' })], [task('t')]);
  f.ctx.settings.lists.presets = [{ id: 'fav', name: '背单词', project: '学习', tags: ['英语'], mode: '切换', place: '计时条' }];
  await startFree(f.ctx, { description: '回邮件', project: '工作', tags: ['邮件'] }, at());
  const mailId = open(f).id;
  // 收藏
  f.clock(at(10)); await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'beginPending', pending_id: null });
  f.clock(at(12)); await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'startFavorite', pending_id: f.home().pending!.id, presetId: 'fav' });
  expect(open(f)).toMatchObject({ description: '背单词', project: '学习', tags: ['英语'], started_at: at(10) });
  expect(f.home().pending).toBeNull();
  // 最近的记录：照抄描述、项目、标签另起一条
  f.clock(at(20)); await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'beginPending', pending_id: null });
  f.clock(at(21)); await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'continueEntry', pending_id: f.home().pending!.id, targetEntryId: mailId });
  expect(open(f)).toMatchObject({ description: '回邮件', project: '工作', tags: ['邮件'], started_at: at(20) });
  expect(open(f).id).not.toBe(mailId);
  // 待做的卡
  f.clock(at(30)); await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'beginPending', pending_id: null });
  f.clock(at(31)); await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'startCard', pending_id: f.home().pending!.id, targetCardId: 'k' });
  expect(open(f)).toMatchObject({ card_id: 'k', started_at: at(30) });
  expect((await getCard(f, 'k')).status).toBe('进行中');
});
it('D1 suggestion commands keep identity checks: stale revision or pending session is rejected without writing; non-todo cards are refused', async () => {
  const f = fixture(); await seed(f, [card('k', { task_id: 't' })], [task('t')]);
  f.ctx.settings.lists.presets = [{ id: 'fav', name: '背单词', project: '学习', tags: [], mode: '切换', place: '计时条' }];
  await beginPending(f.ctx, at()); const stale = { ...editSeen(f), pending_id: f.home().pending!.id };
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  await expect(dispatchMiniCommand(f.ctx, { ...stale, type: 'startFavorite', presetId: 'fav' })).rejects.toThrow('已经换成');
  expect(transact).not.toHaveBeenCalled();
  await startCard(f.ctx, 'k', at(1)); transact.mockClear();
  await beginPending(f.ctx, at(2));
  await expect(dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'startCard', pending_id: f.home().pending!.id, targetCardId: 'k' })).rejects.toThrow('不在待做');
});
it('D1 writing a new event carries the chosen category; @project in the name wins (MiniApp sends it in editOpen.patch)', async () => {
  const f = fixture(); await startFree(f.ctx, value, at()); f.clock(at(10));
  await dispatchMiniCommand(f.ctx, { ...seen(f), type: 'beginPending', pending_id: null });
  await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'editOpen', pending_id: f.home().pending!.id, patch: { description: '写方案', project: '工作', tags: [] } });
  expect(open(f)).toMatchObject({ description: '写方案', project: '工作', started_at: at(10) });
});

// ===== 0.3.2 ADR 0024 v1.2：跨主窗、小窗显式插入与内存草稿协调器 =====
it('ADR 0024: explicit insert works on running/paused card and free timer (even when taskMode is false), truncates at click time and records home.insertExplicit', async () => {
  const { createInsertDraftCoordinator } = await import('./insertDraftCoordinator');
  const { resume } = await import('./homeService');
  const f = fixture();
  f.ctx.settings.lists.projects = [{ name: '工作', color: '#7c5cff' }, { name: '学习', color: '#1aa3ff' }, { name: '生活', color: '#3cbf7a' }];
  f.ctx.settings.taskMode = false;
  await seed(f, []);
  await startFree(f.ctx, { description: '写周报', project: '工作', tags: [] }, at(0));
  const origId = open(f).id;
  const coord = createInsertDraftCoordinator(f.ctx);
  try {
    // 同毫秒点击明确拒绝，不建草稿
    await expect(coord.begin({ owner: 'main', ownerSession: 's-main', at: at(0) })).rejects.toThrow('原计时刚开始或时刻已变化');
    expect(coord.current()).toBeNull();

    // t=5 点下插入事件，t=12 才按回车提交：起点固定在 t=5
    f.clock(at(5));
    const draft = await coord.begin({ owner: 'main', ownerSession: 's-main', at: at(5) });
    expect(draft.original).toMatchObject({ entryId: origId, cardId: null, title: '写周报' });
    f.clock(at(12));
    const insId = await coord.commit({ draftId: draft.id, owner: 'main', ownerSession: 's-main', text: '回紧急消息 @学习 #加急', project: '生活' });
    expect(coord.current()).toBeNull();
    expect(open(f)).toMatchObject({ id: insId, description: '回紧急消息', project: '学习', tags: ['加急'], kind: '插入', started_at: at(5) });
    expect(f.ctx.snapshot()!.state.resume_entry_id).toBe(origId);
    const { records } = await f.ctx.repos.history.readDays('2000-01-01', '2999-12-31');
    expect(records[0]).toMatchObject({ action: 'home.insertExplicit', subject: { type: 'entry', id: insId } });

    // 回到原自由记录，暂停后再显式插入：原目标从 resume_entry_id 取，不把待机当原事
    f.clock(at(15));
    await resume(f.ctx, at(15));
    const resumedId = open(f).id;
    f.clock(at(20));
    await pause(f.ctx, at(20));
    expect(open(f).project).toBe('待机');
    const pausedDraft = await coord.begin({ owner: 'mini', ownerSession: 's-mini', at: at(20) });
    expect(pausedDraft.original).toMatchObject({ entryId: resumedId, title: '写周报' });
    f.clock(at(22));
    await coord.commit({ draftId: pausedDraft.id, owner: 'mini', ownerSession: 's-mini', text: '接电话', project: '工作' });
    expect(open(f)).toMatchObject({ description: '接电话', kind: '插入', started_at: at(20) });
    expect(f.ctx.snapshot()!.state.resume_entry_id).toBe(resumedId);
  } finally {
    coord.dispose();
  }
});

it('ADR 0024: coordinator enforces single draft, rejects concurrent begin, survives unrelated commits, invalidates on timer change, and routes mini commands with monotonic viewSeq', async () => {
  const { createInsertDraftCoordinator } = await import('./insertDraftCoordinator');
  const backpack = await import('./backpackService');
  const f = fixture();
  await seed(f, [card('c1', { task_id: 't1', content: '做主线卡' })], [task('t1')]);
  await startCard(f.ctx, 'c1', at(0));
  const coord = createInsertDraftCoordinator(f.ctx);
  let receive!: (message: MiniMessage) => void;
  let readyFn!: (session?: string) => void;
  const replies: MiniReply[] = [];
  const pushed: ReturnType<typeof projectMini>[] = [];
  const bus: MainWindowBus = {
    onCommand: async fn => { receive = fn; return () => {}; },
    onReady: async fn => { readyFn = fn; return () => {}; },
    push: async snap => { pushed.push(snap); },
    reply: async r => { replies.push(r); },
  };
  const stop = await connectMini(f.ctx, bus, {
    openMain: async () => {},
    complete: async () => {},
    report: error => { throw error; },
    draftCoordinator: coord,
  }, MINI_HEARTBEAT_MS);
  try {
    f.clock(at(10));
    const snap0 = pushed.at(-1)!;
    expect(snap0.canInsert).toBe(true);
    expect(snap0.viewSeq).toBe(1);

    // 小窗发起 beginInsertDraft
    receive({
      command: {
        requestId: 'req-begin',
        at: at(10),
        epoch: snap0.epoch,
        entryId: snap0.entryId,
        cardId: snap0.cardId,
        type: 'beginInsertDraft',
        ownerSession: 'mini-1',
        expectedTimer: snap0.timerStateToken!,
      },
    });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0].outcome.kind).toBe('done');
    const draft1 = coord.current()!;
    expect(draft1).toMatchObject({ owner: 'mini', ownerSession: 'mini-1', at: at(10) });
    expect(pushed.at(-1)!.viewSeq).toBeGreaterThan(snap0.viewSeq!);
    expect(pushed.at(-1)!.insertDraft).toMatchObject({ id: draft1.id, owner: 'mini', ownerSession: 'mini-1' });

    // 另一窗口同时 begin 明确拒绝
    f.clock(at(11));
    await expect(coord.begin({ owner: 'main', ownerSession: 'main-1', at: at(11) })).rejects.toThrow('另一窗口正在写插入事件');

    // 无关的背包写入不会取消草稿
    await backpack.addItem(f.ctx, 't1', '新子项', at(11));
    expect(coord.current()?.id).toBe(draft1.id);

    // 小窗重载产生新的 miniSession：自动回收旧 mini editing 草稿
    readyFn('mini-2');
    expect(coord.current()).toBeNull();

    // 重新建草稿，验证外部计时变化会使草稿失效并通知原因
    const invalidated: string[] = [];
    let latestNotifiedDraft = coord.current();
    coord.onChange((d, msg) => { latestNotifiedDraft = d; if (msg) invalidated.push(msg); });
    f.clock(at(12));
    const draft2 = await coord.begin({ owner: 'main', ownerSession: 'main-1', at: at(12) });
    expect(coord.current()?.id).toBe(draft2.id);
    // 旧 draftId 的 cancel 不能清掉新草稿
    await coord.cancel({ draftId: draft1.id, epoch: f.ctx.mainEpoch });
    expect(coord.current()?.id).toBe(draft2.id);
    // 暂停原计时：timerStateToken 变化，草稿自动失效
    f.clock(at(15));
    await pause(f.ctx, at(15));
    expect(coord.current()).toBeNull();
    expect(invalidated).toContain('原来的事已变化，插入未记下');

    // 提交进行中（committing）时调用 cancelDraftByOwner('mini') 不会取消正在落盘的草稿；提交成功后 onChange 必须收到 null
    f.clock(at(16));
    const draft3 = await coord.begin({ owner: 'mini', ownerSession: 'mini-2', at: at(16) });
    const committingPromise = coord.commit({ draftId: draft3.id, owner: 'mini', ownerSession: 'mini-2', text: '正在提交的插入' });
    expect(coord.current()?.phase).toBe('committing');
    expect(latestNotifiedDraft?.phase).toBe('committing');
    expect(coord.cancelDraftByOwner('mini')).toBe(false);
    await committingPromise;
    expect(coord.current()).toBeNull();
    expect(latestNotifiedDraft).toBeNull();
    expect(open(f)).toMatchObject({ description: '正在提交的插入', kind: '插入', started_at: at(16) });
  } finally {
    stop();
    coord.dispose();
  }
});
