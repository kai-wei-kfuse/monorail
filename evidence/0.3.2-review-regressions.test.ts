// Review-only regression proofs; all data stays in serviceFixture's MemoryFs.
import { expect, it } from 'vitest';
import { at, card, task, fixture, seed, open } from '../src/services/serviceFixture';
import { startCard, insert, beginPending } from '../src/services/homeService';
import { freezeTask, abandonTask } from '../src/services/backpackService';
import { add } from '../src/services/planService';
import { activityDay } from '../src/domain/timeline/day';
import { completeTaskMeta, verifyTaskReopen } from '../src/domain/task/complete';
import { completeCardItem } from '../src/domain/card/transitions';

it.each([freezeTask, abandonTask])('direct removal must reject insertion before changing the timer', async remove => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't' })], [task('t')]);
  await startCard(f.ctx, 'a', at()); f.clock(at(1)); await insert(f.ctx, 'wc', at(1));
  const before = open(f);
  await expect(remove(f.ctx, 't', at(1))).rejects.toThrow('IN_AWAY_ACTIVITY');
  expect(open(f)).toEqual(before);
});

it('direct freeze must reject pending associated with the task', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't' })], [task('t')]);
  await startCard(f.ctx, 'a', at()); f.clock(at(1)); await beginPending(f.ctx, at(1));
  await expect(freezeTask(f.ctx, 't', at(1))).rejects.toThrow('PENDING_START_CONFIRMATION');
});

it('completion snapshot must reject a changed non-null completed_day', () => {
  const t = task('t'), c = card('a', { task_id: 't' });
  const meta = completeTaskMeta(t, [c], 'batch-1', at(2), '2026-10-27');
  const done = completeCardItem(c, at(2), '2026-10-27', '主线');
  const changed = { ...done, completed_day: '2026-10-28' };
  expect(verifyTaskReopen(meta.task, [changed], 'batch-1')).toMatchObject({ ok: false, reason: 'CARD_STATE_CHANGED' });
});

it('completion snapshot without its recorded completed_day must not guess a historic 04:00 boundary', () => {
  const t = task('t'), c = card('a', { task_id: 't' });
  const meta = completeTaskMeta(t, [c], 'batch-1', at(2), '2026-10-27');
  const { completed_day: _day, ...withoutDay } = meta.task.completion!;
  const done = completeCardItem(c, at(2), '2026-10-27', '主线');
  expect(verifyTaskReopen({ ...meta.task, completion: withoutDay }, [done], 'batch-1')).toMatchObject({ ok: false });
});

it('result card add rejects a supplied numeric todayMinutes rather than silently discarding it', async () => {
  const f = fixture(); await seed(f, [card('a', { task_id: 't', type: '结果卡' })], [task('t')]);
  f.clock(at(1));
  await expect(add(f.ctx, 'today', { cardId: 'a', priority: '普通', todayMinutes: 30 }, at(1))).rejects.toThrow();
  const day = activityDay(at(1), f.ctx.settings.dayBoundaryHour);
  expect((await f.ctx.repos.plans.read(day)).value.items).toEqual([]);
});
