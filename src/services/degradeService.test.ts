import { expect, it } from 'vitest';
import { at, card, fixture, getCard, open, seed, segments } from './serviceFixture';
import { start, redraw, shrink } from './cardService';
import { returnFromRest, registerRefusalInTx } from './degradeService';
import { run } from './commit';
import { effective } from '../domain/timeline/effective';

it('A7 fourth redraw executes first and preserves the new card behind rest', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b', { order: 2 })]);
  for (let i = 0; i < 4; i++) {
    f.clock(at(i)); await redraw(f.ctx, (await f.ctx.repos.state.read()).current_card, at(i));
  }
  expect(await f.ctx.repos.state.read()).toMatchObject({ home_mode: 'rest', current_card: 'a', rest: { started_at: at(3), suggestion: null } });
  expect(await getCard(f, 'b')).toMatchObject({ skip_count: 2, status: '待做' });
  expect(open(f)).toMatchObject({ activity: '休息', source: '自动' });
  f.clock(at(10)); await returnFromRest(f.ctx, ' 看小说 ', at(10));
  expect(await f.ctx.repos.state.read()).toMatchObject({ home_mode: 'task', current_card: 'a', rest: null, refusals: [], rest_answers: { 看小说: 1 } });
  expect(open(f)).toMatchObject({ project: '待机', card_id: null });
  expect(effective(segments(f), at(10)).filter(s => s.started_at === at(3))).toEqual([
    expect.objectContaining({ activity: '看小说', project: '休息', source: '自动', ended_at: at(10) }),
  ]);
  expect(segments(f).some(s => s.activity === '休息' && s.ended_at === at(10))).toBe(true);
});
it('A7 fourth running shrink leaves a pending child and no positive child time before rest', async () => {
  const f = fixture(); await seed(f, [card('a', { skip_count: 2 })]); await start(f.ctx, 'a', at());
  await run(f.ctx, async tx => { tx.state.refusals = [at(), at(1), at(2)]; });
  f.clock(at(3)); const child = await shrink(f.ctx, 'a', { content: '小任务', type: '结果卡', minutes: null }, at(3));
  expect(await getCard(f, child)).toMatchObject({ status: '待做', skip_count: 0 });
  expect(await getCard(f, 'a')).toMatchObject({ status: '已缩小', skip_count: 0 });
  expect(open(f)).toMatchObject({ activity: '休息', started_at: at(3) });
  expect(effective(segments(f), at(3)).some(s => s.card_id === child)).toBe(false);
  f.clock(at(5)); await returnFromRest(f.ctx, '', at(5));
  expect(f.home()).toMatchObject({ mode: 'task', card: { id: child, status: '待做' } });
  expect(open(f).project).toBe('待机');
});
it('A7 input hint resets refusals without switching the timer or entering rest', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  await run(f.ctx, async tx => { tx.state.last_rest_ended_at = at(); tx.state.refusals = [at(1), at(2), at(3)]; });
  const before = open(f);
  f.clock(at(4)); await run(f.ctx, registerRefusalInTx, at(4));
  expect(open(f)).toEqual(before);
  expect(await f.ctx.repos.state.read()).toMatchObject({ rest: null, refusals: [], home_mode: 'task' });
  expect(f.publish.mock.calls.at(-1)![0].notices).toEqual([expect.objectContaining({ kind: 'inputHint' })]);
});
it.each(['', '   ', '画画'])('rest answer %j at zero duration does not write an overlay', async answer => {
  const f = fixture(); await seed(f, [card('a')]);
  await run(f.ctx, async tx => { tx.state.refusals = [at(), at(), at()]; await registerRefusalInTx(tx); });
  await returnFromRest(f.ctx, answer, at());
  expect(segments(f)).toHaveLength(2);
  expect(open(f).project).toBe('待机');
  expect(await f.ctx.repos.state.read()).toMatchObject({ rest_answers: answer.trim() ? { 画画: 1 } : {} });
});
it('repeated trimmed rest answers signal on the third occurrence only, including across day boundaries', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  for (let i = 0; i < 4; i++) {
    const begin = new Date(2026, 9, 27 + i, 3, 55).toISOString(), end = new Date(2026, 9, 27 + i, 4, 5).toISOString();
    f.clock(begin);
    await run(f.ctx, async tx => { tx.state.last_rest_ended_at = null; tx.state.refusals = [begin, begin, begin]; await registerRefusalInTx(tx); });
    f.clock(end); await returnFromRest(f.ctx, ' 画画 ', end);
    const notices = f.publish.mock.calls.at(-1)![0].notices;
    expect(notices.filter((n: { kind: string }) => n.kind === 'subconscious')).toHaveLength(i === 2 ? 1 : 0);
    if (i === 2) expect(notices[0].data).toEqual({ answer: '画画', count: 3 });
  }
  const answers = segments(f).filter(s => s.activity === '画画');
  expect(answers).toHaveLength(8);
  expect(new Set(answers.map(s => s.seq)).size).toBe(4);
  expect(answers.reduce((sum, s) => sum + Date.parse(s.ended_at!) - Date.parse(s.started_at), 0)).toBe(40 * 60000);
});
it('blank positive-duration answers retain automatic rest history and reject time travel', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  await run(f.ctx, async tx => { tx.state.refusals = [at(), at(), at()]; await registerRefusalInTx(tx); });
  await expect(returnFromRest(f.ctx, '画画', at(-1))).rejects.toThrow('早于');
  f.clock(at(10)); await returnFromRest(f.ctx, '  ', at(10));
  expect(effective(segments(f), at(10))).toEqual([expect.objectContaining({ activity: '休息', started_at: at(), ended_at: at(10) })]);
});
