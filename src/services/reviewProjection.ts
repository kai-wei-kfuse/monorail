import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import type { RecordEntry } from '../domain/record/record';
import type { Review } from '../domain/review/schedule';
import { progress } from '../domain/review/flow';
import type { ReviewStep } from '../domain/review/flow';
import { activeIdeas, coldOffer } from '../domain/idea/pool';
import { pair } from '../domain/idea/arena';
import type { TimeEntry } from '../domain/timeline/entry';
import type { Settings } from '../shared/settings';
import type { AppState } from '../data/repos';
import type { ReviewSlice } from '../store/reviewSlice';

export const currentReview = (reviews: Review[]) => [...reviews]
  .filter(review => review.status === '未开始' || review.status === '进行中')
  .sort((a, b) => b.period.localeCompare(a.period))[0];

export function recapStart(reviews: Review[], firstDay: string, boundary: number, at: string): string {
  const finished = reviews.filter(review => review.status === '已完成' && review.completed_at && Date.parse(review.completed_at) <= Date.parse(at))
    .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))[0];
  // Legacy completed rows have no timestamp: retain history rather than invent a cutoff.
  return finished?.completed_at ?? new Date(`${firstDay}T${String(boundary).padStart(2, '0')}:00:00`).toISOString();
}

interface Input { cards: Card[]; tasks: Task[]; records: RecordEntry[]; reviews: Review[]; entries: TimeEntry[]; state: AppState; settings: Settings; at: string }
export function projectReview(input: Input): ReviewSlice {
  const { reviews, records, tasks, settings, state, at } = input;
  const row = currentReview(reviews);
  if (!row || !state.first_used_day) return null;
  const review = progress(row), active = tasks.filter(inBackpack);
  const due = review.started_at ? review.bet_task_ids : !settings.taskMode ? [] : active.filter(p => p.slot === '主线' && p.bet_ends_at && Date.parse(p.bet_ends_at) <= Date.parse(at)).map(p => p.id);
  const bet = due.filter(id => !review.bet_done_ids.includes(id)).map(id => tasks.find(p => p.id === id))
    .find(p => p && inBackpack(p) && p.slot === '主线');
  const duel = review.cold_duel ? { left: records.find(r => r.id === review.cold_duel!.left), right: records.find(r => r.id === review.cold_duel!.right) }
    : pair(records, settings.ideaPoolLimit);
  const ideaView = (idea: RecordEntry) => ({ id: idea.id, text: idea.text, needs: idea.needs, lastTouchedAt: idea.last_touched_at, isNew: review.added_idea_ids.includes(idea.id) });
  return {
    period: review.period, step: review.step as ReviewStep, done: review.done, betDue: due.length > 0,
    addedIdeas: review.added_idea_ids.flatMap(id => { const idea = records.find(r => r.id === id); return idea ? [idea.text] : []; }),
    duel: duel?.left && duel.right ? { left: ideaView(duel.left), right: ideaView(duel.right), over: Math.max(review.cold_duel ? 1 : 0, activeIdeas(records).length - settings.ideaPoolLimit) } : null,
    cold: { offered: coldOffer(records).map(idea => ({ id: idea.id, text: idea.text, needs: idea.needs, coldSince: idea.cold_since! })), poolFree: Math.max(0, settings.ideaPoolLimit - activeIdeas(records).length) },
    bet: bet?.bet_ends_at ? { taskId: bet.id, task: bet.name, betEndsAt: bet.bet_ends_at, betWeeks: settings.betWeeks } : null,
    backpack: { inBackpack: active.map(p => ({ id: p.id, name: p.name, slot: p.slot as '主线' | '支线' })), sideFree: active.filter(p => p.slot === '支线').length < settings.sideTasks },
  };
}
