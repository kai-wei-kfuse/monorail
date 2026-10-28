import type { Card } from '../domain/card/card';
import { editCardContent, cardTiming } from '../domain/card/edit';
import { startCard, completeCard, continueCard, releaseCard, abandonCard } from '../domain/card/transitions';
import { shrinkCard, restoreParent } from '../domain/card/shrink';
import { skipCard } from '../domain/degrade/signals';
import { inBackpack, trackOf } from '../domain/task/task';
import { activityDay } from '../domain/timeline/day';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';
import { openInTx, startRefInTx, stopRefInTx, startSystemInTx, renameRefInTx, retagRefInTx, activeRefInTx, refElapsedInTx, startInTx as startEntryInTx } from './tracking/api';
import { drawInTx } from './dealService';
import { afterItem } from '../domain/task/pool';
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
  const { project, tags } = cardTiming(card, tx.tasks.find(task => task.id === card.task_id));
  return { description: card.content.replace(/[[\]]/g, ''), project, card_id: card.id, tags };
}
export const templateInTx = target;
export function alignInTx(tx: Transaction): void {
  const active = activeRefInTx(tx);
  for (const card of tx.cards.filter(card => card.status === '进行中' && card.id !== active)) {
    tx.saveCard(releaseCard(card));
    if (tx.state.current_card === card.id) { tx.state.current_card = null; tx.state.home_mode = 'blank'; }
  }
}
function finishItemInTx(tx: Transaction, card: Card): void {
  const task = tx.tasks.find(task => task.id === card.task_id);
  if (task) tx.saveTask(afterItem(task, tx.cards));
}

export function editContentInTx(tx: Transaction, cardId: string, content: string): void {
  const card = editCardContent(getCard(tx, cardId), content);
  tx.saveCard(card); renameRefInTx(tx, cardId, target(tx, card).description);
}
export const editContent = (ctx: Ctx, cardId: string, content: string, at: string) => run(ctx, async tx => editContentInTx(tx, cardId, content), at);
export function editMetaInTx(tx: Transaction, cardId: string, project: string | null, tags: string[]): void {
  const next = { ...getCard(tx, cardId), project, tags: [...tags] }; tx.saveCard(next);
  const value = target(tx, next); retagRefInTx(tx, cardId, value.project, value.tags);
}

export async function startCardInTx(tx: Transaction, cardId: string, from = tx.at): Promise<void> {
  const card = getCard(tx, cardId), current = openInTx(tx);
  if (card.status === '进行中' && current?.card_id === cardId) return;
  for (const other of tx.cards.filter(item => item.status === '进行中' && item.id !== cardId)) tx.saveCard(releaseCard(other));
  if (card.task_id && !tx.tasks.some(task => task.id === card.task_id && inBackpack(task))) throw new Error('项目不在背包');
  tx.saveCard(startCard(card));
  startRefInTx(tx, cardId, target(tx, card), from);
  tx.state.current_card = cardId;
  tx.state.home_mode = 'task';
  tx.state.rest = null;
  alignInTx(tx);
}
export const start = (ctx: Ctx, cardId: string, at: string) => run(ctx, tx => startCardInTx(tx, cardId), at);

/** Read-only prompt calculation, using the original click time and effective history. */
export async function checkComplete(ctx: Ctx, cardId: string, at: string): Promise<{ remainingMinutes: number; at: string }> {
  const entity = await ctx.repos.cards.get(cardId);
  if (!entity) throw new Error('卡片不存在');
  const card = entity.value;
  const elapsed = refElapsedInTx({ entries: ctx.repos.times.snapshot(), at }, cardId);
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
  stopRefInTx(tx, cardId);
  tx.state.current_card = null;
  finishItemInTx(tx, done); drawInTx(tx); alignInTx(tx);
}, at);

export interface ShrinkCommand { content: string; type: Card['type']; minutes: number | null }
export const shrink = (ctx: Ctx, cardId: string, input: ShrinkCommand, at: string) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  requireCurrent(tx, card);
  const result = shrinkCard(card, { ...input, id: tx.id(), at, order: nextOrder(tx), maxLevel: tx.settings.shrinkMaxLevel });
  tx.saveCard(result.parent); tx.saveCard(result.child);
  tx.state.current_card = result.child.id;
  tx.state.home_mode = 'task';
  stopRefInTx(tx, cardId);
  if (result.child.status === '进行中') startRefInTx(tx, result.child.id, target(tx, result.child));
  await registerRefusalInTx(tx);
  alignInTx(tx);
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
  if (cardId) stopRefInTx(tx, cardId); else startSystemInTx(tx, '待机');
  drawInTx(tx);
  await registerRefusalInTx(tx);
  alignInTx(tx);
}, at);

export const pass = (ctx: Ctx, cardId: string, at: string) => run(ctx, async tx => {
  const card = getCard(tx, cardId);
  if (card.status === '已放弃') return;
  tx.saveCard(abandonCard(card)); restoreInTx(tx, card);
  if (tx.state.current_card === cardId) {
    tx.state.current_card = null;
    stopRefInTx(tx, cardId);
  }
  finishItemInTx(tx, card); drawInTx(tx); alignInTx(tx);
}, at);

export const leaveTo = (ctx: Ctx, activityId: string, at: string) => run(ctx, async tx => {
  const activity = tx.settings.lists.presets.find(item => item.id === activityId);
  if (!activity) throw new Error('快捷活动不存在');
  const card = tx.cards.find(item => item.id === tx.state.current_card);
  if (card) tx.saveCard(releaseCard(card));
  startEntryInTx(tx, { description: activity.name, project: activity.project, card_id: null, tags: activity.tags });
  alignInTx(tx);
}, at);
