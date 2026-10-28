import { isoWeek } from '../domain/review/schedule';
import { progress, navigate, completeReview } from '../domain/review/flow';
import type { ActiveReview, ReviewStep } from '../domain/review/flow';
import { activityDay } from '../domain/timeline/day';
import { createRecord } from '../domain/record/record';
import { releaseCard } from '../domain/card/transitions';
import { inBackpack } from '../domain/task/task';
import { activeIdeas, coldOffer } from '../domain/idea/pool';
import type { MakeRoom, TaskDraft } from '../shared/backpack';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { refreshInTx } from './dealService';
import { openInTx, startSystemInTx } from './tracking/api';
import { reviveInTx, resolveDuelInTx } from './ideaService';
import { createTaskInTx, restoreTaskInTx } from './backpackService';
import { currentReview } from './reviewProjection';

const overLimit = (tx: Transaction) => activeIdeas(tx.records).length > tx.settings.ideaPoolLimit;
function active(tx: Transaction, step?: ReviewStep): ActiveReview {
  const review = currentReview(tx.reviews);
  if (!review || review.status !== '进行中') throw new Error('请先进入回顾');
  if (step && review.step !== step) throw new Error('当前不在这个回顾步骤');
  return progress(review);
}
async function finishInTx(tx: Transaction, review: ActiveReview): Promise<void> {
  tx.saveReview(completeReview(review, tx.at, overLimit(tx)));
  if (openInTx(tx)?.id === review.timer_entry_id) startSystemInTx(tx, '待机');
  refreshInTx(tx);
}
async function coldDoneInTx(tx: Transaction, review: ActiveReview): Promise<void> {
  const done = { ...review, cold_duel: null, done: [...new Set([...review.done, 'coldPick' as const])] };
  if (review.bet_task_ids.length) tx.saveReview(navigate(done, 'bet', overLimit(tx)));
  else await finishInTx(tx, done);
}

/** Enter explicitly: changing pages/hiding the window never calls a timer stop. */
export const enter = (ctx: Ctx, at: string) => run(ctx, async tx => {
  refreshInTx(tx);
  const day = activityDay(at, tx.settings.dayBoundaryHour), period = isoWeek(day);
  let row = currentReview(tx.reviews);
  if (!row) {
    if (tx.reviews.some(review => review.period === period && review.status === '已完成')) return;
    row = { id: period, period, status: '未开始', step: 'recap' };
  }
  let review = progress(row);
  if (!review.started_at) review = { ...review, started_at: at, bet_task_ids: tx.tasks.filter(task =>
    inBackpack(task) && task.slot === '主线' && task.bet_ends_at && Date.parse(task.bet_ends_at) <= Date.parse(at)).map(task => task.id) };
  // A main changed from the backpack page already received its explicit decision.
  review = { ...review, bet_done_ids: [...new Set([...review.bet_done_ids, ...review.bet_task_ids.filter(id =>
    !tx.tasks.some(task => task.id === id && inBackpack(task) && task.slot === '主线'))])] };
  if (openInTx(tx)?.id !== review.timer_entry_id) {
    for (const card of tx.cards.filter(card => card.status === '进行中')) tx.saveCard(releaseCard(card));
    tx.state.rest = null;
    startSystemInTx(tx, '回顾');
    review = { ...review, timer_entry_id: tx.state.open_entry };
  }
  tx.saveReview({ ...review, status: '进行中' });
  if (review.step === 'bet' && review.bet_task_ids.every(id => review.bet_done_ids.includes(id))) {
    await finishInTx(tx, review); return;
  }
  refreshInTx(tx);
}, at);

export const goto = (ctx: Ctx, step: ReviewStep, at: string) => run(ctx, async tx => {
  tx.saveReview(navigate(active(tx), step, overLimit(tx)));
}, at);
export const addIdea = (ctx: Ctx, text: string, at: string) => run(ctx, async tx => {
  const review = active(tx, 'newIdeas'), id = tx.id();
  tx.saveRecord(createRecord({ id, text: text.trim(), kind: '想法', created_at: at, due_at: null,
    blocking: false, task_id: null, card_id: null, tags: [], attachments: [] }));
  tx.saveReview({ ...review, added_idea_ids: [...review.added_idea_ids, id], done: review.done.filter(step => step !== 'arena' && step !== 'coldPick' && step !== 'bet') });
  return id;
}, at);
export const duel = (ctx: Ctx, winnerId: string, loserId: string, at: string) => run(ctx, async tx => {
  const review = active(tx);
  if (review.step !== 'arena' && review.step !== 'coldPick') throw new Error('当前不在想法对决步骤');
  if (review.step === 'coldPick' && (!review.cold_duel || ![review.cold_duel.left, review.cold_duel.right].every(id => id === winnerId || id === loserId))) throw new Error('冷库对决配对已改变');
  resolveDuelInTx(tx, winnerId, loserId);
  if (review.cold_duel) await coldDoneInTx(tx, review);
}, at);
export const takeCold = (ctx: Ctx, ids: string[], at: string, confirmed = false) => run(ctx, async tx => {
  const review = active(tx, 'coldPick');
  if (review.cold_duel) throw new Error('请先完成冷库对决');
  const offered = coldOffer(tx.records);
  if (ids.some(id => !offered.some(idea => idea.id === id))) throw new Error('冷库提议已改变，请重新选择');
  const result = reviveInTx(tx, ids, confirmed);
  if (result.kind === 'duel') tx.saveReview({ ...review, cold_duel: { left: result.left.id, right: result.right.id } });
  else await coldDoneInTx(tx, review);
  return result;
}, at);
export const skipCold = (ctx: Ctx, at: string) => run(ctx, tx => coldDoneInTx(tx, active(tx, 'coldPick')), at);

function betTask(tx: Transaction, review: ActiveReview) {
  const id = review.bet_task_ids.find(id => !review.bet_done_ids.includes(id));
  const task = tx.tasks.find(task => task.id === id);
  if (!task || !inBackpack(task) || task.slot !== '主线' || !task.bet_ends_at) throw new Error('到期主线已改变，请重新进入回顾');
  return task;
}
async function betDoneInTx(tx: Transaction, review: ActiveReview, id: string) {
  const changed = { ...review, bet_done_ids: [...review.bet_done_ids, id] };
  if (changed.bet_task_ids.every(id => changed.bet_done_ids.includes(id))) await finishInTx(tx, changed);
  else tx.saveReview(changed);
}
export const continueBet = (ctx: Ctx, at: string) => run(ctx, async tx => {
  const review = active(tx, 'bet'), task = betTask(tx, review), end = new Date(task.bet_ends_at!);
  end.setDate(end.getDate() + tx.settings.betWeeks * 7);
  tx.saveTask({ ...task, bet_ends_at: end.toISOString() });
  await betDoneInTx(tx, review, task.id);
}, at);
export const switchMain = (ctx: Ctx, draft: TaskDraft | { restoreId: string; makeRoom: MakeRoom }, at: string) => run(ctx, async tx => {
  const review = active(tx, 'bet'), task = betTask(tx, review);
  if (draft.makeRoom?.id !== task.id) throw new Error('换主线必须冷藏或放弃当前复盘主线');
  if ('restoreId' in draft) await restoreTaskInTx(tx, draft.restoreId, '主线', draft.makeRoom);
  else {
    if (draft.slot !== '主线') throw new Error('请选择新的主线');
    await createTaskInTx(tx, draft);
  }
  await betDoneInTx(tx, review, task.id);
}, at);
export const finish = (ctx: Ctx, at: string) => run(ctx, tx => finishInTx(tx, active(tx)), at);
