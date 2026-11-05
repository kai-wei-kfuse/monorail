import { expect, it } from 'vitest';
import { fixture, at, card, task, seed, entries, open, getCard } from './serviceFixture';
import { start } from './cardService';
import { registerRefusalInTx } from './degradeService';
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
it('0.3.1：插入状态下不能停止（已定 57，ADR 0021 第 3 条）；不在插入时停止照旧清回到目标、放回卡', async () => {
  const f = fixture(); await seed(f, [card('c')]); await start(f.ctx, 'c', at());
  f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
  await expect(stop(f.ctx, at(15))).rejects.toThrow('IN_AWAY_ACTIVITY');
  f.clock(at(12)); await resume(f.ctx, at(12));
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
  await run(f.ctx, async tx => { expect(activeRefInTx(tx)).toBeNull(); }, undefined, { action: 'test.direct' });
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
  await run(f.ctx, async tx => { tx.state.refusals = [at(20), at(20), at(20)]; await registerRefusalInTx(tx); }, at(20), { action: 'test.direct' });
  expect((await f.ctx.repos.state.read()).rest).not.toBeNull();
  expect(open(f).project).toBe('休息');
  f.clock(at(25));
  await startCard(f.ctx, 's1', at(25));
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 's1', home_mode: 'task', rest: null });
  expect(open(f)).toMatchObject({ card_id: 's1', started_at: at(25) });

  // 6. 不在背包的卡片抛错拒绝
  await expect(startCard(f.ctx, 'cold-card', at(26))).rejects.toThrow('不在背包');
});
it('ADR 0006: projects resumeEntry across consecutive/paused inserts, recomputes partial/full readout overwrite, and preserves claim/pending rules', async () => {
  const f = fixture();
  await seed(f, [card('c1', { content: '写论文' })]);

  // 1. 自由记录 -> 插入「上厕所」-> 连续插入「拿快递」：resumeEntry 始终保持为「学 408」及离开时刻 endedAt
  await startFree(f.ctx, { description: '学 408', project: '学习', tags: ['408'] }, at(0));
  const studyId = open(f).id;
  f.clock(at(25));
  await insert(f.ctx, '上厕所', at(25));
  expect(f.home().entry).toMatchObject({ description: '上厕所', kind: '插入', startedAt: at(25) });
  expect(f.home().resumeEntry).toMatchObject({ id: studyId, description: '学 408', project: '学习', tags: ['408'], startedAt: at(0), endedAt: at(25) });

  f.clock(at(27));
  await insert(f.ctx, '拿快递', at(27));
  const parcelId = open(f).id;
  expect(f.home().entry).toMatchObject({ id: parcelId, description: '拿快递', kind: '插入', startedAt: at(27) });
  expect(f.home().resumeEntry).toMatchObject({ id: studyId, description: '学 408', startedAt: at(0), endedAt: at(25) });

  // 2. 部分覆盖：将「拿快递」(27..30) 读数改为 15 分钟（起点前移至 at(15)），截短「学 408」为 0..15，resumeEntry 仍保留
  f.clock(at(30));
  const partialPreview = await commitReadout(f.ctx, { target: { mode: 'entry', id: parcelId }, at: at(30), milliseconds: 15 * 60000 }, null);
  expect(partialPreview.kind).toBe('confirm');
  if (partialPreview.kind === 'confirm') {
    const partialDone = await commitReadout(f.ctx, { target: { mode: 'entry', id: parcelId }, at: at(30), milliseconds: 15 * 60000 }, partialPreview.plan);
    expect(partialDone.kind).toBe('done');
  }
  expect(f.home().resumeEntry).toMatchObject({ id: studyId, description: '学 408', startedAt: at(0), endedAt: at(15) });
  f.clock(at(32));
  await resume(f.ctx, at(32));
  expect(open(f)).toMatchObject({ description: '学 408', project: '学习', tags: ['408'], kind: '普通', started_at: at(32) });

  // 3. 从暂停状态插入临时活动：保留暂停前的 resumeEntry
  f.clock(at(40));
  await pause(f.ctx, at(40));
  const pausedTargetId = f.home().resumeEntry?.id;
  expect(pausedTargetId).toBeTruthy();
  f.clock(at(42));
  await insert(f.ctx, '喝水', at(42));
  expect(f.home().resumeEntry?.id).toBe(pausedTargetId);

  // 0.3.1：插入中不能直接开始另一张卡（已定 20），先回到原来的事
  await expect(startCard(f.ctx, 'c1', at(43))).rejects.toThrow('IN_AWAY_ACTIVITY');
  f.clock(at(44)); await resume(f.ctx, at(44));

  // 4. 任务卡进行中插入临时活动 + 待确认并存 + 完全覆盖导致返回目标失效与卡释放（同时保留 pending）
  f.clock(at(50));
  await startCard(f.ctx, 'c1', at(50));
  f.clock(at(60));
  await insert(f.ctx, '上厕所', at(60));
  const wcId = open(f).id;
  expect(f.home().card?.status).toBe('进行中');
  expect(f.home().resumeEntry).toMatchObject({ cardId: 'c1', startedAt: at(50), endedAt: at(60) });

  // 在临时活动期间开启 pending（at(62)）并修改 pending 读数
  f.clock(at(62));
  await beginPending(f.ctx, at(62));
  const pid = f.home().pending!.id;
  await commitReadout(f.ctx, { target: { mode: 'pending', id: pid }, at: at(62), milliseconds: 60000 }, null);
  expect(f.home().pending).toEqual({ id: pid, startedAt: at(61) });

  // 完全覆盖：在 at(65) 将「上厕所」读数改为 20 分钟（起点前移至 at(45) <= at(50)），完全覆盖 c1 的运行段
  f.clock(at(65));
  const fullPreview = await commitReadout(f.ctx, { target: { mode: 'entry', id: wcId }, at: at(65), milliseconds: 20 * 60000 }, null);
  expect(fullPreview.kind).toBe('confirm');
  if (fullPreview.kind === 'confirm') {
    await commitReadout(f.ctx, { target: { mode: 'entry', id: wcId }, at: at(65), milliseconds: 20 * 60000 }, fullPreview.plan);
  }
  expect((await f.ctx.repos.state.read()).resume_entry_id).toBeNull();
  expect((await getCard(f, 'c1')).status).toBe('待做');
  expect(f.home().resumeEntry).toBeNull();
  expect(f.home().card).toBeNull();
  // 完全覆盖返回目标后，原有的 pending ID 与起点仍然保留
  expect(f.home().pending).toEqual({ id: pid, startedAt: at(61) });

  // 取消 pending，临时活动保持运行；随后点「回来」因无返回目标转为待机
  f.clock(at(66));
  await cancelPending(f.ctx, pid, at(66));
  expect(f.home().pending).toBeNull();
  expect(open(f).id).toBe(wcId);
  f.clock(at(67));
  await resume(f.ctx, at(67));
  expect(open(f)).toMatchObject({ project: '待机', kind: '普通', started_at: at(67) });

  // 5. 验证两条 pending + 插入路径的 claim 时间语义：
  // 路径 A：先 pending(at(70))、再点快捷活动(at(75))、后写新事件(at(80))。0.3.1（第 2 轮 B3）：每个入口都用待确认起点并清掉它，
  // 不再和 0.2.5 一样让插入与待确认并存 -> 洗手从 at(70) 开始，待确认清空；at(80) 的新事件从 at(80) 开始
  f.clock(at(70));
  await beginPending(f.ctx, at(70));
  f.clock(at(75));
  await insert(f.ctx, '洗手', at(75));
  const washId = open(f).id;
  expect(await f.ctx.repos.state.read()).toMatchObject({ pending_id: null, pending_at: null });
  f.clock(at(80));
  await startFree(f.ctx, { description: '路径A新活动', project: '工作', tags: [] }, at(80));
  expect(entries(f).find(e => e.id === washId)).toMatchObject({ started_at: at(70), ended_at: at(80) });
  expect(open(f)).toMatchObject({ description: '路径A新活动', started_at: at(80) });

  // 路径 B：先插入(at(90))、再 pending(at(95))、后确认(at(100)) -> 插入段在 at(95) 截断，新活动从 at(95) 开始
  f.clock(at(90));
  await insert(f.ctx, '倒水', at(90));
  const waterId = open(f).id;
  f.clock(at(95));
  await beginPending(f.ctx, at(95));
  f.clock(at(100));
  await startFree(f.ctx, { description: '路径B新活动', project: '工作', tags: [] }, at(100));
  expect(entries(f).find(e => e.id === waterId)).toMatchObject({ started_at: at(90), ended_at: at(95) });
  // 0.3.1（ADR 0021 第 3 条入口表）：插入中写新事件 = 替换插入的事，原来那条照样等着回去
  expect(open(f)).toMatchObject({ description: '路径B新活动', started_at: at(95), kind: '插入' });
  expect((await f.ctx.repos.state.read()).resume_entry_id).not.toBeNull();
});

it('stopping while paused clears resume_entry_id and releases an in-progress card back to todo', async () => {
  const f = fixture();
  await seed(f, [card('c1', { content: '写测试' })]);
  await startCard(f.ctx, 'c1', at(0));
  f.clock(at(10));
  await pause(f.ctx, at(10));
  expect(open(f)).toMatchObject({ project: '待机', kind: '暂停' });
  expect((await f.ctx.repos.state.read()).resume_entry_id).not.toBeNull();
  expect((await getCard(f, 'c1')).status).toBe('进行中');

  f.clock(at(15));
  await stop(f.ctx, at(15));
  expect(open(f)).toMatchObject({ project: '待机', kind: '普通', started_at: at(15) });
  expect((await f.ctx.repos.state.read()).resume_entry_id).toBeNull();
  expect((await getCard(f, 'c1')).status).toBe('待做');
  expect((await f.ctx.repos.state.read()).current_card).toBeNull();
  expect(f.home().resumeEntry).toBeNull();
});
