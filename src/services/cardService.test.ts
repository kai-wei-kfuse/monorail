import { expect, it } from 'vitest';
import { at, card, fixture, getCard, open, project, seed, segments } from './serviceFixture';
import { start, complete, checkComplete, shrink, redraw, pass, stopToday, leaveTo, editContent } from './cardService';
import { insert, resume, backfillRange } from './timerService';
import { refresh } from './dealService';
import { cardMilliseconds } from '../domain/timeline/stats';

const smaller = { content: '做一小步', type: '结果卡' as const, minutes: null };
it.each([false, true])('edits only content and skip count without changing v1 timing (running=%s)', async running => {
  const f = fixture();
  await seed(f, [card('a', { content: '旧标题', skip_count: 3, blocking: true, due_at: at(60),
    type: '时间盒卡', timebox_minutes: 25, no_shrink: true, progress_note: '已有进度' })]);
  if (running) await start(f.ctx, 'a', at());
  const before = await getCard(f, 'a'), state = await f.ctx.repos.state.read(), history = structuredClone(segments(f));
  f.clock(at(5));
  await editContent(f.ctx, 'a', ' \t新[标题]\n ', at(5));
  expect(await getCard(f, 'a')).toEqual({ ...before, content: '新[标题]', skip_count: 0 });
  expect(await f.ctx.repos.state.read()).toEqual(state);
  expect(segments(f)).toEqual(history);
  expect(f.home().card).toMatchObject({ id: 'a', content: '新[标题]' });
  if (running) expect(open(f).activity).toBe('旧标题');
});
it('rejects blank content and missing cards without committing, then allows another edit', async () => {
  const f = fixture(); await seed(f, [card('a', { skip_count: 2 })]); await start(f.ctx, 'a', at());
  const before = await getCard(f, 'a'), state = await f.ctx.repos.state.read(), history = structuredClone(segments(f));
  f.publish.mockClear();
  await expect(editContent(f.ctx, 'a', ' \t\n ', at())).rejects.toThrow('卡片内容不能为空');
  await expect(editContent(f.ctx, 'missing', '新标题', at())).rejects.toThrow('卡片不存在');
  expect(await getCard(f, 'a')).toEqual(before);
  expect(await f.ctx.repos.state.read()).toEqual(state);
  expect(segments(f)).toEqual(history);
  expect(f.publish).not.toHaveBeenCalled();
  await editContent(f.ctx, 'a', '新标题', at());
  expect(await getCard(f, 'a')).toEqual({ ...before, content: '新标题', skip_count: 0 });
});

it.each(['complete', 'shrink', 'redraw'] as const)('A2 %s ends the insert at the click and clears its return target', async action => {
  const f = fixture(); await seed(f, [card('a'), card('b', { order: 2 })]);
  await start(f.ctx, 'a', at());
  f.clock(at(10)); await insert(f.ctx, 'wc', at(10));
  f.clock(at(20));
  if (action === 'complete') await complete(f.ctx, 'a', at(20), '进度');
  if (action === 'shrink') await shrink(f.ctx, 'a', smaller, at(20));
  if (action === 'redraw') await redraw(f.ctx, 'a', at(20), '再做');
  expect(segments(f).find(s => s.kind === '插入')).toMatchObject({ ended_at: at(20) });
  expect(open(f)).toMatchObject({ kind: '普通', resume_card_id: null, started_at: at(20) });
  expect((await getCard(f, 'a')).status).toBe(action === 'complete' ? '已完成' : action === 'shrink' ? '已缩小' : '待做');
  expect(cardMilliseconds(segments(f), 'a', at(20))).toBe(10 * 60000);
  if (action === 'shrink') expect((await getCard(f, open(f).card_id!)).status).toBe('进行中');
  else expect(open(f).category).toBe('待机');
  await expect(resume(f.ctx, at(20))).rejects.toThrow('没有插入');
});
it('A2 checks effective time without stopping, then completes at the original click across the day boundary', async () => {
  const f = fixture(), begin = new Date(2026, 9, 27, 3).toISOString(), click = new Date(2026, 9, 27, 3, 50).toISOString();
  f.clock(begin); await seed(f, [card('a', { type: '时间盒卡', timebox_minutes: 60, project_id: 'main' })], [project('main')]);
  await start(f.ctx, 'a', begin);
  f.clock(click);
  await backfillRange(f.ctx, { start: new Date(2026, 9, 27, 3, 20).toISOString(), end: new Date(2026, 9, 27, 3, 40).toISOString() }, 'wc', click);
  const before = segments(f);
  expect(await checkComplete(f.ctx, 'a', click)).toEqual({ at: click, remainingMinutes: 30 });
  expect(segments(f)).toEqual(before);
  f.clock(new Date(2026, 9, 27, 4, 10).toISOString());
  await complete(f.ctx, 'a', click, '先到这里');
  expect(await getCard(f, 'a')).toMatchObject({ completed_at: click, completed_day: '2026-10-26', completed_track: '主线' });
  expect(open(f)).toMatchObject({ category: '待机', started_at: click });
  expect(cardMilliseconds(segments(f), 'a', f.ctx.now())).toBe(30 * 60000);
});
it('creates one independent continuation and repeated completion cannot create another', async () => {
  const f = fixture(); await seed(f, [card('a', { blocking: true, due_at: at(60), project_id: 'main' })], [project('main')]);
  await start(f.ctx, 'a', at()); f.clock(at(5));
  await complete(f.ctx, 'a', at(5), '当前进度', true);
  await complete(f.ctx, 'a', at(5), '重复点击', true);
  const cards = (await f.ctx.repos.cards.list()).map(e => e.value), next = cards.find(c => c.id !== 'a')!;
  expect(cards).toHaveLength(2);
  expect(next).toMatchObject({ status: '待做', continued_from: 'a', blocking: true, due_at: at(60), project_id: 'main', progress_note: '当前进度' });
  expect((await f.ctx.repos.state.read()).current_card).toBe(next.id);
  expect(open(f).category).toBe('待机');
});
it('A6 completes a two-level chain restoring only the immediate parent and its progress', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  const b = await shrink(f.ctx, 'a', smaller, at()), c = await shrink(f.ctx, b, smaller, at());
  await expect(complete(f.ctx, c, at(), '禁止续卡', true)).rejects.toThrow('不能生成续卡');
  expect((await getCard(f, c)).status).toBe('进行中');
  await complete(f.ctx, c, at(), 'C进度');
  expect(await getCard(f, b)).toMatchObject({ status: '待做', progress_note: 'C进度' });
  expect((await getCard(f, 'a')).status).toBe('已缩小');
  await start(f.ctx, b, at()); await complete(f.ctx, b, at(), 'B进度');
  expect(await getCard(f, 'a')).toMatchObject({ status: '待做', progress_note: 'B进度' });
});
it('A6 PASS restores the parent, allows replacement at the same level, and forbids passing an ancestor', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  const b = await shrink(f.ctx, 'a', smaller, at()), c = await shrink(f.ctx, b, smaller, at());
  await expect(pass(f.ctx, 'a', at())).rejects.toThrow('先处理');
  await pass(f.ctx, c, at());
  const replacement = await shrink(f.ctx, b, smaller, at());
  expect(await getCard(f, replacement)).toMatchObject({ shrink_level: 2, shrunk_from: b });
  await pass(f.ctx, replacement, at()); await pass(f.ctx, b, at());
  expect((await getCard(f, 'a')).status).toBe('待做');
});
it.each([false, true])('stopping today releases the card and any insert (%s), then restores dealing at 04:00', async inserted => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  if (inserted) await insert(f.ctx, 'wc', at());
  await stopToday(f.ctx, at());
  expect((await getCard(f, 'a')).status).toBe('待做');
  expect(open(f)).toMatchObject({ category: '待机', resume_card_id: null });
  const before = new Date(2026, 9, 28, 3, 59).toISOString(); f.clock(before); await refresh(f.ctx, before);
  expect(f.home().mode).toBe('stopped');
  const boundary = new Date(2026, 9, 28, 4).toISOString(); f.clock(boundary); await refresh(f.ctx, boundary);
  expect(f.home()).toMatchObject({ mode: 'task', card: { id: 'a', status: '待做' } });
});
it('leaveTo releases the running card while switching to the chosen activity', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  await leaveTo(f.ctx, 'wc', at());
  expect((await getCard(f, 'a')).status).toBe('待做');
  expect(open(f)).toMatchObject({ activity: '厕所', card_id: null, kind: '普通', resume_card_id: null });
});
it('the third redraw emits one skip signal, and shrinking clears skip counts', async () => {
  const f = fixture(); f.ctx.settings.refusalThreshold = 10; await seed(f, [card('a')]);
  for (let i = 0; i < 4; i++) {
    await redraw(f.ctx, 'a', at());
    expect(f.publish.mock.calls.at(-1)![0].notices.filter(n => n.kind === 'skipSignal')).toHaveLength(i === 2 ? 1 : 0);
  }
  const child = await shrink(f.ctx, 'a', smaller, at());
  expect((await getCard(f, 'a')).skip_count).toBe(0);
  expect((await getCard(f, child)).skip_count).toBe(0);
});
it('a rejected shrink changes neither card, timer nor refusal count and the next action still works', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  const state = await f.ctx.repos.state.read(), before = segments(f);
  await expect(shrink(f.ctx, 'a', { ...smaller, content: ' ' }, at())).rejects.toThrow('不能为空');
  expect(await f.ctx.repos.state.read()).toEqual(state); expect(segments(f)).toEqual(before);
  expect(await f.ctx.repos.cards.list()).toHaveLength(1);
  expect((await getCard(f, 'a')).status).toBe('进行中');
  await complete(f.ctx, 'a', at(), '完成');
  expect((await getCard(f, 'a')).status).toBe('已完成');
});
