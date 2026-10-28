import type { Card } from '../domain/card/card';
import { editCardContent } from '../domain/card/edit';
import { startCard, completeCard, continueCard, releaseCard, abandonCard } from '../domain/card/transitions';
import { shrinkCard, restoreParent } from '../domain/card/shrink';
import { skipCard } from '../domain/degrade/signals';
import { inBackpack, trackOf } from '../domain/task/task';
import { cardMilliseconds } from '../domain/timeline/stats';
import { activityDay } from '../domain/timeline/day';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { switchInTx, idleTarget, openSegmentInTx } from './timerService';
import { refreshInTx, stopInTx } from './dealService';
import { registerRefusalInTx } from './degradeService';

function getCard(tx: Transaction, id: string): Card {
  const card = tx.cards.find(item => item.id === id);
  if (!card) throw new Error('卡片不存在');
  return card;
}
function nextOrder(tx: Transaction): number { return Math.max(0, ...tx.cards.map(card => card.order)) + 1; }
function restoreInTx(tx: Transaction, card: Card): void {
  if (!card.shrunk_from) return;
  const parent = getCard(tx, card.shrunk_from);
  // A child may move to another task; finishing it cannot revive an abandoned ancestor.
  if (parent.status === '已缩小') tx.saveCard(restoreParent(card, parent, card.progress_note));
}
function requireCurrent(tx: Transaction, card: Card): void {
  if (tx.state.current_card !== card.id || tx.state.rest) throw new Error('首页卡片已改变');
}
function target(tx: Transaction, card: Card) {
  return { activity: card.content, project: trackOf(card.task_id, tx.tasks), card_id: card.id, kind: '普通' as const, resume_card_id: null };
}

export const editContent = (ctx: Ctx, cardId: string, content: string, at: string) => run(ctx, async tx => {
  // v1 keeps the running segment's original name; renaming it belongs to the v2 migration.
  tx.saveCard(editCardContent(getCard(tx, cardId), content));
}, at);

export const start = (ctx: Ctx, cardId: string, at: string) => run(ctx, async tx => {
  const card = getCard(tx, cardId), current = openSegmentInTx(tx);
  if (card.status === '进行中' && current?.card_id === cardId) return;
  if (tx.cards.some(item => item.status === '进行中' && item.id !== cardId)) throw new Error('另一个任务正在进行');
  if (card.task_id && !tx.tasks.some(task => task.id === card.task_id && inBackpack(task))) throw new Error('项目不在背包');
  tx.saveCard(startCard(card));
  await switchInTx(tx, at, target(tx, card));
  tx.state.current_card = cardId;
  tx.state.home_mode = 'task';
}, at);

/** Read-only prompt calculation, using the original click time and effective history. */
export async function checkComplete(ctx: Ctx, cardId: string, at: string): Promise<{ remainingMinutes: number; at: string }> {
  const entity = await ctx.repos.cards.get(cardId);
  if (!entity) throw new Error('卡片不存在');
  const card = entity.value;
  const elapsed = cardMilliseconds(ctx.repos.times.snapshot(), cardId, at);
  return { remainingMinutes: card.type === '时间盒卡' ? Math.max(0, (card.timebox_minutes ?? 0) - elapsed / 60000) : 0, at };
}

export const complete = (ctx: Ctx, cardId: string, at: string, note: string, keepGoing = false) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  if (card.status === '已完成') return;
  requireCurrent(tx, card);
  const done = completeCard(card, at, activityDay(at, tx.settings.dayBoundaryHour), trackOf(card.task_id, tx.tasks), note);
  tx.saveCard(done);
  restoreInTx(tx, done);
  if (keepGoing) tx.saveCard(continueCard(done, tx.id(), at, nextOrder(tx)));
  await switchInTx(tx, at, idleTarget(tx));
  tx.state.current_card = null;
  refreshInTx(tx);
}, at);

export interface ShrinkCommand { content: string; type: Card['type']; minutes: number | null }
export const shrink = (ctx: Ctx, cardId: string, input: ShrinkCommand, at: string) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  requireCurrent(tx, card);
  const result = shrinkCard(card, { ...input, id: tx.id(), at, order: nextOrder(tx), maxLevel: tx.settings.shrinkMaxLevel });
  tx.saveCard(result.parent); tx.saveCard(result.child);
  tx.state.current_card = result.child.id;
  tx.state.home_mode = 'task';
  await switchInTx(tx, at, result.child.status === '进行中' ? target(tx, result.child) : idleTarget(tx));
  await registerRefusalInTx(tx);
  return result.child.id;
}, at);

export const redraw = (ctx: Ctx, cardId: string | null, at: string, note?: string) => run(ctx, async tx => {
  let excluded: string;
  if (cardId) {
    const card = getCard(tx, cardId); requireCurrent(tx, card);
    const skipped = skipCard(releaseCard({ ...card, progress_note: note ?? card.progress_note }), tx.settings.skipSignalCount);
    tx.saveCard(skipped.card); excluded = card.id;
    if (skipped.signal) tx.notices.push({ id: tx.id(), kind: 'skipSignal', data: { cardId, title: card.content, count: skipped.card.skip_count } });
  } else {
    if (tx.state.home_mode !== 'review' || !tx.state.review_period) throw new Error('没有可以再抽的卡');
    excluded = `review:${tx.state.review_period}`;
  }
  tx.state.seen = [...new Set([...tx.state.seen, excluded])];
  tx.state.current_card = null;
  await switchInTx(tx, at, idleTarget(tx));
  refreshInTx(tx);
  await registerRefusalInTx(tx);
}, at);

export const pass = (ctx: Ctx, cardId: string, at: string) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  if (card.status === '已放弃') return;
  tx.saveCard(abandonCard(card)); restoreInTx(tx, card);
  if (tx.state.current_card === cardId) {
    tx.state.current_card = null;
    await switchInTx(tx, at, idleTarget(tx));
  }
  refreshInTx(tx);
}, at);

export const stopToday = (ctx: Ctx, at: string) => run(ctx, async tx => {
  const card = tx.cards.find(item => item.id === tx.state.current_card);
  if (card) tx.saveCard(releaseCard(card));
  await switchInTx(tx, at, idleTarget(tx));
  stopInTx(tx);
}, at);

export const leaveTo = (ctx: Ctx, activityId: string, at: string) => run(ctx, async tx => {
  const activity = tx.settings.lists.quickActivities.find(item => item.id === activityId);
  if (!activity) throw new Error('快捷活动不存在');
  const card = tx.cards.find(item => item.id === tx.state.current_card);
  if (card) tx.saveCard(releaseCard(card));
  await switchInTx(tx, at, { activity: activity.name, project: activity.project, card_id: null, kind: '普通', resume_card_id: null });
}, at);
