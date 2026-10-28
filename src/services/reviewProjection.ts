import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import type { RecordEntry } from '../domain/record/record';
import type { Review } from '../domain/review/schedule';
import { progress } from '../domain/review/flow';
import type { ReviewStep } from '../domain/review/flow';
import { activeIdeas, coldOffer } from '../domain/idea/pool';
import { pair } from '../domain/idea/arena';
import { effective } from '../domain/timeline/effective';
import { activityDayTotals, cardMilliseconds } from '../domain/timeline/stats';
import type { Segment } from '../domain/timeline/segment';
import type { Settings } from '../shared/settings';
import { LOOSE } from '../shared/backpack';
import type { AppState } from '../data/repos';
import type { RecapData, ReviewSlice } from '../store/reviewSlice';

export const currentReview = (reviews: Review[]) => [...reviews]
  .filter(review => review.status === '未开始' || review.status === '进行中')
  .sort((a, b) => b.period.localeCompare(a.period))[0];

export function recapStart(reviews: Review[], firstDay: string, boundary: number, at: string): string {
  const finished = reviews.filter(review => review.status === '已完成' && review.completed_at && Date.parse(review.completed_at) <= Date.parse(at))
    .sort((a, b) => Date.parse(b.completed_at!) - Date.parse(a.completed_at!))[0];
  // Legacy completed rows have no timestamp: retain history rather than invent a cutoff.
  return finished?.completed_at ?? new Date(`${firstDay}T${String(boundary).padStart(2, '0')}:00:00`).toISOString();
}

interface Input { cards: Card[]; tasks: Task[]; records: RecordEntry[]; reviews: Review[]; segments: Segment[]; state: AppState; settings: Settings; at: string }
function recap(input: Input, from: string): RecapData {
  const { cards, tasks, segments, settings, at } = input;
  const start = Date.parse(from), end = Date.parse(at);
  const timeline = effective(segments, at).filter(row => Date.parse(row.started_at) < end && Date.parse(row.ended_at!) > start)
    .map(row => ({ ...row, started_at: new Date(Math.max(start, Date.parse(row.started_at))).toISOString(),
      ended_at: new Date(Math.min(end, Date.parse(row.ended_at!))).toISOString() }));
  const totals: Record<string, number> = {};
  for (const day of Object.values(activityDayTotals(timeline, at, settings.dayBoundaryHour))) {
    for (const [project, ms] of Object.entries(day)) totals[project] = (totals[project] ?? 0) + ms;
  }
  const completed = cards.filter(card => card.completed_at && Date.parse(card.completed_at) > start && Date.parse(card.completed_at) <= end)
    .sort((a, b) => Date.parse(a.completed_at!) - Date.parse(b.completed_at!) || a.id.localeCompare(b.id));
  return {
    completed: completed.map(card => ({ id: card.id, content: card.content, task: tasks.find(task => task.id === card.task_id)?.name ?? LOOSE.name,
      day: card.completed_day!, minutes: cardMilliseconds(timeline, card.id, at) / 60_000 })),
    totals: Object.entries(totals).map(([project, ms]) => ({ project, minutes: ms / 60_000 })).sort((a, b) => b.minutes - a.minutes || a.project.localeCompare(b.project)),
    notes: cards.filter(card => {
      const noted = card.progress_noted_at ?? card.completed_at;
      return card.progress_note.trim() && noted && Date.parse(noted) > start && Date.parse(noted) <= end;
    }).map(card => ({ id: card.id, content: card.content, note: card.progress_note })),
  };
}

export function projectReview(input: Input): ReviewSlice {
  const { reviews, records, tasks, settings, state, at } = input;
  const row = currentReview(reviews);
  if (!row || !state.first_used_day) return null;
  const review = progress(row), active = tasks.filter(inBackpack);
  const due = review.started_at ? review.bet_task_ids : active.filter(p => p.slot === '主线' && p.bet_ends_at && Date.parse(p.bet_ends_at) <= Date.parse(at)).map(p => p.id);
  const bet = due.filter(id => !review.bet_done_ids.includes(id)).map(id => tasks.find(p => p.id === id))
    .find(p => p && inBackpack(p) && p.slot === '主线');
  const duel = review.cold_duel ? { left: records.find(r => r.id === review.cold_duel!.left), right: records.find(r => r.id === review.cold_duel!.right) }
    : pair(records, settings.ideaPoolLimit);
  const ideaView = (idea: RecordEntry) => ({ id: idea.id, text: idea.text, needs: idea.needs, lastTouchedAt: idea.last_touched_at, isNew: review.added_idea_ids.includes(idea.id) });
  return {
    period: review.period, step: review.step as ReviewStep, done: review.done, betDue: due.length > 0,
    recap: recap(input, recapStart(reviews, state.first_used_day, settings.dayBoundaryHour, at)),
    addedIdeas: review.added_idea_ids.flatMap(id => { const idea = records.find(r => r.id === id); return idea ? [idea.text] : []; }),
    duel: duel?.left && duel.right ? { left: ideaView(duel.left), right: ideaView(duel.right), over: Math.max(review.cold_duel ? 1 : 0, activeIdeas(records).length - settings.ideaPoolLimit) } : null,
    cold: { offered: coldOffer(records).map(idea => ({ id: idea.id, text: idea.text, needs: idea.needs, coldSince: idea.cold_since! })), poolFree: Math.max(0, settings.ideaPoolLimit - activeIdeas(records).length) },
    bet: bet?.bet_ends_at ? { taskId: bet.id, task: bet.name, betEndsAt: bet.bet_ends_at, betWeeks: settings.betWeeks } : null,
    backpack: { inBackpack: active.map(p => ({ id: p.id, name: p.name, slot: p.slot as '主线' | '支线' })), sideFree: active.filter(p => p.slot === '支线').length < settings.sideSlots },
  };
}
