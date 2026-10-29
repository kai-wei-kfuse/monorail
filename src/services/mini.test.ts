import { expect, it, vi } from 'vitest';
import { fixture, at, card, seed, task, open, entries, getCard } from './serviceFixture';
import { startFree, startCard, beginPending, cancelPending, commitReadout, dispatchMiniCommand } from './homeService';
import { change } from './settingsService';
import { projectMini } from './miniProjection';
import { connectMini } from './miniController';
import { run } from './commit';
import { miniCommandSchema, decodeMiniCommand, miniUnresponsive, MINI_HEARTBEAT_MS } from '../platform/windowBus';
import type { MainWindowBus, MiniCommand, MiniMessage, MiniReply } from '../platform/windowBus';

const value = { description: 'A', project: '学习', tags: [] };
function seen(f: ReturnType<typeof fixture>) {
  const snapshot = projectMini(f.ctx.snapshot()!);
  return { requestId: crypto.randomUUID(), at: f.ctx.now(), entryId: snapshot.entryId, cardId: snapshot.cardId };
}
function editSeen(f: ReturnType<typeof fixture>) { return { ...seen(f), revision: f.home().dataVersion }; }
it('schema validates timestamps, action-specific identities and full readout plans before dispatch', () => {
  const base = { requestId: 'r', at: at(), entryId: 'e', cardId: null };
  expect(miniCommandSchema.safeParse({ ...base, type: 'pause' }).success).toBe(true);
  for (const command of [{ ...base, type: 'complete' }, { ...base, type: 'beginPending' },
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
  await run(f.ctx, async () => {});
  await expect(dispatchMiniCommand(f.ctx, old)).rejects.toThrow('已经换成');
  await beginPending(f.ctx, at()); const pending = f.home().pending!.id, target = seen(f);
  await run(f.ctx, async () => {});
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
  expect(projectMini(f.ctx.snapshot()!).miniMode).toBe('mini');
  await change(f.ctx, 'miniMode', 'tiny', at(5));
  expect(projectMini(f.ctx.snapshot()!).miniMode).toBe('tiny');
});
it('idle setReadout starts a pending session with the requested elapsed time and rejects if idle state changed', async () => {
  const f = fixture(); await seed(f, []); f.clock(at(20));
  const idleEntry = open(f);
  expect(idleEntry.project).toBe('待机');
  await dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'setReadout', pending_id: null,
    target: { mode: 'idle', id: idleEntry.id }, milliseconds: 15 * 60000, seen: null });
  expect(f.home().pending).toMatchObject({ startedAt: at(5) });
  // Once pending has started, another idle setReadout for the old idle state must reject
  await expect(dispatchMiniCommand(f.ctx, { ...editSeen(f), type: 'setReadout', pending_id: f.home().pending!.id,
    target: { mode: 'idle', id: idleEntry.id }, milliseconds: 10 * 60000, seen: null })).rejects.toThrow('已经换成');
});
