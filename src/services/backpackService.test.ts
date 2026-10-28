import { expect, it, vi } from 'vitest';
import { at, card, fixture, getCard, open, task, seed } from './serviceFixture';
import { createTask, freezeTask, abandonTask, restoreTask, saveCard, reorderQueue } from './backpackService';
import { start, shrink, pass, complete } from './cardService';
import { insert, resume } from './timerService';
import type { CardFields } from '../shared/backpack';

const fields = (taskId: string | null = null): CardFields => ({ content: '做一件事', type: '结果卡', timeboxMinutes: null,
  dueAt: null, blocking: false, noShrink: false, taskId });

it('allocates shared smallest free slots, preserves existing slots and grants a main bet period', async () => {
  const f = fixture();
  const side = await createTask(f.ctx, { name: '支线先来', slot: '支线', makeRoom: null }, at());
  const main = await createTask(f.ctx, { name: '主线', slot: '主线', makeRoom: null }, at());
  expect((await f.ctx.repos.tasks.get(side))!.value.slot_index).toBe(1);
  expect((await f.ctx.repos.tasks.get(main))!.value).toMatchObject({ slot_index: 2, bet_ends_at: new Date(2026, 10, 24, 10).toISOString() });
  await freezeTask(f.ctx, side, at());
  const next = await createTask(f.ctx, { name: '新支线', slot: '支线', makeRoom: null }, at());
  expect((await f.ctx.repos.tasks.get(next))!.value.slot_index).toBe(1);
  expect((await f.ctx.repos.tasks.get(main))!.value.slot_index).toBe(2);
});
it('makeRoom freezes a running task and inserts its replacement in one transaction', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]);
  await start(f.ctx, 'a', at());
  const transact = vi.spyOn(f.ctx.repos, 'transact');
  const id = await createTask(f.ctx, { name: '替代主线', slot: '主线', makeRoom: { id: 'main', action: '冷藏' } }, at());
  expect(transact).toHaveBeenCalledTimes(1);
  expect((await f.ctx.repos.tasks.get('main'))!.value).toMatchObject({ status: '冷藏', slot: '不在背包', slot_index: null });
  expect((await f.ctx.repos.tasks.get(id))!.value.slot_index).toBe(1);
  expect((await getCard(f, 'a')).status).toBe('待做'); expect(open(f).project).toBe('待机');
});
it('a reduced capacity never evicts existing tasks and an insufficient makeRoom rolls back all changes', async () => {
  const f = fixture(); f.ctx.settings.mainSlots = 2;
  const a = await createTask(f.ctx, { name: 'a', slot: '主线', makeRoom: null }, at());
  const b = await createTask(f.ctx, { name: 'b', slot: '主线', makeRoom: null }, at());
  f.ctx.settings.mainSlots = 1;
  await expect(createTask(f.ctx, { name: 'c', slot: '主线', makeRoom: { id: a, action: '冷藏' } }, at())).rejects.toThrow('已满');
  expect((await f.ctx.repos.tasks.get(a))!.value.status).toBe('进行中');
  expect((await f.ctx.repos.tasks.get(b))!.value.status).toBe('进行中');
  await freezeTask(f.ctx, b, at());
  const c = await createTask(f.ctx, { name: 'c', slot: '主线', makeRoom: { id: a, action: '放弃' } }, at());
  expect((await f.ctx.repos.tasks.get(c))!.value.slot_index).toBe(1);
});
it.each(['冷藏', '放弃'] as const)('A3 %s while away leaves the insert untouched, and return resumes idle', async action => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' }), card('b')], [task('main')]);
  await start(f.ctx, 'a', at()); await insert(f.ctx, 'wc', at());
  const before = open(f);
  await (action === '冷藏' ? freezeTask : abandonTask)(f.ctx, 'main', at());
  expect(open(f)).toEqual(before);
  expect((await getCard(f, 'a')).status).toBe(action === '冷藏' ? '待做' : '已放弃');
  expect((await f.ctx.repos.state.read()).current_card).toBe('b');
  await resume(f.ctx, at()); expect(open(f)).toMatchObject({ project: '待机', card_id: null });
});
it('A3 abandoning a running task stops its timer, preserves completed history, and exposes the next card', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' }), card('done', { task_id: 'main', status: '已完成', completed_day: '2026-10-27', completed_track: '主线' }), card('b')], [task('main')]);
  await start(f.ctx, 'a', at()); await abandonTask(f.ctx, 'main', at());
  expect(open(f).project).toBe('待机'); expect(f.home().card?.id).toBe('b');
  expect(await getCard(f, 'done')).toMatchObject({ status: '已完成', completed_track: '主线' });
  await restoreTask(f.ctx, 'main', '支线', at());
  expect((await getCard(f, 'a')).status).toBe('已放弃');
});
it('A6 hiding ancestors, completing a child, and PASS preserve only the active leaf in queue', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]); await start(f.ctx, 'a', at());
  const input = { content: '小一步', type: '结果卡' as const, minutes: null };
  const b = await shrink(f.ctx, 'a', input, at()), c = await shrink(f.ctx, b, input, at());
  const queue = () => f.publish.mock.calls.at(-1)![0].backpack.queue.flatMap(group => group.cards).map(item => item.id);
  expect(queue()).toEqual([c]); await expect(pass(f.ctx, 'a', at())).rejects.toThrow('先处理');
  await complete(f.ctx, c, at(), '进度'); expect(queue()).toEqual([b]);
  await pass(f.ctx, b, at()); expect(queue()).toEqual(['a']);
});
it('A6 abandoning a task terminates all unfinished shrink ancestors as well as the leaf', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]);
  const b = await shrink(f.ctx, 'a', { content: '小一步', type: '结果卡', minutes: null }, at());
  await abandonTask(f.ctx, 'main', at());
  expect((await getCard(f, 'a')).status).toBe('已放弃'); expect((await getCard(f, b)).status).toBe('已放弃');
  await restoreTask(f.ctx, 'main', '主线', at()); expect(f.home().card).toBeNull();
});
it('editing card fields resets skips, updates deadline plans, and keeps historical completion snapshots separate', async () => {
  const f = fixture(); await seed(f, [card('a', { skip_count: 2 })], [task('main')]);
  await saveCard(f.ctx, 'a', { ...fields('main'), content: '新内容', type: '时间盒卡', timeboxMinutes: 25, dueAt: at(90), noShrink: true, blocking: true }, at());
  expect(await getCard(f, 'a')).toMatchObject({ content: '新内容', timebox_minutes: 25, no_shrink: true, blocking: true, task_id: 'main', skip_count: 0 });
  expect(f.update.mock.calls.at(-1)![0]).toContainEqual(expect.objectContaining({ body: '新内容', at: Date.parse(at(30)) }));
  const id = await saveCard(f.ctx, null, fields(), at()); expect(await getCard(f, id)).toMatchObject({ source_record_id: null, order: 2 });
});
it('reorders only a complete queue and makes the new head the pending home card', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b', { order: 2 })]);
  await expect(reorderQueue(f.ctx, null, ['b'], at())).rejects.toThrow('完整顺序');
  await reorderQueue(f.ctx, null, ['b', 'a'], at()); expect(f.home().card?.id).toBe('b');
});
it('moving a running card to a parked task releases it and switching active task records a new project', async () => {
  const f = fixture(); await seed(f, [card('a')], [task('main'), { ...task('cold'), slot: '不在背包', slot_index: null, status: '冷藏' }]);
  await start(f.ctx, 'a', at()); await saveCard(f.ctx, 'a', fields('main'), at()); expect(open(f).project).toBe('主线');
  await saveCard(f.ctx, 'a', fields('cold'), at()); expect(open(f).project).toBe('待机'); expect((await getCard(f, 'a')).status).toBe('待做');
});
it('moving an away card into a main task resumes in the new track without changing historical time', async () => {
  const f = fixture(); await seed(f, [card('a')], [task('main')]);
  await start(f.ctx, 'a', at()); await insert(f.ctx, 'wc', at());
  const inserted = open(f);
  await saveCard(f.ctx, 'a', fields('main'), at()); expect(open(f)).toEqual(inserted);
  await resume(f.ctx, at()); expect(open(f).project).toBe('主线');
});
it('queue ties can be reordered while preserving other task positions', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b'), card('x', { task_id: 'main', order: 2 })], [task('main')]);
  await reorderQueue(f.ctx, null, ['b', 'a'], at());
  const result = (await f.ctx.repos.cards.list()).map(e => e.value).sort((a, b) => a.order - b.order);
  expect(result.map(c => c.id)).toEqual(['b', 'a', 'x']);
});
it.each(['complete', 'pass'] as const)('a moved shrink child can %s after its old task is abandoned without reviving its parent', async action => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]); await start(f.ctx, 'a', at());
  const child = await shrink(f.ctx, 'a', { content: '小一步', type: '结果卡', minutes: null }, at());
  await saveCard(f.ctx, child, fields(), at()); await abandonTask(f.ctx, 'main', at());
  if (action === 'complete') await complete(f.ctx, child, at(), '完成');
  else await pass(f.ctx, child, at());
  expect((await getCard(f, 'a')).status).toBe('已放弃');
  expect((await getCard(f, child)).status).toBe(action === 'complete' ? '已完成' : '已放弃');
});
