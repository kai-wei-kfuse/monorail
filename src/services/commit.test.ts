import { it, expect, vi } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { defaults } from '../shared/settings';
import { createContext, run } from './commit';
import { createRepos } from '../data/repos';
import { saveRecord, reconcile } from './recordService';
import { start, complete } from './cardService';
import { insert, resume } from './homeService';
import { backfillRange } from './homeService';
import type { TimeEntry } from '../domain/timeline/entry';
import { initialState } from '../data/stateRepo';

function fixture() {
  const fs = new MemoryFs();
  return createContext({ repos: createRepos(fs), settings: structuredClone(defaults), id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
}
function record(text: string) { return { id: crypto.randomUUID(), text, kind: '待办' as const, created_at: '2026-10-26T00:00:00Z', due_at: null, blocking: true, task_id: null, card_id: null, tags: [], attachments: [] }; }

it('a rejected pre-write command does not poison the serialized queue', async () => {
  const ctx = fixture();
  await expect(start(ctx, 'missing', '2026-10-26T10:00:00Z')).rejects.toThrow('不存在');
  await saveRecord(ctx, record('still usable')); expect(await reconcile(ctx)).toBe(1);
});

it('reconciliation is idempotent across repeated events and new context instances', async () => {
  const ctx = fixture(), item = record('one'); await saveRecord(ctx, item);
  const counts = await Promise.all(Array.from({ length: 20 }, () => reconcile(ctx)));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  expect(await ctx.repos.cards.list()).toHaveLength(1);
  expect((await ctx.repos.records.get(item.id))?.value.card_id).toBe(`card-${item.id}`);
  const restarted = createContext(ctx);
  expect(await reconcile(restarted)).toBe(0);
  expect(await restarted.repos.cards.list()).toHaveLength(1);
});
it('20 rapid start/complete pairs keep sequence unique and effective intervals disjoint', async () => {
  const ctx = fixture(), items = Array.from({ length: 20 }, (_, i) => record(`task-${i}`));
  await Promise.all(items.map(item => saveRecord(ctx, item))); await reconcile(ctx);
  const origin = Date.parse('2026-10-26T10:00:00Z');
  const jobs = items.flatMap((item, i) => [
    start(ctx, `card-${item.id}`, new Date(origin + i * 2000).toISOString()),
    complete(ctx, `card-${item.id}`, new Date(origin + i * 2000 + 1000).toISOString(), 'done'),
  ]);
  await Promise.all(jobs);
  const entries = ctx.repos.times.snapshot();
  expect(new Set(entries.map(s => s.id)).size).toBe(entries.length);
  expect((await ctx.repos.cards.list()).filter(c => c.value.status === '已完成')).toHaveLength(20);
  const timeline = entries;
  timeline.slice(1).forEach((s, i) => expect(Date.parse(timeline[i].ended_at!)).toBeLessThanOrEqual(Date.parse(s.started_at)));
  expect(entries.filter(entry => entry.ended_at === null)).toHaveLength(1);
});
it('restroom interruption resumes the original card and completion uses click time', async () => {
  const ctx = fixture(), item = record('interruption'); await saveRecord(ctx, item); await reconcile(ctx);
  const card = `card-${item.id}`;
  await start(ctx, card, '2026-10-26T10:00:00Z'); await insert(ctx, '厕所', '2026-10-26T10:20:00Z');
  await resume(ctx, '2026-10-26T10:30:00Z'); await complete(ctx, card, '2026-10-26T10:55:00Z', 'note');
  const total = ctx.repos.times.snapshot().filter(s => s.card_id === card)
    .reduce((n, s) => n + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0);
  expect(total).toBe(45 * 60000);
  expect((await ctx.repos.cards.get(card))?.value.completed_at).toBe('2026-10-26T10:55:00Z');
});

it('closing a cross-day entry cannot overwrite an earlier backfill', async () => {
  const ctx = fixture(), item = { ...record('cross-day'), created_at: new Date(2026, 9, 26, 3).toISOString() }; await saveRecord(ctx, item); await reconcile(ctx);
  const card = `card-${item.id}`;
  const at = (hour: number, minute: number) => new Date(2026, 9, 26, hour, minute).toISOString();
  await start(ctx, card, at(3, 30));
  await backfillRange(ctx, { start: at(3, 50), end: at(4, 10) }, '厕所', at(4, 10));
  await complete(ctx, card, at(4, 30), 'cross-day completed');
  const rows = ctx.repos.times.snapshot().filter(entry => entry.ended_at !== null);
  const minutes = (cardId: string | null) => rows.filter(s => s.card_id === cardId).reduce((n, s) => n + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0) / 60000;
  expect(minutes(card)).toBe(60); expect(rows.find(entry => entry.source === '手动')?.description).toBe('厕所');
  const raw = ctx.repos.times.snapshot();
  const logical = new Map(raw.map(s => [s.id, s.id]));
  expect(new Set(logical.values()).size).toBe(logical.size);
  expect(raw.filter(entry => entry.source === '手动')).toHaveLength(1);
});

it('rejects transaction scope reentry before and after await without deadlocking', async () => {
  const ctx = fixture();
  await run(ctx, async tx => {
    expect(() => run(tx, async () => undefined)).toThrow('事务重入');
    await Promise.resolve();
    expect(() => run(tx, async () => undefined)).toThrow('事务重入');
  });
  await saveRecord(ctx, record('queue still usable'));
  expect(await reconcile(ctx)).toBe(1);
});

it('independent root actions still queue while another transaction is awaiting IO', async () => {
  const ctx = fixture();
  let release!: () => void, entered!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const order: string[] = [];
  const first = run(ctx, async () => { order.push('first-start'); entered(); await pending; order.push('first-end'); });
  await started;
  const second = run(ctx, async () => { order.push('second'); });
  release(); await Promise.all([first, second]);
  expect(order).toEqual(['first-start', 'first-end', 'second']);
});

it('a routine action only reads today and the open entry date, never scans history', async () => {
  const fs = new MemoryFs(), repos = createRepos(fs);
  const oldAt = new Date(2026, 9, 25, 10).toISOString();
  const todayAt = new Date(2026, 9, 27, 10).toISOString();
  const open: TimeEntry = { id: crypto.randomUUID(), started_at: oldAt, ended_at: null, description: '生活', project: '生活', card_id: null, kind: '普通', source: '手动', tags: [], updated_at: oldAt };
  await repos.transact(crypto.randomUUID(), [
    ...await repos.times.writes([open], todayAt, 4),
    await repos.state.write({ ...structuredClone(initialState), open_entry: open.id, open_entry_day: '2026-10-25' }),
  ]);
  // An unrelated broken history file must not be silently read by a routine action.
  await fs.atomicWrite('timelog/2025-01-01.md', 'not valid history');
  const read = vi.spyOn(fs, 'read'), scan = vi.spyOn(repos.times, 'scan'), list = vi.spyOn(fs, 'list');
  const ctx = createContext({ repos, settings: structuredClone(defaults), now: () => todayAt, id: () => crypto.randomUUID(), publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
  await run(ctx, async tx => { expect(tx.entries).toEqual([open]); });
  const days = new Set(read.mock.calls.map(([p]) => p).filter(p => p.startsWith('timelog/')));
  expect([...days]).toEqual([]);
  expect(scan).not.toHaveBeenCalled();
  expect(list.mock.calls.some(([p]) => p === 'timelog')).toBe(false);
});
