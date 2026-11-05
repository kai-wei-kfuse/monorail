import { expect, it } from 'vitest';
import { at, card, fixture, getCard, open, task, seed, entries } from './serviceFixture';
import { start, complete, checkComplete, split, pass, editContent } from './cardService';
import { run } from './commit';
import { shrinkCard } from '../data/migrations/v030/shrink';
import type { Card } from '../domain/card/card';
import { insert, backfillRange } from './homeService';
import { cardMilliseconds } from '../domain/timeline/stats';

const halves = { todayContent: '先做一小步', restContent: '剩下的', restMinutes: null };
/** 0.3.0 留下的「已缩小」链（0.3.1 不再产生）：用冻结的 0.3.0 缩小直接写进数据目录 */
async function legacyChain(f: ReturnType<typeof fixture>, rootId: string, depth: number): Promise<string[]> {
  const ids = [rootId];
  await run(f.ctx, async tx => {
    let cur = tx.cards.find(c => c.id === rootId)!;
    for (let i = 0; i < depth; i++) {
      const { parent, child } = shrinkCard(cur, { id: `${rootId}-l${i + 1}`, at: at(), content: '做一小步', type: '结果卡', minutes: null, order: 10 + i, maxLevel: 9 });
      tx.saveCard(parent); tx.saveCard(child); ids.push(child.id); cur = child;
    }
    tx.state.current_card = cur.id; tx.state.home_mode = 'task';
  }, at(), { action: 'test.direct' });
  return ids;
}
it.each([false, true])('edits only content and skip count and renames only the running entry (running=%s)', async running => {
  const f = fixture();
  await seed(f, [card('a', { content: '旧标题', skip_count: 3, blocking: true, due_at: at(60),
    type: '时间盒卡', timebox_minutes: 25, no_shrink: true, progress_note: '已有进度' })]);
  if (running) await start(f.ctx, 'a', at());
  const before = await getCard(f, 'a'), state = await f.ctx.repos.state.read(), history = structuredClone(entries(f));
  f.clock(at(5));
  await editContent(f.ctx, 'a', ' \t新[标题]\n ', at(5));
  expect(await getCard(f, 'a')).toEqual({ ...before, content: '新[标题]', skip_count: 0 });
  expect(await f.ctx.repos.state.read()).toEqual(state);
  expect(entries(f)).toEqual(running ? history.map(entry => entry.ended_at === null ? { ...entry, description: '新标题', updated_at: at(5) } : entry) : history);
  expect(f.home().card).toMatchObject({ id: 'a', content: '新[标题]' });
  if (running) expect(open(f).description).toBe('新标题');
});
it('rejects blank content and missing cards without committing, then allows another edit', async () => {
  const f = fixture(); await seed(f, [card('a', { skip_count: 2 })]); await start(f.ctx, 'a', at());
  const before = await getCard(f, 'a'), state = await f.ctx.repos.state.read(), history = structuredClone(entries(f));
  f.publish.mockClear();
  await expect(editContent(f.ctx, 'a', ' \t\n ', at())).rejects.toThrow('卡片内容不能为空');
  await expect(editContent(f.ctx, 'missing', '新标题', at())).rejects.toThrow('卡片不存在');
  expect(await getCard(f, 'a')).toEqual(before);
  expect(await f.ctx.repos.state.read()).toEqual(state);
  expect(entries(f)).toEqual(history);
  expect(f.publish).not.toHaveBeenCalled();
  await editContent(f.ctx, 'a', '新标题', at());
  expect(await getCard(f, 'a')).toEqual({ ...before, content: '新标题', skip_count: 0 });
});

it('A2 complete ends the insert at the click and clears its return target', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b', { order: 2 })]);
  await start(f.ctx, 'a', at());
  f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
  f.clock(at(20)); await complete(f.ctx, 'a', at(20), '进度');
  expect(entries(f).find(s => s.kind === '插入')).toMatchObject({ ended_at: at(20) });
  expect(open(f)).toMatchObject({ kind: '普通', started_at: at(20), project: '待机' });
  expect((await getCard(f, 'a')).status).toBe('已完成');
  expect(cardMilliseconds(entries(f), 'a', at(20))).toBe(10 * 60000);
  expect((await f.ctx.repos.state.read()).resume_entry_id).toBeNull();
});
it('A2 checks effective time without stopping, then completes at the original click across the day boundary', async () => {
  const f = fixture(), begin = new Date(2026, 9, 27, 3).toISOString(), click = new Date(2026, 9, 27, 3, 50).toISOString();
  f.clock(begin); await seed(f, [card('a', { type: '时间盒卡', timebox_minutes: 60, task_id: 'main' })], [task('main')]);
  await start(f.ctx, 'a', begin);
  f.clock(click);
  await backfillRange(f.ctx, { start: new Date(2026, 9, 27, 3, 20).toISOString(), end: new Date(2026, 9, 27, 3, 40).toISOString() }, 'wc', click);
  const before = entries(f);
  expect(await checkComplete(f.ctx, 'a', click)).toEqual({ at: click, remainingMinutes: 10 });
  expect(entries(f)).toEqual(before);
  f.clock(new Date(2026, 9, 27, 4, 10).toISOString());
  await complete(f.ctx, 'a', click, '先到这里');
  expect(await getCard(f, 'a')).toMatchObject({ completed_at: click, completed_day: '2026-10-26', completed_track: '主线' });
  expect(open(f)).toMatchObject({ project: '待机', started_at: click });
  expect(cardMilliseconds(entries(f), 'a', f.ctx.now())).toBe(50 * 60000);
});
it('接着做 = 同一张卡（已定 5）：不记完成、写做到哪了、回待做、停计时；不新建续卡，重复点击不重复', async () => {
  const f = fixture(); await seed(f, [card('a', { due_at: at(60), task_id: 'main' })], [task('main')]);
  await start(f.ctx, 'a', at()); f.clock(at(5));
  await complete(f.ctx, 'a', at(5), '当前进度', true);
  await expect(complete(f.ctx, 'a', at(5), '重复点击', true)).rejects.toThrow('首页卡片已改变');
  const cards = (await f.ctx.repos.cards.list()).map(e => e.value);
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ id: 'a', status: '待做', progress_note: '当前进度', completed_at: null, continued_from: null });
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: null, home_mode: 'blank' });
  expect(open(f).project).toBe('待机');
  expect(cardMilliseconds(entries(f), 'a', at(5))).toBe(5 * 60000);
});
it('拆分出来的卡也能接着做（第 2 轮 S4）', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main' })], [task('main')]); await start(f.ctx, 'a', at());
  const rest = await split(f.ctx, 'a', halves, at());
  f.clock(at(1)); await start(f.ctx, rest, at(1)); f.clock(at(3));
  await complete(f.ctx, rest, at(3), '做到一半', true);
  expect(await getCard(f, rest)).toMatchObject({ status: '待做', progress_note: '做到一半', shrunk_from: 'a' });
});
it('旧的「已缩小」链（0.3.0 数据）：完成叶子只恢复直接父卡和它的进度', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  const [, b, c] = await legacyChain(f, 'a', 2);
  await start(f.ctx, c, at()); await complete(f.ctx, c, at(), 'C进度');
  expect(await getCard(f, b)).toMatchObject({ status: '待做', progress_note: 'C进度' });
  expect((await getCard(f, 'a')).status).toBe('已缩小');
  await start(f.ctx, b, at()); await complete(f.ctx, b, at(), 'B进度');
  expect(await getCard(f, 'a')).toMatchObject({ status: '待做', progress_note: 'B进度' });
});
it('旧的「已缩小」链：PASS 叶子恢复父卡，不能 PASS 已缩小的祖先', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  const [, b, c] = await legacyChain(f, 'a', 2);
  await expect(pass(f.ctx, 'a', at())).rejects.toThrow('先处理');
  await pass(f.ctx, c, at());
  expect((await getCard(f, b)).status).toBe('待做');
  await pass(f.ctx, b, at());
  expect((await getCard(f, 'a')).status).toBe('待做');
});
it('缩小 = 拆成两张（已定 50）：原卡改内容接着计、id 不变；rest 排在后面、不在板子上；开着的计时描述跟着改', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main', content: '读第 4 章', order: 1 }), card('z', { task_id: 'main', order: 2 })], [task('main')]);
  await start(f.ctx, 'a', at()); f.clock(at(10));
  const rest = await split(f.ctx, 'a', { todayContent: '只读 4.1–4.3', restContent: '4.4 以后', restMinutes: null }, at(10));
  expect(await getCard(f, 'a')).toMatchObject({ content: '只读 4.1–4.3', status: '进行中', shrink_level: 1 });
  expect(await getCard(f, rest)).toMatchObject({ content: '4.4 以后', status: '待做', shrunk_from: 'a', split_note: '读第 4 章' } as Partial<Card>);
  const orders = Object.fromEntries((await f.ctx.repos.cards.list()).map(e => [e.value.id, e.value.order]));
  expect(orders.a).toBeLessThan(orders[rest]); expect(orders[rest]).toBeLessThan(orders.z);
  expect(open(f)).toMatchObject({ card_id: 'a', description: '只读 4.1–4.3', started_at: at() });
  expect(entries(f).filter(e => e.card_id === rest)).toEqual([]);
});
it('时间盒拆分：今天的量改成今天做的分钟；剩下的分钟放到 rest；不再计拒绝次数', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 'main', type: '时间盒卡', timebox_minutes: 120 })], [task('main')]);
  const { add } = await import('./planService');
  await add(f.ctx, 'today', { cardId: 'a', priority: '普通', todayMinutes: 60 }, at());
  await start(f.ctx, 'a', at()); f.clock(at(18));
  const rest = await split(f.ctx, 'a', { todayContent: '前半', restContent: '后半', restMinutes: 25 }, at(18));
  expect(await getCard(f, 'a')).toMatchObject({ timebox_minutes: 95 });
  expect(await getCard(f, rest)).toMatchObject({ timebox_minutes: 25, type: '时间盒卡' });
  const day = (await f.ctx.repos.plans.days())[0];
  expect((await f.ctx.repos.plans.read(day)).value.items).toEqual([expect.objectContaining({ card_id: 'a', today_minutes: 35 })]);
  expect((await f.ctx.repos.state.read()).refusals).toEqual([]);
});
it('拆分被拒绝时卡、计时都不变，之后的操作照常', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  const state = await f.ctx.repos.state.read(), before = entries(f);
  await expect(split(f.ctx, 'a', { ...halves, todayContent: ' ' }, at())).rejects.toThrow('两句都要写');
  expect(await f.ctx.repos.state.read()).toEqual(state); expect(entries(f)).toEqual(before);
  expect(await f.ctx.repos.cards.list()).toHaveLength(1);
  expect((await getCard(f, 'a')).status).toBe('进行中');
  await complete(f.ctx, 'a', at(), '完成');
  expect((await getCard(f, 'a')).status).toBe('已完成');
});
