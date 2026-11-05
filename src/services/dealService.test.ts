import { expect, it } from 'vitest';
import { at, card, fixture, getCard, open, task, seed } from './serviceFixture';
import { refresh, drawFromPlan } from './dealService';
import { start } from './cardService';
import { insert } from './homeService';
import * as plan from './planService';
import { run } from './commit';

// 0.3.1：refreshInTx 只整理首页状态，不再出卡；抽卡只读、只从今天的板子里抽（ADR 0021 第 2 条）

it('refresh 不出卡：没有进行中的卡就是空卡区；0.3.0 留下的 review / guide 归一成 blank', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  await run(f.ctx, async tx => { tx.state.home_mode = 'review'; tx.state.current_card = 'a'; }, undefined, { action: 'test.direct' });
  await refresh(f.ctx, at());
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: null, home_mode: 'blank' });
  expect(await getCard(f, 'a')).toMatchObject({ status: '待做', skip_count: 0 });
});

it.each([false, true])('refresh 不打断进行中的卡，插入中也一样 (%s)', async inserted => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  if (inserted) { f.clock(at(1)); await insert(f.ctx, 'wc', at(1)); }
  const before = open(f);
  await refresh(f.ctx, at(1));
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 'a', home_mode: 'task' });
  expect(open(f)).toEqual(before);
});

it('refresh 照写 first_used_day 与本周回顾行（第 2 轮 B1）', async () => {
  const f = fixture(); await seed(f, []);
  await run(f.ctx, async tx => { tx.state.first_used_day = null; }, undefined, { action: 'test.direct' });
  await refresh(f.ctx, at());
  expect((await f.ctx.repos.state.read()).first_used_day).not.toBeNull();
});

it('drawFromPlan 只读：不写盘、不改首页状态、不记历史', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't' })], [task('t')]);
  await plan.add(f.ctx, 'today', { cardId: 'a', priority: '普通' }, at(1));
  const state = await f.ctx.repos.state.read(), history = (await f.ctx.repos.history.listAll()).length;
  const result = await drawFromPlan(f.ctx, at(2));
  expect(result).toMatchObject({ kind: 'task', card: { id: 'a' } });
  expect(await f.ctx.repos.state.read()).toEqual(state);
  expect((await f.ctx.repos.history.listAll()).length).toBe(history);
});

it('drawFromPlan：今天没排先问；插入中不能抽', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't' })], [task('t')]);
  expect(await drawFromPlan(f.ctx, at())).toEqual({ kind: 'plan' });
  await start(f.ctx, 'a', at()); f.clock(at(1)); await insert(f.ctx, 'wc', at(1));
  expect(await drawFromPlan(f.ctx, at(1))).toEqual({ kind: 'blocked', reason: 'inserting' });
});

it('〔换一张〕写进板子的 seen；全跳过了在写事务里重开一轮', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't', order: 1 }), card('b', { task_id: 't', order: 2 })], [task('t')]);
  await plan.add(f.ctx, 'today', { cardId: 'a', priority: '普通' }, at(1));
  await plan.add(f.ctx, 'today', { cardId: 'b', priority: '普通' }, at(1));
  const day = (await f.ctx.repos.plans.days())[0];
  await plan.skipCard(f.ctx, 'a', at(2));
  expect((await f.ctx.repos.plans.read(day)).value.seen).toEqual(['a']);
  expect(await drawFromPlan(f.ctx, at(2))).toMatchObject({ card: { id: 'b' } });
  await plan.skipCard(f.ctx, 'b', at(3));
  expect((await f.ctx.repos.plans.read(day)).value.seen).toEqual(['b']);
  expect(await getCard(f, 'a')).toMatchObject({ skip_count: 0 });
});
