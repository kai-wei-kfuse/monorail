import { expect, it } from 'vitest';
import { at, card, fixture, task, seed } from './serviceFixture';
import { start } from './cardService';
import { backfillRange, insert, settleOffline } from './homeService';
import { run } from './commit';
import { refresh } from './dealService';

it('separates effective closed history from the running tail after an overlapping backfill', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  f.clock(at(60)); await backfillRange(f.ctx, { start: at(20), end: at(40) }, 'wc', at(60));
  expect(f.home()).toMatchObject({ closedEffectiveMs: 0, currentSegStartedAt: at(), activity: { kind: 'focus' } });
  f.clock(at(70)); await insert(f.ctx, 'wc', at(70));
  expect(f.home()).toMatchObject({ closedEffectiveMs: 70 * 60000, currentSegStartedAt: null, awayActivity: '厕所', activity: { kind: 'away' } });
});
it('when backfill covers the current tail through now, the UI timer restarts at now without counting covered time', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  f.clock(at(60)); await backfillRange(f.ctx, { start: at(20), end: at(60) }, 'wc', at(60));
  expect(f.home()).toMatchObject({ closedEffectiveMs: 0, currentSegStartedAt: at() });
});
it('at a zero-duration start the UI has a running anchor and no closed history', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  expect(f.home()).toMatchObject({ closedEffectiveMs: 0, currentSegStartedAt: at() });
});
it('cross-day time remains cumulative while completion baselines use only the current activity day', async () => {
  const f = fixture(), begin = new Date(2026, 9, 27, 3, 30).toISOString(), after = new Date(2026, 9, 27, 4, 30).toISOString();
  f.clock(begin); await seed(f, [card('a'), card('done', { status: '已完成', completed_day: '2026-10-26', completed_track: '支线' })]);
  await start(f.ctx, 'a', begin); f.clock(after); await insert(f.ctx, 'wc', after);
  expect(f.home()).toMatchObject({ closedEffectiveMs: 60 * 60000, currentSegStartedAt: null, baseline: { side: false } });
});
it('all main slots count toward review due status, with correct slot numbers and baseline', async () => {
  const f = fixture(); f.ctx.settings.mainTasks = 2; f.ctx.settings.reviewWeekday = 2;
  await seed(f, [card('a', { task_id: 'm2' })], [task('m1'), { ...task('m2', '主线', 2), bet_ends_at: at(-1) }]);
  await run(f.ctx, async tx => { tx.state.first_used_day = '2026-10-12'; });
  await refresh(f.ctx, at());
  expect(f.home()).toMatchObject({ review: { betDue: true } });
  await start(f.ctx, 'a', at());
  expect(f.home()).toMatchObject({ card: { slotNo: '02', slotOf: '/04', task: 'm2' }, baseline: { main: false } });
});
it('after offline release, refresh produces a pending card with idle activity and no live task timer', async () => {
  const f = fixture(); await seed(f, [card('a')]); await start(f.ctx, 'a', at());
  f.clock(at(60)); await settleOffline(f.ctx, { start: at(10), end: at(60) });
  await refresh(f.ctx, at(60));
  expect(f.home()).toMatchObject({ mode: 'blank', card: null, closedEffectiveMs: 0,
    currentSegStartedAt: null, activity: { kind: 'idle' } });
});
