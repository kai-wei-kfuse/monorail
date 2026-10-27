import { pick } from '../domain/picker/pick';
import { dueReview } from '../domain/review/schedule';
import { activityDay } from '../domain/timeline/day';
import { inBackpack } from '../domain/project/project';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';

// First-release selection policy; rule editing belongs to the second release.
const MAIN_CARD_WEIGHT = 1.5;

export function refreshInTx(tx: Transaction): void {
  const day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  tx.state.first_used_day ??= day;
  if (tx.state.stopped_day === day) { tx.state.home_mode = 'stopped'; return; }
  if (tx.state.rest) { tx.state.home_mode = 'rest'; return; }
  const current = tx.cards.find(card => card.id === tx.state.current_card);
  if (current?.status === '进行中') { tx.state.home_mode = 'task'; return; }
  const betDue = tx.projects.some(project => inBackpack(project) && project.slot === '主线' && project.bet_ends_at !== null && Date.parse(project.bet_ends_at) <= Date.parse(tx.at));
  const selected = pick({ cards: tx.cards, projects: tx.projects, at: tx.at, day, dueSoonHours: tx.settings.dueSoonHours,
    excluded: tx.state.seen, stopped: false, random: tx.random(), mainWeight: MAIN_CARD_WEIGHT,
    review: dueReview(day, tx.state.first_used_day, tx.settings.reviewWeekday, tx.reviews, betDue) });
  if (selected.resetRound) tx.state.seen = [];
  tx.state.home_mode = selected.kind;
  tx.state.current_card = selected.kind === 'task' ? selected.card.id : null;
  tx.state.review_period = selected.kind === 'review' ? selected.review.period : null;
}

export function stopInTx(tx: Transaction): void {
  tx.state.stopped_day = activityDay(tx.at, tx.settings.dayBoundaryHour);
  tx.state.current_card = null;
  tx.state.rest = null;
  tx.state.home_mode = 'stopped';
}

export const refresh = (ctx: Ctx, at: string) => run(ctx, async tx => refreshInTx(tx), at);
