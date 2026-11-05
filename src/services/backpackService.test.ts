import { expect, it, vi } from 'vitest';
import { at, card, fixture, getCard, open, task, seed } from './serviceFixture';
import { createTask, freezeTask, abandonTask, restoreTask, saveCard, reorderQueue } from './backpackService';
import { start, split, pass, complete } from './cardService';
import { run } from './commit';
import { shrinkCard } from '../data/migrations/v030/shrink';
/** 0.3.0 留下的「已缩小」链：用冻结的 0.3.0 缩小直接写进数据目录（0.3.1 不再产生） */
async function legacyChild(f: ReturnType<typeof fixture>, parentId: string, id: string): Promise<string> {
  await run(f.ctx, async tx => {
    const { parent, child } = shrinkCard(tx.cards.find(c => c.id === parentId)!, { id, at: at(), content: '小一步', type: '结果卡', minutes: null, order: 10, maxLevel: 9 });
    tx.saveCard(parent); tx.saveCard(child); tx.state.current_card = child.id; tx.state.home_mode = 'task';
  }, at(), { action: 'test.direct' });
  return id;
}
import { insert, resume } from './homeService';
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
  expect((await f.ctx.repos.tasks.get('main'))!.value).toMatchObject({ status: '冷藏', slot: '主线', slot_index: null });
  expect((await f.ctx.repos.tasks.get(id))!.value.slot_index).toBe(1);
  expect((await getCard(f, 'a')).status).toBe('待做'); expect(open(f).project).toBe('待机');
});
it('a reduced capacity never evicts existing tasks and an insufficient makeRoom rolls back all changes', async () => {
  const f = fixture(); f.ctx.settings.mainTasks = 2;
  const a = await createTask(f.ctx, { name: 'a', slot: '主线', makeRoom: null }, at());
  const b = await createTask(f.ctx, { name: 'b', slot: '主线', makeRoom: null }, at());
  f.ctx.settings.mainTasks = 1;
  await expect(createTask(f.ctx, { name: 'c', slot: '主线', makeRoom: { id: a, action: '冷藏' } }, at())).rejects.toThrow('已满');
  expect((await f.ctx.repos.tasks.get(a))!.value.status).toBe('进行中');
  expect((await f.ctx.repos.tasks.get(b))!.value.status).toBe('进行中');
  await freezeTask(f.ctx, b, at());
  const c = await createTask(f.ctx, { name: 'c', slot: '主线', makeRoom: { id: a, action: '放弃' } }, at());
  expect((await f.ctx.repos.tasks.get(c))!.value.slot_index).toBe(1);
});
it.each(['冷藏', '放弃'] as const)('A3 %s while away ends the insert and clears its return target', async action => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' }), card('b')], [task('main')]);
  await start(f.ctx, 'a', at()); f.clock(at(1)); await insert(f.ctx, 'wc', at(1));
  const before = open(f);
  await (action === '冷藏' ? freezeTask : abandonTask)(f.ctx, 'main', at(1));
  expect(open(f).project).toBe('待机');
  expect(open(f).id).not.toBe(before.id);
  expect((await getCard(f, 'a')).status).toBe(action === '冷藏' ? '待做' : '已放弃');
  expect((await f.ctx.repos.state.read()).current_card).toBeNull();
  await resume(f.ctx, at(1)); expect(open(f)).toMatchObject({ project: '待机', card_id: null });
});
it('A3 abandoning a running task stops its timer, preserves completed history, and exposes the next card', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' }), card('done', { task_id: 'main', status: '已完成', completed_day: '2026-10-27', completed_track: '主线' }), card('b')], [task('main')]);
  await start(f.ctx, 'a', at()); await abandonTask(f.ctx, 'main', at());
  expect(open(f).project).toBe('待机'); expect(f.home().card).toBeNull();
  expect(await getCard(f, 'done')).toMatchObject({ status: '已完成', completed_track: '主线' });
  await restoreTask(f.ctx, 'main', '支线', at());
  expect((await getCard(f, 'a')).status).toBe('已放弃');
});
it('A6 hiding ancestors, completing a child, and PASS preserve only the active leaf in queue', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]); await start(f.ctx, 'a', at());
  const b = await legacyChild(f, 'a', 'b'), c = await legacyChild(f, b, 'c');
  await start(f.ctx, c, at());
  const queue = () => f.publish.mock.calls.at(-1)![0].backpack.queue.flatMap(group => group.cards).map(item => item.id);
  expect(queue()).toEqual([c]); await expect(pass(f.ctx, 'a', at())).rejects.toThrow('先处理');
  await complete(f.ctx, c, at(), '进度'); expect(queue()).toEqual([b]);
  await pass(f.ctx, b, at()); expect(queue()).toEqual(['a']);
});
it('A6 abandoning a task terminates all unfinished shrink ancestors as well as the leaf', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]);
  const b = await legacyChild(f, 'a', 'b');
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
it('reorders only a complete queue; the home page does not deal a card (0.3.1)', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b', { order: 2 })]);
  await expect(reorderQueue(f.ctx, null, ['b'], at())).rejects.toThrow('完整顺序');
  await reorderQueue(f.ctx, null, ['b', 'a'], at());
  expect((await getCard(f, 'b')).order).toBeLessThan((await getCard(f, 'a')).order);
  expect(f.home()).toMatchObject({ mode: 'blank', card: null });
});
it('moving a running card to a parked task releases it and switching active task records a new project', async () => {
  const f = fixture(); await seed(f, [card('a')], [task('main'), { ...task('cold'), slot: '支线', slot_index: null, status: '冷藏' }]);
  await start(f.ctx, 'a', at()); await saveCard(f.ctx, 'a', fields('main'), at()); expect(open(f).project).toBe('未分类');
  await saveCard(f.ctx, 'a', fields('cold'), at()); expect(open(f).project).toBe('待机'); expect((await getCard(f, 'a')).status).toBe('待做');
});
it('moving an away card into a main task resumes in the new track without changing historical time', async () => {
  const f = fixture(); await seed(f, [card('a')], [{ ...task('main'), default_project: '学习' }]);
  await start(f.ctx, 'a', at()); f.clock(at(1)); await insert(f.ctx, 'wc', at(1));
  const inserted = open(f);
  await saveCard(f.ctx, 'a', fields('main'), at(1)); expect(open(f)).toEqual(inserted);
  await resume(f.ctx, at(1)); expect(open(f).project).toBe('学习');
});
it('queue ties can be reordered while preserving other task positions', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b'), card('x', { task_id: 'main', order: 2 })], [task('main')]);
  await reorderQueue(f.ctx, null, ['b', 'a'], at());
  const result = (await f.ctx.repos.cards.list()).map(e => e.value).sort((a, b) => a.order - b.order);
  expect(result.map(c => c.id)).toEqual(['b', 'a', 'x']);
});
it.each(['complete', 'pass'] as const)('a moved shrink child can %s after its old task is abandoned without reviving its parent', async action => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]); await start(f.ctx, 'a', at());
  const child = await split(f.ctx, 'a', { todayContent: '先做这些', restContent: '小一步', restMinutes: null }, at());
  await saveCard(f.ctx, child, fields(), at()); await abandonTask(f.ctx, 'main', at());
  f.clock(at(1)); await start(f.ctx, child, at(1));
  f.clock(at(2));
  if (action === 'complete') await complete(f.ctx, child, at(2), '完成');
  else await pass(f.ctx, child, at(2));
  expect((await getCard(f, 'a')).status).toBe('已放弃');
  expect((await getCard(f, child)).status).toBe(action === 'complete' ? '已完成' : '已放弃');
  // 拆分出来的 rest 的父卡不是「已缩小」，完成或 PASS 都不会去改它
});

it('0.3.1 新建任务：每一项可以选结果或时间盒（已定 46）；只给字符串的按结果卡；时间盒要填分钟', async () => {
  const f = fixture(); await seed(f, []);
  const id = await createTask(f.ctx, { name: '把 408 过一遍', slot: '支线', makeRoom: null,
    items: ['数据结构：线性表', { content: '计算机组成：存储器', type: '时间盒卡', minutes: 90 }] }, at());
  const cards = (await f.ctx.repos.cards.list()).map(e => e.value).filter(c => c.task_id === id).sort((a, b) => a.order - b.order);
  expect(cards.map(c => [c.content, c.type, c.timebox_minutes])).toEqual([['数据结构：线性表', '结果卡', null], ['计算机组成：存储器', '时间盒卡', 90]]);
  await expect(createTask(f.ctx, { name: '坏的', slot: '支线', makeRoom: null, items: [{ content: 'x', type: '时间盒卡', minutes: null }] }, at())).rejects.toThrow('分钟');
});
