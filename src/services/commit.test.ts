import { it, expect } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { defaults } from '../shared/settings';
import { effective } from '../domain/timeline/effective';
import { createContext } from './commit';
import { saveRecord, reconcile } from './recordService';
import { start, complete } from './cardService';
import { insert, resume } from './timerService';
import { splitAtDays } from '../domain/timeline/day';
import type { Segment } from '../domain/timeline/segment';

function fixture() {
  const fs = new MemoryFs();
  return createContext({ fs, settings: defaults, id: () => crypto.randomUUID(), now: () => new Date().toISOString(),
    publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
}
function record(text: string) { return { id: crypto.randomUUID(), text, kind: '待办' as const, created_at: '2026-10-26T00:00:00Z', due_at: null, blocking: true, project_id: null, card_id: null, tags: [], attachments: [] }; }

it('a rejected pre-write command does not poison the serialized queue', async () => {
  const ctx = fixture();
  await expect(start(ctx, 'missing', '2026-10-26T10:00:00Z')).rejects.toThrow('不存在');
  await saveRecord(ctx, record('still usable')); expect(await reconcile(ctx)).toBe(1);
});

it('reconciliation is idempotent across repeated events and new context instances', async () => {
  const ctx = fixture(), item = record('one'); await saveRecord(ctx, item);
  const counts = await Promise.all(Array.from({ length: 20 }, () => reconcile(ctx)));
  expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
  expect(await ctx.cards.list()).toHaveLength(1);
  expect((await ctx.records.get(item.id))?.value.card_id).toBe(`card-${item.id}`);
  const restarted = createContext(ctx);
  expect(await reconcile(restarted)).toBe(0);
  expect(await restarted.cards.list()).toHaveLength(1);
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
  const segments = await ctx.times.all();
  expect(new Set(segments.map(s => s.seq)).size).toBe(segments.length);
  expect((await ctx.cards.list()).filter(c => c.value.status === '已完成')).toHaveLength(20);
  const timeline = effective(segments, new Date(origin + 40000).toISOString());
  timeline.slice(1).forEach((s, i) => expect(Date.parse(timeline[i].ended_at!)).toBeLessThanOrEqual(Date.parse(s.started_at)));
  expect((await ctx.state.read()).max_seq).toBe(40);
});
it('restroom interruption resumes the original card and completion uses click time', async () => {
  const ctx = fixture(), item = record('interruption'); await saveRecord(ctx, item); await reconcile(ctx);
  const card = `card-${item.id}`;
  await start(ctx, card, '2026-10-26T10:00:00Z'); await insert(ctx, '厕所', '2026-10-26T10:20:00Z');
  await resume(ctx, '2026-10-26T10:30:00Z'); await complete(ctx, card, '2026-10-26T10:55:00Z', 'note');
  const total = effective(await ctx.times.all(), '2026-10-26T11:00:00Z').filter(s => s.card_id === card)
    .reduce((n, s) => n + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0);
  expect(total).toBe(45 * 60000);
  expect((await ctx.cards.get(card))?.value.completed_at).toBe('2026-10-26T10:55:00Z');
});

it('closing a cross-day segment cannot overwrite an earlier backfill', async () => {
  const ctx = fixture(), item = record('cross-day'); await saveRecord(ctx, item); await reconcile(ctx);
  const card = `card-${item.id}`;
  const at = (hour: number, minute: number) => new Date(2026, 9, 26, hour, minute).toISOString();
  await start(ctx, card, at(3, 30));
  await ctx.commit(async tx => {
    const correction: Segment = { id: ctx.id(), seq: tx.nextSeq(), started_at: at(3, 50), ended_at: at(4, 10), activity: '厕所', category: '生活', card_id: null, kind: '普通', source: '补记', resume_card_id: null };
    tx.writes.push(...await ctx.times.writes(splitAtDays(correction.started_at, correction.ended_at!, 4).map(part => ({ day: part.day, segment: { ...correction, started_at: part.start, ended_at: part.end } }))));
  });
  await complete(ctx, card, at(4, 30), 'cross-day completed');
  const rows = effective(await ctx.times.all(), at(4, 30));
  const minutes = (cardId: string | null) => rows.filter(s => s.card_id === cardId).reduce((n, s) => n + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0) / 60000;
  expect(minutes(card)).toBe(40); expect(minutes(null)).toBe(20);
  const raw = await ctx.times.all();
  const logical = new Map(raw.map(s => [s.id, s.seq]));
  expect(new Set(logical.values()).size).toBe(logical.size);
  expect((await ctx.state.read()).max_seq).toBe(3);
});
