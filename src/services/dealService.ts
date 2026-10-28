import { pick } from '../domain/picker/pick';
import { dueReview, reviewUpdates } from '../domain/review/schedule';
import { activityDay } from '../domain/timeline/day';
import { inBackpack } from '../domain/task/task';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';

// First-release selection policy; rule editing belongs to the second release.
const MAIN_CARD_WEIGHT = 1.5;

export function drawInTx(tx: Transaction): void {
  const day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  tx.state.first_used_day ??= day;
  for (const review of reviewUpdates(day, tx.state.first_used_day, tx.settings.reviewWeekday, tx.reviews)) tx.saveReview(review);
  if (tx.state.rest) { tx.state.home_mode = 'rest'; return; }
  const current = tx.cards.find(card => card.id === tx.state.current_card);
  if (current?.status === '进行中') { tx.state.home_mode = 'task'; return; }
  const betDue = tx.tasks.some(task => inBackpack(task) && task.slot === '主线' && task.bet_ends_at !== null && Date.parse(task.bet_ends_at) <= Date.parse(tx.at));
  const selected = pick({ cards: tx.cards, tasks: tx.tasks, at: tx.at, day, dueSoonHours: tx.settings.dueSoonHours,
    excluded: tx.state.seen, random: tx.random(), mainWeight: MAIN_CARD_WEIGHT,
    review: dueReview(day, tx.state.first_used_day, tx.settings.reviewWeekday, tx.reviews, betDue) });
  if (selected.resetRound) tx.state.seen = [];
  tx.state.home_mode = selected.kind;
  tx.state.current_card = selected.kind === 'task' ? selected.card.id : null;
  tx.state.review_period = selected.kind === 'review' ? selected.review.period : null;
}

export function refreshInTx(tx: Transaction): void {
  const day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  tx.state.first_used_day ??= day;
  for (const review of reviewUpdates(day, tx.state.first_used_day, tx.settings.reviewWeekday, tx.reviews)) tx.saveReview(review);
  if (tx.state.rest) { tx.state.home_mode = 'rest'; return; }
  if (tx.state.current_card && !tx.cards.some(card => card.id === tx.state.current_card && (card.status === '待做' || card.status === '进行中'))) {
    tx.state.current_card = null; tx.state.home_mode = 'blank';
  }
  if (!tx.state.current_card && tx.state.home_mode === 'task') tx.state.home_mode = 'blank';
}

export const refresh = (ctx: Ctx, at: string) => run(ctx, async tx => refreshInTx(tx), at);
export const draw = (ctx: Ctx, at: string) => run(ctx, async tx => drawInTx(tx), at);
