import { expect, it, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import { createContext, readOperation, run, runOperation } from './commit';
import { saveRecordInTx } from './recordService';
import { committedWrite } from '../data/journal';
import { ReceiptRepo } from '../data/receiptRepo';
import { assertQueueHealthy } from './commit';

const now = () => '2026-11-03T06:00:00.000Z';
function fixture(fs = new MemoryFs()) {
  const publish = vi.fn(), log = vi.fn(async () => {}), update = vi.fn(async () => {});
  const ctx = createContext({ repos: createRepos(fs), settings: structuredClone(defaults), now, id: () => crypto.randomUUID(),
    publish, log, reminders: { update } });
  const id = crypto.randomUUID();
  const work = vi.fn(async (tx: Parameters<typeof saveRecordInTx>[0]) => {
    const record = saveRecordInTx(tx, { id: tx.id(), text: 'persistent idea', kind: '想法', created_at: tx.at,
      due_at: null, blocking: false, task_id: null, card_id: null, tags: [], attachments: [] });
    return { record_id: record.id };
  });
  return { fs, ctx, publish, log, update, id, work, operation: { id, command: 'test_save', input: { text: 'persistent idea' } } };
}

it('concurrent retries commit business and receipt once, then replay with zero writes or effects', async () => {
  const f = fixture(), transact = vi.spyOn(f.ctx.repos, 'transact');
  const [first, replay] = await Promise.all([
    runOperation(f.ctx, f.operation, f.work, undefined, undefined, { action: 'test.direct' }), runOperation(f.ctx, f.operation, f.work, undefined, undefined, { action: 'test.direct' }),
  ]);
  expect(first.replayed).toBe(false); expect(replay.replayed).toBe(true);
  expect(replay.data).toEqual(first.data);
  expect(f.work).toHaveBeenCalledOnce(); expect(transact).toHaveBeenCalledOnce();
  expect(f.publish).toHaveBeenCalledOnce(); expect(f.update).toHaveBeenCalledOnce();
  const paths = transact.mock.calls[0][1].map(write => committedWrite(write).path);
  expect(paths).toContain(`records/${first.data.record_id}.md`);
  expect(paths).toContain(`receipts/${f.id}.json`);
  const writes = vi.spyOn(f.fs, 'atomicWrite');
  expect((await readOperation(f.ctx, f.id))!.data).toEqual(first.data);
  await expect(runOperation(f.ctx, { ...f.operation, input: { text: 'different' } }, f.work, undefined, undefined, { action: 'test.direct' })).rejects.toThrow('OPERATION_CONFLICT');
  await expect(runOperation(f.ctx, { ...f.operation, command: 'different' }, f.work, undefined, undefined, { action: 'test.direct' })).rejects.toThrow('OPERATION_CONFLICT');
  expect(writes).not.toHaveBeenCalled();
});

it('replays a durable result after restarting the context and normalizes JSON key order', async () => {
  const f = fixture();
  const operation = { ...f.operation, input: { a: 1, b: [2, 3] } };
  const first = await runOperation(f.ctx, operation, f.work, undefined, undefined, { action: 'test.direct' });
  const restarted = fixture(f.fs);
  const result = await runOperation(restarted.ctx, { ...operation, input: { b: [2, 3], a: 1 } }, restarted.work, undefined, undefined, { action: 'test.direct' });
  expect(result.data).toEqual(first.data); expect(result.replayed).toBe(true);
  expect(restarted.work).not.toHaveBeenCalled(); expect(restarted.publish).not.toHaveBeenCalled();
});

it('partial journal failure is unknown until recovery restores both record and receipt', async () => {
  const f = fixture();
  f.fs.beforeWrite = path => { if (path.startsWith('receipts/')) throw new Error('receipt disk failure'); };
  await expect(runOperation(f.ctx, f.operation, f.work, undefined, undefined, { action: 'test.direct' })).rejects.toThrow('receipt disk failure');
  await expect(readOperation(f.ctx, f.id)).rejects.toThrow('提交已阻塞');
  expect(await f.fs.list('.journal')).toHaveLength(1);
  f.fs.beforeWrite = undefined;
  const restarted = fixture(f.fs);
  expect(await restarted.ctx.repos.recover()).toBe(1);
  const result = await runOperation(restarted.ctx, f.operation, restarted.work, undefined, undefined, { action: 'test.direct' });
  expect(result.replayed).toBe(true); expect(restarted.work).not.toHaveBeenCalled();
  expect((await restarted.ctx.repos.records.list()).map(e => e.value.id)).toEqual([result.data.record_id]);
  expect(await f.fs.list('.journal')).toEqual([]);
});

it('post-commit publication, reminder and logging failures remain committed and explicitly observable', async () => {
  const f = fixture();
  f.publish.mockImplementationOnce(() => { throw new Error('publish failed'); });
  f.update.mockRejectedValueOnce(new Error('reminder failed'));
  f.log.mockRejectedValueOnce(new Error('log failed'));
  const result = await runOperation(f.ctx, f.operation, f.work, undefined, undefined, { action: 'test.direct' });
  expect(result.status).toBe('committed');
  expect(result.warnings).toEqual([
    { phase: 'projection', message: 'publish failed' },
    { phase: 'reminders', message: 'reminder failed' },
    { phase: 'logging', message: 'log failed' },
  ]);
  expect((await readOperation(f.ctx, f.id.toUpperCase()))!.data).toEqual(result.data);
  const replay = await runOperation(f.ctx, { ...f.operation, id: f.id.toUpperCase() }, f.work, undefined, undefined, { action: 'test.direct' });
  expect(replay.replayed).toBe(true);
  expect(replay.operation_id).toBe(f.id.toLowerCase());
  expect(replay.warnings).toEqual([]);
  expect(f.work).toHaveBeenCalledOnce();
});

it('UI root calls preserve the value type and explicitly report data already committed on side effect failure', async () => {
  const f = fixture();
  f.update.mockRejectedValueOnce(new Error('reminder failed'));
  await expect(run(f.ctx, f.work, undefined, { action: 'test.direct' })).rejects.toThrow('数据已提交');
  expect(await f.ctx.repos.records.list()).toHaveLength(1);
  expect(await run(f.ctx, async () => 42, undefined, { action: 'test.direct' })).toBe(42);
});

it('bad receipt data and unsafe IDs are errors, never not_found', async () => {
  const f = fixture(), repo = new ReceiptRepo(f.fs);
  await expect(repo.get('../state.yaml')).rejects.toThrow();
  await f.fs.atomicWrite(`receipts/${f.id}.json`, '{broken');
  await expect(repo.get(f.id)).rejects.toThrow();
  expect(await readOperation(f.ctx, crypto.randomUUID())).toBe(null);
});

it('does not serve an old snapshot after a committed projection cannot be generated', async () => {
  const f = fixture();
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  const previous = f.ctx.snapshot();
  const clockError = new Error('projection clock unavailable');
  let calls = 0;
  const originalNow = f.ctx.now;
  // execute reads command time, validation time, committed time, then projection time.
  f.ctx.now = () => { calls++; if (calls === 4) throw clockError; return originalNow(); };
  const result = await runOperation(f.ctx, f.operation, f.work, undefined, undefined, { action: 'test.direct' });
  expect(result.status).toBe('committed');
  expect(result.warnings).toContainEqual({ phase: 'projection', message: clockError.message });
  expect(f.ctx.snapshot()).toBe(previous);
  expect(() => assertQueueHealthy(f.ctx)).toThrow('SNAPSHOT_UNAVAILABLE');
  expect((await readOperation(f.ctx, f.id))!.data).toEqual(result.data);
  f.ctx.now = originalNow;
  await run(f.ctx, async () => {}, undefined, { action: 'test.direct' });
  expect(() => assertQueueHealthy(f.ctx)).not.toThrow();
});

it('cancels queued operations before execution starts, but completes operations already executing', async () => {
  const f = fixture();
  let releaseFirst!: () => void;
  const blocker = new Promise<void>(resolve => { releaseFirst = resolve; });
  const firstOp = { id: crypto.randomUUID(), command: 'test_save', input: { step: 1 } };
  const queuedOp = { id: crypto.randomUUID(), command: 'test_save', input: { step: 2 } };
  const inFlightOp = { id: crypto.randomUUID(), command: 'test_save', input: { step: 3 } };
  const queuedAbort = new AbortController();
  const inFlightAbort = new AbortController();
  const queuedWork = vi.fn((tx: Parameters<typeof saveRecordInTx>[0]) => f.work(tx));

  const firstPromise = runOperation(f.ctx, firstOp, async tx => {
    await blocker;
    return f.work(tx);
  }, undefined, undefined, { action: 'test.direct' });
  const queuedPromise = runOperation(f.ctx, queuedOp, queuedWork, undefined, queuedAbort.signal, { action: 'test.direct' });
  const inFlightPromise = runOperation(f.ctx, inFlightOp, async tx => {
    inFlightAbort.abort();
    return f.work(tx);
  }, undefined, inFlightAbort.signal, { action: 'test.direct' });

  queuedAbort.abort();
  releaseFirst();

  const firstResult = await firstPromise;
  expect(firstResult.status).toBe('committed');
  await expect(queuedPromise).rejects.toThrow('CANCELLED');
  expect(queuedWork).not.toHaveBeenCalled();
  expect(await readOperation(f.ctx, queuedOp.id)).toBe(null);

  const inFlightResult = await inFlightPromise;
  expect(inFlightResult.status).toBe('committed');
  expect((await readOperation(f.ctx, inFlightOp.id))!.data).toEqual(inFlightResult.data);
});
