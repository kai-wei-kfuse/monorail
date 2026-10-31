import { expect, it } from 'vitest';
import { at, card, fixture, getCard, open, seed, task } from './serviceFixture';
import { createContext, run } from './commit';
import { refresh } from './dealService';
import { redraw, start } from './cardService';
import { beginPending, insert, pause, resume, sleep, startFree } from './homeService';
import { returnFromRest } from './degradeService';
import { enter, finish, goto } from './reviewService';
import { startSystemInTx } from './tracking/api';

it.each(['idle', 'free', 'card', 'paused', 'inserted', 'pausedFree', 'insertedFree', 'rest', 'sleep', 'pending'] as const)(
  'opening, resuming and completing review preserve %s timing and state', async mode => {
    const f = fixture();
    await seed(f, [card('a', { task_id: 'task' })], [task('task')]);
    await refresh(f.ctx, at());
    if (mode === 'free' || mode === 'pausedFree' || mode === 'insertedFree') {
      await startFree(f.ctx, { description: '阅读', project: '学习', tags: ['书'] }, at());
    }
    else if (mode !== 'idle') await start(f.ctx, 'a', at());
    f.clock(at(1));
    if (mode === 'paused' || mode === 'pausedFree') await pause(f.ctx, at(1));
    if (mode === 'inserted' || mode === 'insertedFree') await insert(f.ctx, 'wc', at(1));
    if (mode === 'sleep') await sleep(f.ctx, at(1));
    if (mode === 'pending') await beginPending(f.ctx, at(1));
    if (mode === 'rest') {
      f.ctx.settings.refusalThreshold = 2;
      await redraw(f.ctx, 'a', at(1));
      f.clock(at(2)); await redraw(f.ctx, 'a', at(2));
      expect(open(f).project).toBe('休息');
    }
    const before = {
      entries: structuredClone(f.ctx.repos.times.snapshot()),
      state: await f.ctx.repos.state.read(), card: await getCard(f, 'a'),
    };
    const unchanged = async () => {
      expect(f.ctx.repos.times.snapshot()).toEqual(before.entries);
      expect(await f.ctx.repos.state.read()).toEqual(before.state);
      expect(await getCard(f, 'a')).toEqual(before.card);
    };
    f.clock(at(3)); await enter(f.ctx, at(3)); await unchanged();
    const review = (await f.ctx.repos.reviews.list())[0].value;
    expect(review).toMatchObject({ status: '进行中', started_at: at(3), timer_entry_id: null });
    f.clock(at(4)); await goto(f.ctx, 'newIdeas', at(4));
    const restarted = createContext(f.ctx);
    f.clock(at(5)); await enter(restarted, at(5)); await unchanged();
    expect(f.publish.mock.calls.at(-1)![0].review?.step).toBe('newIdeas');
    f.clock(at(6)); await goto(restarted, 'arena', at(6));
    f.clock(at(7)); await goto(restarted, 'coldPick', at(7));
    f.clock(at(8)); await finish(restarted, at(8)); await unchanged();
    expect((await f.ctx.repos.reviews.list())[0].value).toMatchObject({ status: '已完成', completed_at: at(8) });
    f.clock(at(9)); await enter(restarted, at(9)); await unchanged();

    // Preserving the pointers must also preserve the next real timing action.
    f.clock(at(10));
    if (mode === 'paused' || mode === 'inserted') {
      await resume(restarted, at(10));
      expect(open(f)).toMatchObject({ card_id: 'a', started_at: at(10) });
      expect((await getCard(f, 'a')).status).toBe('进行中');
    }
    if (mode === 'pausedFree' || mode === 'insertedFree') {
      await resume(restarted, at(10));
      expect(open(f)).toMatchObject({ description: '阅读', project: '学习', tags: ['书'], card_id: null, started_at: at(10) });
    }
    if (mode === 'pending') {
      await startFree(restarted, { description: '确认新活动', project: '学习', tags: [] }, at(10));
      expect(open(f).started_at).toBe(at(1));
    }
    if (mode === 'rest') {
      await returnFromRest(restarted, '走走', at(10));
      expect((await f.ctx.repos.state.read()).rest).toBeNull();
    }
  },
);

it('legacy timer_entry_id remains readable but cannot control timing on reentry or completion', async () => {
  const f = fixture(); await refresh(f.ctx, at());
  f.clock(at(1));
  await run(f.ctx, async tx => {
    const entry = startSystemInTx(tx, '回顾');
    tx.saveReview({ id: '2026-W44', period: '2026-W44', status: '进行中', step: 'coldPick',
      done: ['recap', 'newIdeas', 'arena'], started_at: at(1), completed_at: null,
      added_idea_ids: [], bet_task_ids: [], bet_done_ids: [], cold_duel: null, timer_entry_id: entry.id });
  }, at(1));
  const entries = structuredClone(f.ctx.repos.times.snapshot());
  f.clock(at(2)); await enter(f.ctx, at(2));
  expect(f.ctx.repos.times.snapshot()).toEqual(entries);
  f.clock(at(3)); await finish(f.ctx, at(3));
  expect(f.ctx.repos.times.snapshot()).toEqual(entries);
  expect((await f.ctx.repos.reviews.list())[0].value).toMatchObject({ status: '已完成', timer_entry_id: open(f).id });
});
