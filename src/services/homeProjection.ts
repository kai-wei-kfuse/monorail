import type { Card } from '../domain/card/card';
import { insertState, insertToContinue } from '../domain/timeline/insert';
import { minutesOnDay } from '../domain/plan/plan';
import type { DayPlan } from '../domain/plan/plan';
import { cardTiming } from '../domain/card/edit';
import type { Task } from '../domain/task/task';
import { inBackpack, trackOf } from '../domain/task/task';
import type { Review } from '../domain/review/schedule';
import { dueReview } from '../domain/review/schedule';
import type { TimeEntry } from '../domain/timeline/entry';
import { activityDay, activityDayStartOf } from '../domain/timeline/day';
import { baseline } from '../domain/baseline/baseline';
import { guide } from '../domain/picker/guide';
import type { AppState } from '../data/repos';
import type { Settings } from '../shared/settings';
import { LOOSE } from '../shared/backpack';
import type { HomeSlice } from '../store/homeSlice';
import { knownTags } from '../domain/timeline/tags';

export interface ProjectionInput { cards: Card[]; tasks: Task[]; reviews: Review[]; entries: TimeEntry[]; state: AppState; settings: Settings; at: string; version: number;
  /** 今天的板子：插入卡上沿那一条写「今天已计 / 今天的量」 */
  planToday?: DayPlan | null }
/** 插入卡的数据（UI 规范 §11.14）：不在插入状态时为 null */
function insertView(input: ProjectionInput, current: TimeEntry | undefined, resume: TimeEntry | undefined, day: string): HomeSlice['insert'] {
  const st = insertState(current, resume);
  if (!st || !current || !resume) return null;
  const { cards, tasks, entries, settings, at } = input;
  const paused = st === 'insertPaused', prev = paused ? insertToContinue(entries, current, resume) : null;
  const shown = paused ? prev : current;
  const card = resume.card_id ? cards.find(c => c.id === resume.card_id) : undefined;
  const over = card
    ? { kind: 'card' as const, cardId: card.id, title: card.content, track: trackOf(card.task_id, tasks),
        todayMs: Math.round(minutesOnDay(entries, card.id, day, settings.dayBoundaryHour, at) * 60_000),
        todayGoal: card.type === '时间盒卡' ? input.planToday?.items.find(i => i.card_id === card.id)?.today_minutes ?? card.timebox_minutes : null }
    : { kind: 'free' as const, title: resume.description, elapsedMs: Math.max(0, Date.parse(resume.ended_at ?? at) - Date.parse(resume.started_at)) };
  return { paused, canContinue: paused && prev !== null, name: shown?.description ?? '', project: shown?.project ?? '未分类',
    startedAt: paused ? null : current.started_at, over };
}
export function projectHome(input: ProjectionInput): HomeSlice {
  const { cards, tasks, reviews, entries, state, settings, at, version } = input;
  const day = activityDay(at, settings.dayBoundaryHour), active = tasks.filter(inBackpack);
  const mains = active.filter(task => task.slot === '主线');
  const selected = cards.find(card => card.id === state.current_card);
  const current = entries.find(entry => entry.id === state.open_entry && entry.ended_at === null);
  const rows = selected ? entries.filter(row => row.card_id === selected.id) : [];
  const tail = current?.card_id === selected?.id ? current : undefined;
  const closedEffectiveMs = rows.filter(row => row !== tail).reduce((sum, row) => sum + Date.parse(row.ended_at!) - Date.parse(row.started_at), 0);
  // 今天的：开着那一段跨了换日时间的话，今天只算换日以后那一截（界面从 max(开始, 今天起点) 往后补秒）
  const closedTodayMs = selected ? Math.round(minutesOnDay(rows.filter(row => row !== tail), selected.id, day, settings.dayBoundaryHour, at) * 60_000) : 0;
  // 卡在板子上才有「今天的量」；不在板子上首页写「目标 N 分钟」（G7 审核 N4）
  const todayGoal = selected?.type === '时间盒卡' ? input.planToday?.items.find(i => i.card_id === selected.id)?.today_minutes ?? null : null;
  const task = active.find(item => item.id === selected?.task_id);
  const card = selected && (selected.status === '待做' || selected.status === '进行中') ? {
    ...cardTiming(selected, tasks.find(task => task.id === selected.task_id)),
    id: selected.id, slotNo: task?.slot_index ? String(task.slot_index).padStart(2, '0') : LOOSE.slot, slotOf: `/${String(settings.sideTasks + settings.mainTasks).padStart(2, '0')}`,
    task: task?.name ?? LOOSE.name, type: selected.type, goalMinutes: selected.type === '时间盒卡' ? selected.timebox_minutes : null,
    content: selected.content, progressNote: selected.progress_note, status: selected.status,
  } : null;
  const mode = state.home_mode;
  const resume = entries.find(entry => entry.id === state.resume_entry_id);
  return {
    mode, card, guideKind: guide(cards, tasks), closedEffectiveMs, closedTodayMs, todayGoal,
    currentSegStartedAt: tail?.started_at ?? null, todaySegStartedAt: tail ? new Date(Math.max(Date.parse(tail.started_at), activityDayStartOf(day, settings.dayBoundaryHour))).toISOString() : null,
    awayActivity: current?.kind === '插入' ? current.description : current?.kind === '暂停' ? '已暂停' : null,
    baseline: baseline(cards, day, mains.length > 0), noMainHint: mains.length === 0 && !!card,
    rest: state.rest ? { suggestion: state.rest.suggestion } : null,
    review: state.first_used_day ? dueReview(day, state.first_used_day, settings.reviewWeekday, reviews, mains.some(main => main.bet_ends_at !== null && Date.parse(main.bet_ends_at) <= Date.parse(at))) : null,
    activity: { kind: current?.kind === '插入' ? 'away' : current?.project !== '待机' ? 'focus' : 'idle', label: current?.description ?? settings.lists.idleName, startedAt: current?.started_at ?? null },
    looseIdle: settings.trackingMode === 'loose' && current?.project === '待机' && current.kind !== '插入' && !state.resume_entry_id,
    insert: insertView(input, current, resume, day),
    entry: current ? { id: current.id, description: current.description, project: current.project, tags: current.tags,
      startedAt: current.started_at, cardId: current.card_id, paused: current.kind === '暂停', kind: current.kind } : null,
    resumeEntry: resume ? { id: resume.id, description: resume.description, project: resume.project, tags: resume.tags,
      startedAt: resume.started_at, endedAt: resume.ended_at, cardId: resume.card_id, kind: resume.kind } : null,
    pending: state.pending_id ? { id: state.pending_id, startedAt: state.pending_at! } : null,
    resumeDescription: resume?.description ?? null,
    knownTags: knownTags([...entries, ...settings.lists.presets, ...cards], settings.lists.tags),
    dataVersion: version,
  };
}
