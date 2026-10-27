import { describe, it, expect } from 'vitest';
import { MemoryFs } from '../data/memoryFs';
import { createRepos } from '../data/repos';
import { defaults } from '../shared/settings';
import { effective } from '../domain/timeline/effective';
import type { Segment } from '../domain/timeline/segment';
import { createContext, run } from './commit';
import { saveRecord, reconcile } from './recordService';
import { start } from './cardService';
import { insertInTx, resumeInTx, insert, resume, backfillRange, backfillSwitch, settleOffline, answerOffline, sleep, wake } from './timerService';

function fixture() {
  const settings = structuredClone(defaults);
  settings.lists.quickActivities = [{ id: 'wc', name: '厕所', category: '生活' }, { id: 'video', name: '刷视频', category: '娱乐' }];
  return createContext({ repos: createRepos(new MemoryFs()), settings, id: () => crypto.randomUUID(), now: () => '2026-10-27T13:00:00Z',
    publish: () => {}, log: async () => {}, reminders: { update: async () => {} } });
}
async function startedCard(ctx: ReturnType<typeof fixture>, at: string) {
  const id = crypto.randomUUID();
  await saveRecord(ctx, { id, text: '学 Python', kind: '待办', created_at: at, due_at: null, blocking: false, project_id: null, card_id: null, tags: [], attachments: [] });
  await reconcile(ctx);
  await start(ctx, `card-${id}`, at);
  return `card-${id}`;
}
const all = async (ctx: ReturnType<typeof fixture>) => (await ctx.repos.times.scan()).flatMap(d => d.segments);
const total = (rows: Segment[], pick: (s: Segment) => boolean) =>
  rows.filter(pick).reduce((n, s) => n + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0) / 60_000;

describe('timerService', () => {
  it('nested inserts keep the original card as the single return target (A2)', async () => {
    const ctx = fixture(), card = await startedCard(ctx, '2026-10-27T10:00:00Z');
    await insert(ctx, 'wc', '2026-10-27T10:10:00Z');
    await insert(ctx, 'video', '2026-10-27T10:15:00Z');
    await resume(ctx, '2026-10-27T10:20:00Z');
    const open = (await all(ctx)).find(s => s.ended_at === null)!;
    expect(open.card_id).toBe(card);
    expect(open.category).toBe('支线');
  });
  it('resume returns to idle when the card is no longer in progress', async () => {
    const ctx = fixture();
    await insert(ctx, 'wc', '2026-10-27T10:00:00Z');
    await resume(ctx, '2026-10-27T10:05:00Z');
    const open = (await all(ctx)).find(s => s.ended_at === null)!;
    expect(open).toMatchObject({ card_id: null, category: '待机', activity: '待机' });
  });
  it('range backfill overrides history without changing the current activity (A1 example)', async () => {
    const ctx = fixture(), card = await startedCard(ctx, '2026-10-27T10:00:00Z');
    await backfillRange(ctx, { start: '2026-10-27T10:20:00Z', end: '2026-10-27T10:40:00Z' }, 'wc', '2026-10-27T10:50:00Z');
    const rows = await all(ctx);
    expect(rows.find(s => s.ended_at === null)?.card_id).toBe(card);
    expect(total(effective(rows, '2026-10-27T11:00:00Z'), s => s.card_id === card)).toBe(40);
  });
  it('rejects backfill into the future or with inverted bounds', async () => {
    const ctx = fixture();
    await expect(backfillRange(ctx, { start: '2026-10-27T10:00:00Z', end: '2026-10-27T12:00:00Z' }, 'wc', '2026-10-27T11:00:00Z')).rejects.toThrow('现在');
    await expect(backfillRange(ctx, { start: '2026-10-27T10:00:00Z', end: '2026-10-27T09:00:00Z' }, 'wc', '2026-10-27T11:00:00Z')).rejects.toThrow('晚于');
  });
  it('one-click backfill backdates an insert so「回来」still returns to the card', async () => {
    const ctx = fixture(), card = await startedCard(ctx, '2026-10-27T10:00:00Z');
    await backfillSwitch(ctx, 40, 'video', '2026-10-27T11:00:00Z');
    let rows = await all(ctx);
    expect(rows.find(s => s.ended_at === null)).toMatchObject({ activity: '刷视频', source: '补记', started_at: '2026-10-27T10:20:00.000Z', resume_card_id: card });
    await resume(ctx, '2026-10-27T11:05:00Z');
    rows = await all(ctx);
    const view = effective(rows, '2026-10-27T11:10:00Z');
    expect(total(view, s => s.card_id === card)).toBe(25);
    expect(total(view, s => s.activity === '刷视频')).toBe(45);
  });
  it('backfill across the 04:00 boundary is split into two files with one seq', async () => {
    const ctx = fixture();
    const start = new Date(2026, 9, 27, 3, 30).toISOString(), end = new Date(2026, 9, 27, 4, 30).toISOString();
    await backfillRange(ctx, { start, end }, 'wc', new Date(2026, 9, 27, 5).toISOString());
    const days = await ctx.repos.times.scan();
    const pieces = days.flatMap(d => d.segments.filter(s => s.source === '补记').map(s => ({ day: d.day, s })));
    expect(pieces.map(p => p.day).sort()).toEqual(['2026-10-26', '2026-10-27']);
    expect(new Set(pieces.map(p => p.s.seq)).size).toBe(1);
    expect(total(pieces.map(p => p.s), () => true)).toBe(60);
  });
  it('offline gaps are recorded as「离线」first, once, and answers override them (#37)', async () => {
    const ctx = fixture(), card = await startedCard(ctx, '2026-10-27T08:00:00Z');
    const gap = { start: '2026-10-27T09:00:00.000Z', end: '2026-10-27T11:00:00.000Z' };
    expect(await settleOffline(ctx, gap)).toMatchObject({ activity: '离线', source: '离线追问' });
    expect(await settleOffline(ctx, gap)).toBeNull();
    expect(await settleOffline(ctx, { start: '2026-10-27T11:00:00.000Z', end: '2026-10-27T11:04:00.000Z' })).toBeNull();
    let view = effective(await all(ctx), '2026-10-27T12:00:00Z');
    expect(total(view, s => s.card_id === card)).toBe(60);
    expect((await all(ctx)).find(s => s.ended_at === null)).toMatchObject({ category: '待机', started_at: gap.end });
    expect((await ctx.repos.cards.get(card))?.value.status).toBe('待做');
    expect((await ctx.repos.state.read()).current_card).toBeNull();
    await answerOffline(ctx, gap, '睡觉', '2026-10-27T12:00:00Z');
    view = effective(await all(ctx), '2026-10-27T12:00:00Z');
    expect(total(view, s => s.activity === '睡觉' && s.category === '睡眠')).toBe(120);
    expect(total(view, s => s.activity === '离线')).toBe(0);
  });
  it('free-typed names are accepted and blank ones rejected', async () => {
    const ctx = fixture();
    await insert(ctx, ' 拿快递 ', '2026-10-27T07:00:00Z');
    expect((await all(ctx)).find(s => s.ended_at === null)).toMatchObject({ activity: '拿快递', category: '生活' });
    await expect(insert(ctx, '  ', '2026-10-27T07:01:00Z')).rejects.toThrow('不能为空');
  });
  it('sleep releases the card in progress and stops dealing for the activity day', async () => {
    const ctx = fixture(), card = await startedCard(ctx, '2026-10-27T13:00:00Z');
    await sleep(ctx, '2026-10-27T15:00:00Z');
    expect((await ctx.repos.cards.get(card))?.value.status).toBe('待做');
    const state = await ctx.repos.state.read();
    expect(state).toMatchObject({ current_card: null, stopped_day: '2026-10-27' });
    expect((await all(ctx)).find(s => s.ended_at === null)).toMatchObject({ activity: '睡觉', category: '睡眠' });
  });
  it('a segment opened and closed in one transaction is written once', async () => {
    const ctx = fixture(), card = await startedCard(ctx, '2026-10-27T10:00:00Z');
    await run(ctx, async tx => {
      await insertInTx(tx, '2026-10-27T10:10:00Z', { name: '厕所', category: '生活' });
      await resumeInTx(tx, '2026-10-27T10:10:00Z');
    }, '2026-10-27T10:10:00Z');
    const rows = await all(ctx);
    expect(rows.filter(s => s.activity === '厕所')).toHaveLength(1);
    expect(rows.find(s => s.ended_at === null)?.card_id).toBe(card);
  });
  it('wake switches to idle', async () => {
    const ctx = fixture();
    await insert(ctx, 'wc', '2026-10-27T07:00:00Z');
    await wake(ctx, '2026-10-27T07:30:00Z');
    expect((await all(ctx)).find(s => s.ended_at === null)?.category).toBe('待机');
  });
});
