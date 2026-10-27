import type { Card } from '../domain/card/card';
import type { Project } from '../domain/project/project';
import { inBackpack } from '../domain/project/project';
import type { Review } from '../domain/review/schedule';
import { dueReview } from '../domain/review/schedule';
import type { Segment } from '../domain/timeline/segment';
import { effective } from '../domain/timeline/effective';
import { activityDay } from '../domain/timeline/day';
import { baseline } from '../domain/baseline/baseline';
import { guide } from '../domain/picker/guide';
import type { AppState } from '../data/repos';
import type { Settings } from '../shared/settings';
import type { HomeSlice } from '../store/homeSlice';

export interface ProjectionInput { cards: Card[]; projects: Project[]; reviews: Review[]; segments: Segment[]; state: AppState; settings: Settings; at: string; version: number }
export function projectHome(input: ProjectionInput): HomeSlice {
  const { cards, projects, reviews, segments, state, settings, at, version } = input;
  const day = activityDay(at, settings.dayBoundaryHour), active = projects.filter(inBackpack);
  const main = active.find(project => project.slot === '主线');
  const selected = cards.find(card => card.id === state.current_card);
  const current = segments.find(segment => segment.id === state.open_segment && segment.ended_at === null);
  const rows = selected ? effective(segments, at).filter(row => row.card_id === selected.id) : [];
  const tail = current?.card_id === selected?.id ? [...rows].reverse().find(row => row.id === current?.id && Date.parse(row.ended_at!) === Date.parse(at)) : undefined;
  const closedEffectiveMs = rows.filter(row => row !== tail).reduce((sum, row) => sum + Date.parse(row.ended_at!) - Date.parse(row.started_at), 0);
  const project = active.find(item => item.id === selected?.project_id);
  const card = selected && (selected.status === '待做' || selected.status === '进行中') ? {
    id: selected.id, slotNo: project?.slot_index ? String(project.slot_index).padStart(2, '0') : '散', slotOf: `/${String(settings.sideSlots + settings.mainSlots).padStart(2, '0')}`,
    project: project?.name ?? '散件', type: selected.type, goalMinutes: selected.type === '时间盒卡' ? selected.timebox_minutes : null,
    content: selected.content, progressNote: selected.progress_note, status: selected.status,
    shrink: selected.no_shrink ? 'locked' as const : selected.shrink_level >= settings.shrinkMaxLevel ? 'max' as const : 'ok' as const,
  } : null;
  const mode = state.stopped_day === day ? 'stopped' : state.home_mode;
  return {
    mode, card, guideKind: guide(cards, projects), closedEffectiveMs,
    currentSegStartedAt: tail?.started_at ?? (current?.card_id === selected?.id ? current?.started_at ?? null : null),
    awayActivity: current?.kind === '插入' ? current.activity : null,
    baseline: baseline(cards, day, !!main), noMainHint: !main && !!card,
    rest: state.rest ? { suggestion: state.rest.suggestion } : null,
    review: state.first_used_day ? dueReview(day, state.first_used_day, settings.reviewWeekday, reviews, !!main?.bet_ends_at && Date.parse(main.bet_ends_at) <= Date.parse(at)) : null,
    activity: { kind: current?.kind === '插入' ? 'away' : current?.card_id ? 'focus' : 'idle', label: current?.activity ?? settings.lists.idleName, startedAt: current?.started_at ?? null },
    dataVersion: version,
  };
}
