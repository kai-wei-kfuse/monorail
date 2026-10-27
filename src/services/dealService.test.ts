import { expect, it, vi } from 'vitest';
import { at, card, fixture, getCard, open, project, seed } from './serviceFixture';
import { refresh, refreshInTx } from './dealService';
import { start, redraw } from './cardService';
import { insert } from './timerService';
import { run } from './commit';

it('a new blocker replaces a pending card without recording any refusal or exclusion', async () => {
  const f = fixture(); await seed(f, [card('a')]);
  await run(f.ctx, async tx => { tx.saveCard(card('block', { blocking: true })); });
  await refresh(f.ctx, at());
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 'block', seen: [], refusals: [] });
  expect(await getCard(f, 'a')).toMatchObject({ status: '待做', skip_count: 0 });
});
it.each([false, true])('new blockers never interrupt a running card, including inserted activities (%s)', async inserted => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  if (inserted) await insert(f.ctx, 'wc', at());
  const before = open(f);
  await run(f.ctx, async tx => { tx.saveCard(card('block', { blocking: true })); });
  await refresh(f.ctx, at());
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 'a', home_mode: 'task' });
  expect(open(f)).toEqual(before);
});
it('refresh preserves the pending selection during rest', async () => {
  const f = fixture(); await seed(f, [card('a'), card('block', { blocking: true })]);
  await run(f.ctx, async tx => { tx.state.rest = { started_at: at(), suggestion: '走走' }; });
  await refresh(f.ctx, at());
  expect(await f.ctx.repos.state.read()).toMatchObject({ current_card: 'a', home_mode: 'rest' });
});
it('exhausting a round clears exclusions and keeps dealing instead of showing an empty guide', async () => {
  const f = fixture(); await seed(f, [card('a'), card('b', { order: 2 })]);
  await redraw(f.ctx, 'a', at()); expect(f.home().card?.id).toBe('b');
  await redraw(f.ctx, 'b', at()); expect(f.home().card?.id).toBe('a');
  expect((await f.ctx.repos.state.read()).seen).toEqual([]);
});
it.each([[0, 'm'], [0.599999, 'm'], [0.6, 's'], [0.999999, 's']] as const)('after both baselines, random %s respects the 1.5:1 main weight', async (random, selected) => {
  const f = fixture(); f.random.mockReturnValue(random);
  await seed(f, [card('m', { project_id: 'main', order: 1 }), card('s', { order: 2 }),
    card('done-m', { status: '已完成', completed_day: '2026-10-27', completed_track: '主线' }),
    card('done-s', { status: '已完成', completed_day: '2026-10-27', completed_track: '支线' })], [project('main')]);
  await refresh(f.ctx, at()); expect(f.home().card?.id).toBe(selected);
});
it('the next activity day recomputes the main baseline rather than using yesterday’s completion', async () => {
  const f = fixture(); await seed(f, [card('m', { project_id: 'main' }), card('s', { order: 2 }),
    card('done', { status: '已完成', completed_day: '2026-10-27', completed_track: '主线' })], [project('main')]);
  await refresh(f.ctx, at()); expect(f.home().card?.id).toBe('s');
  const next = new Date(2026, 9, 28, 4).toISOString(); f.clock(next); await refresh(f.ctx, next);
  expect(f.home().card?.id).toBe('m');
});
it.each(['firstProject', 'setMain', 'splitMain', 'allDone'] as const)('projects the %s guide only with no candidate', async guide => {
  const f = fixture();
  const projects = guide === 'firstProject' ? [] : [project('p', guide === 'setMain' ? '支线' : '主线')];
  const cards = guide === 'allDone' ? [card('done', { project_id: 'p', status: '已完成' })] : [];
  await seed(f, cards, projects); await refresh(f.ctx, at());
  expect(f.home()).toMatchObject({ mode: 'guide', guideKind: guide, card: null });
});
it('a loose candidate still deals without a main project and displays the main hint', async () => {
  const f = fixture(); await seed(f, [card('a')]); await refresh(f.ctx, at());
  expect(f.home()).toMatchObject({ mode: 'task', noMainHint: true, baseline: { main: null, side: false } });
});
it('persists a due review, carries it across weeks, and replaces it atomically when the next period becomes due', async () => {
  const f = fixture(); await seed(f, []);
  await run(f.ctx, async tx => { tx.state.first_used_day = '2026-10-27'; });
  f.clock(new Date(2026, 10, 8, 4).toISOString()); await refresh(f.ctx, f.ctx.now());
  expect((await f.ctx.repos.reviews.get('2026-W45'))!.value.status).toBe('未开始');
  await run(f.ctx, async tx => { tx.saveReview({ ...tx.reviews[0], status: '进行中', step: 'arena' }); });
  f.clock(new Date(2026, 10, 9, 4).toISOString()); await refresh(f.ctx, f.ctx.now());
  expect(f.home()).toMatchObject({ mode: 'review', review: { period: '2026-W45', resumeStep: 'arena' } });
  const transact = vi.spyOn(f.ctx.repos, 'transact'), write = vi.spyOn(f.ctx.repos.reviews, 'write');
  f.clock(new Date(2026, 10, 15, 4).toISOString());
  await run(f.ctx, async tx => { refreshInTx(tx); refreshInTx(tx); });
  expect(transact).toHaveBeenCalledTimes(1); expect(write).toHaveBeenCalledTimes(2);
  expect((await f.ctx.repos.reviews.get('2026-W45'))!.value).toMatchObject({ status: '已被取代', step: 'arena' });
  expect(f.home()).toMatchObject({ mode: 'review', review: { period: '2026-W46', resumeStep: 'recap' } });
  write.mockClear(); await refresh(f.ctx, f.ctx.now()); expect(write).not.toHaveBeenCalled();
});
it('same-transaction review edits merge before commit and a completed period does not return', async () => {
  const f = fixture(); await seed(f, []);
  f.clock(new Date(2026, 10, 8, 4).toISOString());
  const write = vi.spyOn(f.ctx.repos.reviews, 'write');
  await run(f.ctx, async tx => {
    tx.state.first_used_day = '2026-10-27'; refreshInTx(tx);
    tx.saveReview({ ...tx.reviews[0], status: '已完成', step: 'done' }); refreshInTx(tx);
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect((await f.ctx.repos.reviews.get('2026-W45'))!.value.status).toBe('已完成');
  expect(f.home().mode).toBe('guide');
});
