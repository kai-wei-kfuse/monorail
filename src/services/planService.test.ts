import { describe, expect, it } from 'vitest';
import { at, card, fixture, runTx, seed, task } from './serviceFixture';
import type { Fixture } from './serviceFixture';
import * as plan from './planService';
import { newDay } from './dayChange';
import { startCardInTx } from './cardService';
import { activityDay } from '../domain/timeline/day';
import { shiftDay } from '../domain/plan/plan';

// 今日任务板的服务（ADR 0021 第 1、6、11 条，执行方案 G2）
const history = async (f: Fixture) => (await f.ctx.repos.history.readDays('2000-01-01', '2999-12-31')).records;
const day = (iso: string, f: Fixture) => activityDay(iso, f.ctx.settings.dayBoundaryHour);
const read = async (f: Fixture, d: string) => (await f.ctx.repos.plans.read(d)).value;

async function setup() {
  const f = fixture();
  await seed(f, [card('c1', { task_id: 't1', type: '时间盒卡', timebox_minutes: 120 }), card('c2', { task_id: 't1', type: '结果卡', timebox_minutes: null, order: 2 }),
    card('c3', { task_id: 't1', order: 3 })], [task('t1')]);
  await runTx(f.ctx, async tx => { tx.state.current_card = null; tx.state.home_mode = 'blank'; });
  return f;
}

describe('今日任务板（G2）', () => {
  it('排进今天：时间盒默认填剩下的时长，结果卡不填；写进 plans/<今天>.yaml，历史记成 card 类型', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c1', priority: '高' }, at(1));
    await plan.add(f.ctx, 'today', { cardId: 'c2', priority: '普通' }, at(2));
    const p = await read(f, day(at(2), f));
    expect(p.items.map(i => [i.card_id, i.priority, i.today_minutes])).toEqual([['c1', '高', 120], ['c2', '普通', null]]);
    const [last, first] = await history(f);
    expect(first).toMatchObject({ action: 'plan.add', subject: { type: 'card', id: 'c1' } });
    expect(first.changes).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'card', id: 'c1', field: '今日任务板', before: '—', after: '今天' })]));
    expect(last.action).toBe('plan.add');
  });

  it('同一张卡不能排两次；离开背包的卡不能排；结果卡填数字 todayMinutes 报错拒绝', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c1', priority: '普通' }, at(1));
    await expect(plan.add(f.ctx, 'today', { cardId: 'c1', priority: '普通' }, at(2))).rejects.toThrow('已经在今天');
    await expect(plan.add(f.ctx, 'today', { cardId: 'c2', priority: '普通', todayMinutes: 30 }, at(2))).rejects.toThrow('结果卡不填今天的量');
    await runTx(f.ctx, async tx => { tx.saveCard({ ...tx.cards.find(c => c.id === 'c3')!, status: '已放弃' }); });
    await expect(plan.add(f.ctx, 'today', { cardId: 'c3', priority: '普通' }, at(3))).rejects.toThrow('不在背包');
  });

  it('排进明天写另一份文件；改量、改优先级、移出都记历史', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'tomorrow', { cardId: 'c1', priority: '普通', todayMinutes: 45 }, at(1));
    const tomorrow = shiftDay(day(at(1), f), 1);
    expect((await read(f, tomorrow)).items).toHaveLength(1);
    expect((await read(f, day(at(1), f))).items).toHaveLength(0);
    await plan.edit(f.ctx, 'tomorrow', { cardId: 'c1', priority: '高', todayMinutes: 30 }, at(2));
    expect((await read(f, tomorrow)).items[0]).toMatchObject({ priority: '高', today_minutes: 30 });
    const edited = (await history(f))[0];
    expect(edited.changes.map(c => c.field)).toEqual(expect.arrayContaining(['今天的量', '优先级']));
    await plan.remove(f.ctx, 'tomorrow', 'c1', at(3));
    expect((await read(f, tomorrow)).items).toHaveLength(0);
    expect((await history(f))[0].changes[0]).toMatchObject({ field: '今日任务板', before: '明天', after: '—' });
  });

  it('只读、没改的事务不写板子文件', async () => {
    const f = await setup();
    await runTx(f.ctx, async () => {});
    expect(await f.ctx.repos.plans.days()).toEqual([]);
  });

  it('这次先不排：记成 state 类型；排进第一项时清掉', async () => {
    const f = await setup();
    await plan.skipToday(f.ctx, at(1));
    expect((await read(f, day(at(1), f))).skip_until_planned).toBe(true);
    expect((await history(f))[0].subject ?? (await history(f))[0].changes[0]).toMatchObject({ type: 'state' });
    await plan.add(f.ctx, 'today', { cardId: 'c2', priority: '普通' }, at(2));
    expect((await read(f, day(at(2), f))).skip_until_planned).toBe(false);
  });

  it('坏文件报错，不静默覆盖', async () => {
    const f = await setup();
    const d = day(at(1), f);
    await f.ctx.repos.transact(crypto.randomUUID(), [{ path: `plans/${d}.yaml`, text: 'schemaVersion: 1\nday: 1999-01-01\n', before: null } as never]);
    await expect(plan.add(f.ctx, 'today', { cardId: 'c1', priority: '普通' }, at(2))).rejects.toThrow(`plans/${d}.yaml`);
  });
});

describe('换日带过去（ADR 0021 第 6 条，第 2 轮 B2）', () => {
  const nextMorning = (f: Fixture, minute = 0) => new Date(new Date(at()).getFullYear(), new Date(at()).getMonth(), new Date(at()).getDate() + 1, 9, minute).toISOString();

  it('带过去一次：没达成的带、待确认；同一天第二次 newDay 什么都不改', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c1', priority: '高', todayMinutes: 60 }, at(1));
    await plan.add(f.ctx, 'today', { cardId: 'c2', priority: '普通' }, at(2));
    f.clock(nextMorning(f)); await newDay(f.ctx);
    const today = await read(f, day(nextMorning(f), f));
    expect(today).toMatchObject({ rolled_over: true, carried_from: day(at(), f), carried_confirmed: false });
    expect(today.items.map(i => [i.card_id, i.priority, i.carried])).toEqual([['c1', '高', true], ['c2', '普通', true]]);
    const text = (await f.ctx.repos.plans.read(day(nextMorning(f), f))).text;
    f.clock(nextMorning(f, 30)); await newDay(f.ctx);
    expect((await f.ctx.repos.plans.read(day(nextMorning(f), f))).text).toBe(text);
  });

  it('前一晚排了明天：第二天文件已在，照样带一次；已排的不重复带', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c1', priority: '普通', todayMinutes: 60 }, at(1));
    await plan.add(f.ctx, 'today', { cardId: 'c2', priority: '普通' }, at(2));
    await plan.add(f.ctx, 'tomorrow', { cardId: 'c2', priority: '高' }, at(3));
    f.clock(nextMorning(f)); await newDay(f.ctx);
    const today = await read(f, day(nextMorning(f), f));
    expect(today.items.map(i => [i.card_id, i.priority, i.carried])).toEqual([['c2', '高', false], ['c1', '普通', true]]);
  });

  it('确认带过来的：留下的转成普通项，去勾的去掉', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c1', priority: '普通', todayMinutes: 60 }, at(1));
    await plan.add(f.ctx, 'today', { cardId: 'c2', priority: '普通' }, at(2));
    f.clock(nextMorning(f)); await newDay(f.ctx);
    await plan.confirmCarry(f.ctx, ['c2'], nextMorning(f, 1));
    const today = await read(f, day(nextMorning(f), f));
    expect(today).toMatchObject({ carried_confirmed: true, items: [{ card_id: 'c2', carried: false }] });
  });

  it('同一天重启：从抽屉直接开始一张没排的卡，不会被加进板子（已定 11、49 提议 4）', async () => {
    const f = await setup();
    f.clock(at(5)); await runTx(f.ctx, tx => startCardInTx(tx, 'c3'), at(5));
    f.clock(at(10)); await newDay(f.ctx);
    expect((await read(f, day(at(10), f))).items).toEqual([]);
  });

  it('真的跨过换日时间还在计的卡：直接加进今天、不用确认', async () => {
    const f = await setup();
    f.clock(at(5)); await runTx(f.ctx, tx => startCardInTx(tx, 'c2'), at(5));
    f.clock(nextMorning(f)); await newDay(f.ctx);
    const today = await read(f, day(nextMorning(f), f));
    expect(today.items).toMatchObject([{ card_id: 'c2', carried: false, today_minutes: null }]);
    expect(today.carried_confirmed).toBe(true);
  });

  it('在计的时间盒卡跨夜计满了：不加进今天（代码审核 S1）', async () => {
    const f = await setup();
    f.clock(at(5)); await runTx(f.ctx, tx => startCardInTx(tx, 'c1'), at(5));   // 120 分钟，计了一夜
    f.clock(nextMorning(f)); await newDay(f.ctx);
    expect((await read(f, day(nextMorning(f), f))).items).toEqual([]);
  });

  it('换日时还在插入中、原来那条是昨天开始的：先结束原任务，原卡回待做并带过来等确认（代码审核 B2）', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c2', priority: '高' }, at(1));
    f.clock(at(5)); await runTx(f.ctx, tx => startCardInTx(tx, 'c2'), at(5));
    const { startFree } = await import('./homeService');
    f.clock(at(10)); await startFree(f.ctx, { description: '接电话', project: '工作', tags: [] }, at(10));
    f.clock(nextMorning(f)); await newDay(f.ctx);
    const s = await f.ctx.repos.state.read();
    expect(s.resume_entry_id).toBeNull();
    expect(f.ctx.repos.times.snapshot().find(e => e.ended_at === null)).toMatchObject({ description: '接电话', kind: '普通' });
    expect((await f.ctx.repos.cards.get('c2'))!.value.status).toBe('待做');
    expect((await read(f, day(nextMorning(f), f))).items).toMatchObject([{ card_id: 'c2', priority: '高', carried: true }]);
  });

  it('同一天重启时还在插入中：不结束原任务', async () => {
    const f = await setup();
    f.clock(at(5)); await runTx(f.ctx, tx => startCardInTx(tx, 'c2'), at(5));
    const { startFree } = await import('./homeService');
    f.clock(at(10)); await startFree(f.ctx, { description: '接电话', project: '工作', tags: [] }, at(10));
    f.clock(at(20)); await newDay(f.ctx);
    expect((await f.ctx.repos.state.read()).resume_entry_id).not.toBeNull();
  });

  it('换日仍写回顾行和 first_used_day（第 2 轮 B1：refreshInTx 没删多）', async () => {
    const f = await setup();
    f.clock(nextMorning(f)); await newDay(f.ctx);
    expect((await f.ctx.repos.state.read()).first_used_day).not.toBeNull();
  });

  it('任务模式关掉时不带、不建文件', async () => {
    const f = await setup();
    await plan.add(f.ctx, 'today', { cardId: 'c1', priority: '普通', todayMinutes: 60 }, at(1));
    f.ctx.settings = { ...f.ctx.settings, taskMode: false };
    f.clock(nextMorning(f)); await newDay(f.ctx);
    expect(await f.ctx.repos.plans.days()).toEqual([day(at(), f)]);
  });
});

describe('PlanRepo', () => {
  it('plans/ 目录不存在时 days() 返回空列表（G5 审核 N5）', async () => {
    const f = fixture();
    expect(await f.ctx.repos.plans.days()).toEqual([]);
  });
});
