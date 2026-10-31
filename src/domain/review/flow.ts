import type { Review } from './schedule';

export const reviewSteps = ['recap', 'newIdeas', 'arena', 'coldPick', 'bet'] as const;
export type ReviewStep = typeof reviewSteps[number];
export interface ReviewProgress {
  done: ReviewStep[]; started_at: string | null; completed_at: string | null;
  added_idea_ids: string[]; bet_task_ids: string[]; bet_done_ids: string[];
  cold_duel: { left: string; right: string } | null;
  /** Historical reference only; review progress no longer controls timing. */
  timer_entry_id: string | null;
}
export type ActiveReview = Review & ReviewProgress;

/** M1 rows only stored step. Infer their visited prefix, without inventing a finish time. */
export function progress(review: Review): ActiveReview {
  const stepIndex = reviewSteps.indexOf(review.step as ReviewStep);
  return { ...review, done: review.done ?? reviewSteps.slice(0, Math.max(0, stepIndex)),
    started_at: review.started_at ?? null, completed_at: review.completed_at ?? null,
    added_idea_ids: review.added_idea_ids ?? [], bet_task_ids: review.bet_task_ids ?? [],
    bet_done_ids: review.bet_done_ids ?? [], cold_duel: review.cold_duel ?? null, timer_entry_id: review.timer_entry_id ?? null };
}

export function navigate(review: ActiveReview, target: ReviewStep, arenaBlocked: boolean): ActiveReview {
  const steps: readonly ReviewStep[] = review.bet_task_ids.length ? reviewSteps : reviewSteps.filter(step => step !== 'bet');
  if (!steps.includes(target)) throw new Error('本期没有这个回顾步骤');
  if (target === review.step || review.done.includes(target)) return { ...review, step: target };
  const current = steps.indexOf(review.step as ReviewStep);
  if (steps[current + 1] !== target) throw new Error('请先完成前面的回顾步骤');
  if (review.step === 'arena' && arenaBlocked) throw new Error('先把想法池压回上限以内');
  if (review.cold_duel) throw new Error('请先完成冷库对决');
  return { ...review, step: target, done: [...new Set([...review.done, review.step as ReviewStep])] };
}

export function completeReview(review: ActiveReview, at: string, arenaBlocked: boolean): ActiveReview {
  const steps: readonly ReviewStep[] = review.bet_task_ids.length ? reviewSteps : reviewSteps.filter(step => step !== 'bet');
  const done = new Set([...review.done, review.step as ReviewStep]);
  if (steps.some(step => !done.has(step))) throw new Error('请先完成全部回顾步骤');
  if (arenaBlocked || review.cold_duel) throw new Error('请先完成想法对决');
  if (review.bet_task_ids.some(id => !review.bet_done_ids.includes(id))) throw new Error('请先完成主线复盘');
  return { ...review, done: [...steps], status: '已完成', completed_at: at };
}
