// 0.3.0-beta.3 E0.5 公共合同：Ctx.mainEpoch、Snapshot.reviews、intent 透传、readSerial、maintain（ADR 0019 第 5、7 条）。
import { expect, it, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import { closeMaintenance, createContext, maintain, pauseCommits, readSerial, run, runOperation } from './commit';
import type { Snapshot } from './commit';
import { runTx } from './serviceFixture';
import type { Review } from '../domain/review/schedule';

function fixture(mainEpoch?: number) {
  const fs = new MemoryFs(), publish = vi.fn<(snapshot: Snapshot) => void>();
  const ctx = createContext({ repos: createRepos(fs), settings: structuredClone(defaults), id: () => crypto.randomUUID(),
    now: () => '2026-11-04T10:00:00.000Z', publish, log: async () => {}, reminders: { update: async () => {} },
    ...(mainEpoch === undefined ? {} : { mainEpoch }) });
  return { fs, ctx, publish };
}
/** 一个可以从外面放行的暂停点，用来让任务停在执行中。 */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>(resolve => { open = resolve; });
  return { opened, open };
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
async function block(f: ReturnType<typeof fixture>) {
  f.fs.beforeWrite = path => { if (path === 'state.yaml') throw new Error('power loss'); };
  await expect(run(f.ctx, async () => {})).rejects.toThrow('power loss');
  f.fs.beforeWrite = undefined;
}

it('mainEpoch defaults to 0 and keeps the value given by bootstrap', () => {
  expect(fixture().ctx.mainEpoch).toBe(0);
  expect(fixture(7).ctx.mainEpoch).toBe(7);
});

it('the published snapshot carries reviews as an independent copy', async () => {
  const f = fixture();
  const review: Review = { id: 'r1', period: '2026-W45', status: '已完成', step: 'done', completed_at: '2026-11-04T09:00:00.000Z' };
  await run(f.ctx, async tx => { tx.saveReview(review); });
  const snapshot = f.publish.mock.calls.at(-1)![0];
  expect(snapshot.reviews).toEqual([review]);
  snapshot.reviews[0].status = '已被取代';
  expect((await f.ctx.repos.reviews.get('r1'))!.value.status).toBe('已完成');
});

it('intent is accepted by run, runOperation and runTx without changing the commit', async () => {
  const f = fixture();
  await runTx(f.ctx, async tx => { tx.state.home_mode = 'guide'; });
  await run(f.ctx, async () => 1, undefined, { action: 'dev.preview', source: { kind: 'manual', via: 'main', page: 'home' } });
  const result = await runOperation(f.ctx, { id: crypto.randomUUID(), command: 'save_idea', input: { text: 'x' } }, async () => 'ok',
    undefined, undefined, { action: 'verification.case', source: { kind: 'automation', agent: { name: null, detected_by: 'none' } } });
  expect(result).toMatchObject({ status: 'committed', data: 'ok', replayed: false });
  expect(f.publish).toHaveBeenCalledTimes(3);
});

it('readSerial waits for an in-flight commit, then reads without writing or publishing', async () => {
  const f = fixture(), hold = gate(), order: string[] = [];
  const commit = run(f.ctx, async tx => { order.push('commit:start'); await hold.opened; tx.state.home_mode = 'guide'; order.push('commit:end'); });
  const read = readSerial(f.ctx, async () => { order.push('read'); return (await f.ctx.repos.state.read()).home_mode; });
  await flush(); expect(order).toEqual(['commit:start']);
  hold.open();
  expect(await read).toBe('guide');
  await commit;
  expect(order).toEqual(['commit:start', 'commit:end', 'read']);
  expect(f.publish).toHaveBeenCalledTimes(1);
});

it('readSerial and maintain are refused once the journal is blocked', async () => {
  const f = fixture(); await block(f);
  await expect(readSerial(f.ctx, async () => 1)).rejects.toThrow('提交已阻塞');
  await expect(maintain(f.ctx, async () => 1)).rejects.toThrow('提交已阻塞');
});

it('maintain runs serially between commits and its failure does not block later commits', async () => {
  const f = fixture(), order: string[] = [];
  const first = run(f.ctx, async () => { order.push('commit:1'); });
  const task = maintain(f.ctx, async () => { order.push('maintain'); throw new Error('cleanup failed'); });
  const second = run(f.ctx, async () => { order.push('commit:2'); });
  await first;
  await expect(task).rejects.toThrow('cleanup failed');
  await second;
  expect(order).toEqual(['commit:1', 'maintain', 'commit:2']);
  await expect(run(f.ctx, async () => {})).resolves.toBeUndefined();
});

it('closeMaintenance lets the running task finish, cancels queued ones and refuses new ones (E8a1.3)', async () => {
  const f = fixture(), hold = gate(), order: string[] = [];
  const running = maintain(f.ctx, async () => { order.push('running:start'); await hold.opened; order.push('running:end'); });
  const queued = maintain(f.ctx, async () => { order.push('queued'); });
  await flush();
  const closed = closeMaintenance(f.ctx);
  await expect(maintain(f.ctx, async () => {})).rejects.toThrow('CANCELLED');
  hold.open();
  await running; await expect(queued).rejects.toThrow('CANCELLED'); await closed;
  expect(order).toEqual(['running:start', 'running:end']);
  // 提交不受影响
  await expect(run(f.ctx, async () => 'ok')).resolves.toBe('ok');
});

it('pauseCommits waits for a running maintenance task and refuses new ones until resumed', async () => {
  const f = fixture(), hold = gate();
  let finished = false;
  const task = maintain(f.ctx, async () => { await hold.opened; finished = true; });
  await flush();
  const barrier = pauseCommits(f.ctx);
  let ready = false; void barrier.ready.then(() => { ready = true; });
  await expect(maintain(f.ctx, async () => {})).rejects.toThrow('正在安装更新');
  await flush(); expect(ready).toBe(false);
  hold.open(); await task; await barrier.ready;
  expect(finished).toBe(true); expect(ready).toBe(true);
  barrier.resume();
  await expect(maintain(f.ctx, async () => 'after')).resolves.toBe('after');
});
