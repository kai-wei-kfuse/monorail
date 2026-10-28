import { expect, it, vi } from 'vitest';
import * as time from './timeEditService';
import { fixture, at, card, task, seed, entries, open, getCard } from './serviceFixture';
import { startCard, pause, continueEntry } from './homeService';
import { complete } from './cardService';
import { favorite, createTag } from './presetService';

const value = { description: '历史', project: '工作', tags: ['标签'] };
it('calendar create, move, resize and copy retain parallel entries and return stable new ids', async () => {
  const f = fixture(); f.clock(at(120));
  const id = await time.create(f.ctx, at(), at(30), at(120), value);
  const other = await time.create(f.ctx, at(10), at(25), at(120), { ...value, description: '并行' });
  await time.move(f.ctx, id, at(5), at(120));
  expect(entries(f).find(e => e.id === id)).toMatchObject({ started_at: at(5), ended_at: at(35) });
  await time.update(f.ctx, id, Date.parse(at(10)), Date.parse(at(20)), at(120));
  const copy = await time.copy(f.ctx, id, at(120), at(12));
  expect(copy).not.toBe(id); expect(entries(f).find(e => e.id === other)).toMatchObject({ started_at: at(10), ended_at: at(25) });
  expect(entries(f).find(e => e.id === copy)).toMatchObject({ started_at: at(12), ended_at: at(22), tags: ['标签'] });
  await time.remove(f.ctx, id, at(120)); expect(entries(f).some(e => e.id === id)).toBe(false);
});
it('range queries include entries starting before the range, are detached, and never publish', async () => {
  const f = fixture(); f.clock(at(120));
  const id = await time.create(f.ctx, at(-1500), at(30), at(120), value);
  const calls = f.publish.mock.calls.length;
  const rows = time.queryRange(f.ctx, at(), at(20)); expect(rows.some(row => row.id === id)).toBe(true);
  rows[0].description = '不能改掉仓库'; rows[0].tags.push('也不能');
  expect(entries(f).find(e => e.id === id)).toMatchObject(value);
  expect(time.recentEntries(f.ctx, 1).some(row => row.id === id)).toBe(true);
  expect(f.publish).toHaveBeenCalledTimes(calls);
  expect(() => time.queryRange(f.ctx, at(20), at())).toThrow('范围');
});
it('raw clock and duration edits preserve the historical date, report invalid input, and roll back', async () => {
  const f = fixture(); f.clock(at(120));
  const id = await time.create(f.ctx, at(-60), at(), at(120), value);
  await time.setStart(f.ctx, id, '930', at(120));
  await time.setDuration(f.ctx, id, '1h 30m', at(120));
  expect(entries(f).find(e => e.id === id)).toMatchObject({ started_at: at(-30), ended_at: at(60) });
  await time.setEnd(f.ctx, id, '1130', at(120)); expect(entries(f).find(e => e.id === id)?.ended_at).toBe(at(90));
  const before = entries(f), transact = vi.spyOn(f.ctx.repos, 'transact');
  for (const text of ['bad', '', '25:00']) await expect(time.setStart(f.ctx, id, text, at(120))).rejects.toThrow('无法识别');
  for (const text of ['bad', '', '-5', '0']) await expect(time.setDuration(f.ctx, id, text, at(120))).rejects.toThrow('时长');
  await expect(time.setDuration(f.ctx, id, '10h', at(120))).rejects.toThrow();
  expect(entries(f)).toEqual(before); expect(transact).not.toHaveBeenCalled();
});
it('end-clock edits can cross midnight without using the current date', async () => {
  const f = fixture(), iso = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
  f.clock(iso(28, 12));
  const id = await time.create(f.ctx, iso(26, 23), iso(27, 0), iso(28, 12), value);
  await time.setEnd(f.ctx, id, '1:30', iso(28, 12));
  expect(entries(f).find(e => e.id === id)?.ended_at).toBe(iso(27, 1, 30));
});
it('dragged card history recomputes totals, copies keep references and completed-day snapshots stay fixed', async () => {
  const f = fixture(); await seed(f, [card('c', { task_id: 't' })], [task('t')]);
  await startCard(f.ctx, 'c', at()); const first = open(f).id;
  f.clock(at(60)); await pause(f.ctx, at(60));
  expect(f.home().closedEffectiveMs).toBe(3600000);
  await time.update(f.ctx, first, at(-1440), at(-1410), at(60));
  expect(f.home().closedEffectiveMs).toBe(1800000);
  const copied = await time.copy(f.ctx, first, at(60), at(-1400));
  expect(f.home().closedEffectiveMs).toBe(3600000);
  await time.patch(f.ctx, first, { tags: ['历史标签'] }, at(60));
  await expect(time.patch(f.ctx, first, { description: '不改卡' }, at(60))).rejects.toThrow('卡');
  await complete(f.ctx, 'c', at(60), '完成'); const day = (await getCard(f, 'c')).completed_day;
  await time.remove(f.ctx, copied, at(60));
  expect((await getCard(f, 'c')).completed_day).toBe(day);
  await continueEntry(f.ctx, first, at(60)); expect(open(f).card_id).toBeNull();
});
it('running entries reject end, duration, move, copy, delete and reopening a closed entry', async () => {
  const f = fixture(); await seed(f, [card('c')]); await startCard(f.ctx, 'c', at()); const id = open(f).id;
  f.clock(at(30)); await time.update(f.ctx, id, at(10), null, at(30));
  expect(open(f).started_at).toBe(at(10));
  for (const action of [() => time.setEnd(f.ctx, id, '1030', at(30)), () => time.setDuration(f.ctx, id, '5', at(30)),
    () => time.move(f.ctx, id, at(), at(30)), () => time.copy(f.ctx, id, at(30)), () => time.remove(f.ctx, id, at(30))]) await expect(action()).rejects.toThrow('正在计时');
  const past = await time.create(f.ctx, at(-10), at(-5), at(30), value);
  await expect(time.update(f.ctx, past, at(-10), null, at(30))).rejects.toThrow('计时状态');
});
it('metadata, favorites, tags, show-idle setting and save-as-card survive persistence with E4', async () => {
  const f = fixture(); f.ctx.settings.sideTasks = 1; await seed(f, [], [task('full', '支线')]);
  f.clock(at(60)); const id = await time.create(f.ctx, at(), at(30), at(60), value);
  await time.patch(f.ctx, id, { description: '改过', project: '学习', tags: ['读书'] }, at(60));
  await favorite(f.ctx, id, at(60)); const c = await time.saveAsCard(f.ctx, id, at(60));
  expect(await getCard(f, c)).toMatchObject({ content: '改过', project: '学习', tags: ['读书'] });
  expect(f.publish.mock.calls.at(-1)![0].backpack.pool.sides).toHaveLength(2);
  expect(entries(f).find(e => e.id === id)?.card_id).toBeNull();
  await createTag(f.ctx, '未用', at(60)); await time.setShowIdle(f.ctx, false, at(60));
  expect((await f.ctx.repos.settings.read()).calendarShowIdle).toBe(false);
  expect(f.home().knownTags).toEqual(['读书', '未用']);
});
