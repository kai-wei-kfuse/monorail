import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import { inBackpack } from '../domain/task/task';
import type { Review } from '../domain/review/schedule';
import { dueReview } from '../domain/review/schedule';
import type { TimeEntry } from '../domain/timeline/entry';
import { activityDay } from '../domain/timeline/day';
import { baseline } from '../domain/baseline/baseline';
import { guide } from '../domain/picker/guide';
import type { AppState } from '../data/repos';
import type { Settings } from '../shared/settings';
import { LOOSE } from '../shared/backpack';
import type { HomeSlice } from '../store/homeSlice';

export interface ProjectionInput { cards: Card[]; tasks: Task[]; reviews: Review[]; entries: TimeEntry[]; state: AppState; settings: Settings; at: string; version: number }
export function projectHome(input: ProjectionInput): HomeSlice {
  const { cards, tasks, reviews, entries, state, settings, at, version } = input;
  const day = activityDay(at, settings.dayBoundaryHour), active = tasks.filter(inBackpack);
  const mains = active.filter(task => task.slot === '主线');
  const selected = cards.find(card => card.id === state.current_card);
  const current = entries.find(entry => entry.id === state.open_entry && entry.ended_at === null);
  const rows = selected ? entries.filter(row => row.card_id === selected.id) : [];
  const tail = current?.card_id === selected?.id ? current : undefined;
  const closedEffectiveMs = rows.filter(row => row !== tail).reduce((sum, row) => sum + Date.parse(row.ended_at!) - Date.parse(row.started_at), 0);
  const task = active.find(item => item.id === selected?.task_id);
  const card = selected && (selected.status === '待做' || selected.status === '进行中') ? {
    id: selected.id, slotNo: task?.slot_index ? String(task.slot_index).padStart(2, '0') : LOOSE.slot, slotOf: `/${String(settings.sideTasks + settings.mainTasks).padStart(2, '0')}`,
    task: task?.name ?? LOOSE.name, type: selected.type, goalMinutes: selected.type === '时间盒卡' ? selected.timebox_minutes : null,
    content: selected.content, progressNote: selected.progress_note, status: selected.status,
    shrink: selected.no_shrink ? 'locked' as const : selected.shrink_level >= settings.shrinkMaxLevel ? 'max' as const : 'ok' as const,
  } : null;
  const mode = state.home_mode;
  return {
    mode, card, guideKind: guide(cards, tasks), closedEffectiveMs,
    currentSegStartedAt: tail?.started_at ?? null,
    awayActivity: current?.kind === '插入' ? current.description : current?.kind === '暂停' ? '已暂停' : null,
    baseline: baseline(cards, day, mains.length > 0), noMainHint: mains.length === 0 && !!card,
    rest: state.rest ? { suggestion: state.rest.suggestion } : null,
    review: state.first_used_day ? dueReview(day, state.first_used_day, settings.reviewWeekday, reviews, mains.some(main => main.bet_ends_at !== null && Date.parse(main.bet_ends_at) <= Date.parse(at))) : null,
    activity: { kind: current?.kind === '插入' ? 'away' : current?.project !== '待机' ? 'focus' : 'idle', label: current?.description ?? settings.lists.idleName, startedAt: current?.started_at ?? null },
    entry: current ? { id: current.id, description: current.description, project: current.project, tags: current.tags,
      startedAt: current.started_at, cardId: current.card_id, paused: current.kind === '暂停', kind: current.kind } : null,
    pending: state.pending_id ? { id: state.pending_id, startedAt: state.pending_at! } : null,
    resumeDescription: entries.find(entry => entry.id === state.resume_entry_id)?.description ?? null,
    dataVersion: version,
  };
}
