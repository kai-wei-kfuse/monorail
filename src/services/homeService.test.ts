import { expect, it } from 'vitest';
import { fixture, at, card, task, seed, entries, open, getCard } from './serviceFixture';
import { start, redraw } from './cardService';
import { insert, resume, pause, stop, backfillRange, settleOffline, answerOffline, sleep, wake, beginPending, cancelPending, startFree, startCard, commitReadout } from './homeService';
import { activeRefInTx } from './tracking/api';
import { run } from './commit';

it('A2 nested insert/pause keeps one return target and excludes interruptions from card time', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
  f.clock(at(15)); await pause(f.ctx, at(15));
  f.clock(at(20)); await resume(f.ctx, at(20));
  expect(open(f)).toMatchObject({ card_id: 'c', project: '未分类' });
  expect(f.home().closedEffectiveMs).toBe(10 * 60000);
});
it('stop ends the open entry into idle without a return target and releases the card', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
  f.clock(at(15)); await stop(f.ctx, at(15));
  expect(open(f)).toMatchObject({ project: '待机', card_id: null, started_at: at(15) });
  expect((await f.ctx.repos.state.read()).resume_entry_id).toBeNull();
  expect((await getCard(f, 'c')).status).not.toBe('进行中');
  f.clock(at(20)); await resume(f.ctx, at(20));
  expect(open(f)).toMatchObject({ project: '待机' });
});
it('A1 manual backfill coexists with work, while invalid/future ranges fail', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(60)); await backfillRange(f.ctx, { start: at(20), end: at(40) }, 'wc', at(60));
  expect(open(f).started_at).toBe(at());
  expect(entries(f).filter(entry => entry.source === '手动')).toHaveLength(1);
  expect(f.home()).toMatchObject({ currentSegStartedAt: at(), closedEffectiveMs: 0 });
  await expect(backfillRange(f.ctx, { start: at(20), end: at(70) }, 'wc', at(60))).rejects.toThrow('现在');
  await expect(backfillRange(f.ctx, { start: at(40), end: at(20) }, 'wc', at(60))).rejects.toThrow('晚于');
});
it('stores cross-day manual work as one entry', async () => {
  const f = fixture(), start = new Date(2026, 9, 27, 3, 30).toISOString(), end = new Date(2026, 9, 27, 4, 30).toISOString();
  f.clock(end); await backfillRange(f.ctx, { start, end }, 'wc', end);
  const rows = entries(f).filter(entry => entry.source === '手动');
  expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ started_at: start, ended_at: end });
});
it('settles offline once and releases the running card in the same publish; answer edits the existing entry', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(60)); const gap = { start: at(10), end: at(60) };
  const offline = await settleOffline(f.ctx, gap);
  expect(offline).toMatchObject({ description: '离线', source: '离线追问' });
  expect(await settleOffline(f.ctx, gap)).toBeNull();
  expect(await getCard(f, 'c')).toMatchObject({ status: '待做' });
  expect(f.publish.mock.calls.at(-1)![0]).toMatchObject({ state: { current_card: null }, home: { mode: 'blank' } });
  await answerOffline(f.ctx, gap, '睡觉', at(60));
  expect(entries(f).find(entry => entry.id === offline!.id)).toMatchObject({ project: '睡眠', description: '睡觉' });
  expect(entries(f).filter(entry => entry.source === '离线追问')).toHaveLength(1);
  await run(f.ctx, async tx => { expect(activeRefInTx(tx)).toBeNull(); });
});
it('short offline gaps do not change activity', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(4)); const before = open(f);
  expect(await settleOffline(f.ctx, { start: at(), end: at(4) })).toBeNull(); expect(open(f)).toEqual(before);
});
it('free-typed insert trims and rejects blanks; no target resumes idle', async () => {
  const f = fixture(); await insert(f.ctx, ' 拿快递 ', at());
  expect(open(f)).toMatchObject({ description: '拿快递', project: '生活' });
  await expect(insert(f.ctx, ' ', at())).rejects.toThrow('不能为空');
  f.clock(at(5)); await resume(f.ctx, at(5)); expect(open(f).project).toBe('待机');
});
it('sleep releases a card without stopping future draws; wake returns to idle', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(10)); await sleep(f.ctx, at(10));
  expect((await getCard(f, 'c')).status).toBe('待做');
  expect(await f.ctx.repos.state.read()).not.toHaveProperty('stopped_day');
  expect(open(f).project).toBe('睡眠');
  f.clock(at(20)); await wake(f.ctx, at(20)); expect(open(f).project).toBe('待机');
});
it('pending ID survives a start-time edit and old cancellation cannot affect another session', async () => {
  const f = fixture(); await beginPending(f.ctx, at());
  const old = (await f.ctx.repos.state.read()).pending_id!;
  await cancelPending(f.ctx, old, at()); f.clock(at(5)); await beginPending(f.ctx, at(5));
  const current = (await f.ctx.repos.state.read()).pending_id!;
  await commitReadout(f.ctx, { target: { mode: 'pending', id: current }, at: at(5), milliseconds: 5 * 60000 }, null);
  await expect(cancelPending(f.ctx, old, at(5))).rejects.toThrow('会话已改变');
  await expect(commitReadout(f.ctx, { target: { mode: 'pending', id: old }, at: at(5), milliseconds: 0 }, null)).rejects.toThrow('会话已改变');
  expect((await f.ctx.repos.state.read()).pending_id).toBe(current); expect(current).not.toBe(old);
  await startFree(f.ctx, { description: 'free', project: '学习', tags: [] }, at(5));
  expect(await f.ctx.repos.state.read()).toMatchObject({ pending_id: null, pending_at: null });
});
it('starting a backpack card switches from active/paused/rest/pending states, is idempotent on repeat click, and rejects parked tasks', async () => {
  const f = fixture();
  f.ctx.settings.refusalThreshold = 1;
  await seed(f, [
    card('c1', { task_id: 'm1', content: '改 [简历]' }),
    card('c2', { task_id: 'm1', content: '投 5 家公司', order: 2 }),
    card('s1', { task_id: 'side1', content: '研究CPA无损更新方法', order: 3 }),
    card('cold-card', { task_id: 'cold', content: '冷藏事项', order: 4 }),
  ], [
    { ...task('m1'), default_project: '求职' },
    { ...task('side1'), slot: '支线', slot_index: 2, default_project: '未分类' },
    { ...task('cold'), slot: '支线', slot_index: null, status: '冷藏' },
  ]);

  // 1. 待确认（pending）中从背包点击开始：沿用 pending_at 作为计时起点并清理 pending
  await beginPending(f.ctx, at(2));
  f.clock(at(5));
  await startCard(f.ctx, 's1', at(5));
  expect(open(f)).toMatchObject({ card_id: 's1', description: '研究CPA无损更新方法', project: '未分类', started_at: at(2) });
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 's1', home_mode: 'task', pending_id: null, pending_at: null });
  expect(f.publish.mock.calls.at(-1)![0].backpack.pool.sides[0].items[0].running).toBe(true);

  // 2. 连续点击同一张进行中的卡：幂等不新建重复计时条目
  const entryId = open(f).id;
  const countBefore = entries(f).length;
  f.clock(at(6));
  await startCard(f.ctx, 's1', at(6));
  expect(open(f).id).toBe(entryId);
  expect(entries(f)).toHaveLength(countBefore);

  // 3. 切换到另一张卡（如主线下的小任务 c1）：自动释放旧卡 s1 并开始新卡
  f.clock(at(10));
  await startCard(f.ctx, 'c1', at(10));
  expect((await getCard(f, 's1')).status).toBe('待做');
  expect((await getCard(f, 'c1')).status).toBe('进行中');
  expect(open(f)).toMatchObject({ card_id: 'c1', description: '改 简历', project: '求职', started_at: at(10) });

  // 4. 暂停后从背包直接启动另一张小任务 c2
  f.clock(at(15));
  await pause(f.ctx, at(15));
  f.clock(at(18));
  await startCard(f.ctx, 'c2', at(18));
  expect((await getCard(f, 'c1')).status).toBe('待做');
  expect((await getCard(f, 'c2')).status).toBe('进行中');
  expect(open(f)).toMatchObject({ card_id: 'c2', description: '投 5 家公司', project: '求职', started_at: at(18) });

  // 5. 降级休息中从背包直接启动卡片：清除 rest 并切到该卡计时
  f.clock(at(20));
  await redraw(f.ctx, 'c2', at(20));
  expect((await f.ctx.repos.state.read()).rest).not.toBeNull();
  expect(open(f).project).toBe('休息');
  f.clock(at(25));
  await startCard(f.ctx, 's1', at(25));
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 's1', home_mode: 'task', rest: null });
  expect(open(f)).toMatchObject({ card_id: 's1', started_at: at(25) });

  // 6. 不在背包的卡片抛错拒绝
  await expect(startCard(f.ctx, 'cold-card', at(26))).rejects.toThrow('不在背包');
});
