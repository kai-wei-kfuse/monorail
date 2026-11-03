import type { TimeEntry } from './entry';
import { isIdle } from './entry';
import { activityDay, splitAtDays } from './day';
import { activityDayStart, addDays, unionLength } from '../../shared/time';

function mapToNullProtoRecord(map: ReadonlyMap<string, number>): Record<string, number> {
  const out: Record<string, number> = Object.create(null);
  for (const [key, value] of map) {
    out[key] = value;
  }
  return out;
}

export function cardMilliseconds(entries: TimeEntry[], cardId: string, at: string): number {
  return entries.filter(entry => entry.card_id === cardId)
    .reduce((total, entry) => total + Date.parse(entry.ended_at ?? at) - Date.parse(entry.started_at), 0);
}
export function activityDayTotals(entries: TimeEntry[], at: string, boundary: number): Record<string, Record<string, number>> {
  const days = new Map<string, Map<string, number>>();
  for (const entry of entries) {
    for (const piece of splitAtDays(entry.started_at, entry.ended_at ?? at, boundary)) {
      let dayMap = days.get(piece.day);
      if (!dayMap) {
        dayMap = new Map<string, number>();
        days.set(piece.day, dayMap);
      }
      dayMap.set(entry.project, (dayMap.get(entry.project) ?? 0) + Date.parse(piece.end) - Date.parse(piece.start));
    }
  }
  const result: Record<string, Record<string, number>> = Object.create(null);
  for (const [day, dayMap] of days) {
    result[day] = mapToNullProtoRecord(dayMap);
  }
  return result;
}

export type DayMode = 'activity' | 'calendar';

export interface ClippedTimeEntry {
  id: string;
  description: string;
  project: string;
  tags: string[];
  card_id: string | null;
  kind: TimeEntry['kind'];
  source: TimeEntry['source'];
  started_at: string;
  ended_at: string | null;
  is_open: boolean;
  clipped_start: string;
  clipped_end: string;
  clipped_ms: number;
}

export interface DaySummary {
  resolved_day: string;
  day_mode: DayMode;
  day_boundary_hour: number;
  timezone: string;
  start: string;
  end: string;
  effective_end: string;
  as_of: string;
  interval_elapsed_ms: number;
  non_idle_recorded_ms: number;
  non_idle_covered_ms: number;
  overlap_excess_ms: number;
  idle_ms: number;
  idle_plain_ms: number;
  paused_ms: number;
  untracked_ms: number;
  by_project: Record<string, number>;
  by_tag: Record<string, number>;
  entry_count: number;
}

export function assertClockConsistent(entries: readonly TimeEntry[], asOf: string): number {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new Error('INVALID_TIME：当前时间无效');
  for (const entry of entries) {
    const startMs = Date.parse(entry.started_at);
    const endMs = entry.ended_at === null ? asOfMs : Date.parse(entry.ended_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > asOfMs || endMs > asOfMs || endMs < startMs) {
      throw new Error(`CLOCK_INCONSISTENT：检测到计时记录时间晚于当前时刻或区间倒置（entry=${entry.id}）`);
    }
  }
  return asOfMs;
}

export function resolveDayRange(day: string, dayMode: DayMode, boundaryHour: number, asOf: string) {
  const asOfMs = Date.parse(asOf);
  if (!Number.isFinite(asOfMs)) throw new Error('INVALID_TIME：当前时间无效');
  const effectiveBoundary = dayMode === 'activity' ? boundaryHour : 0;
  let startMs: number;
  let endMs: number;
  let resolvedDay: string;
  if (day === 'today' || day === 'yesterday') {
    const todayStart = activityDayStart(asOfMs, effectiveBoundary);
    startMs = day === 'today' ? todayStart : addDays(todayStart, -1);
    endMs = addDays(startMs, 1);
    resolvedDay = activityDay(new Date(startMs).toISOString(), effectiveBoundary);
  } else if (day === 'this_week') {
    const todayStart = activityDayStart(asOfMs, effectiveBoundary);
    const dow = (new Date(todayStart).getDay() + 6) % 7;
    startMs = addDays(todayStart, -dow);
    endMs = addDays(startMs, 7);
    resolvedDay = activityDay(new Date(startMs).toISOString(), effectiveBoundary);
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) throw new Error(`INVALID_DATE：日期格式无效（${day}），请使用 today、yesterday、this_week 或 YYYY-MM-DD`);
    const year = Number(match[1]), month = Number(match[2]), date = Number(match[3]);
    const local = new Date(year, month - 1, date, effectiveBoundary, 0, 0, 0);
    if (local.getFullYear() !== year || local.getMonth() !== month - 1 || local.getDate() !== date) {
      throw new Error(`INVALID_DATE：不存在的日历日期（${day}）`);
    }
    startMs = local.getTime();
    endMs = addDays(startMs, 1);
    resolvedDay = day;
  }
  const effectiveEndMs = Math.min(endMs, Math.max(startMs, asOfMs));
  return {
    resolved_day: resolvedDay,
    day_mode: dayMode,
    day_boundary_hour: effectiveBoundary,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    effective_end: new Date(effectiveEndMs).toISOString(),
    startMs,
    endMs,
    effectiveEndMs,
  };
}

export function clipEntriesInRange(entries: readonly TimeEntry[], from: string, to: string, asOf: string): {
  from: string;
  to: string;
  effective_to: string;
  as_of: string;
  entries: ClippedTimeEntry[];
} {
  const asOfMs = assertClockConsistent(entries, asOf);
  const fromMs = Date.parse(from), toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error('INVALID_RANGE：查询结束时间必须晚于开始时间');
  }
  const effectiveToMs = Math.min(toMs, Math.max(fromMs, asOfMs));
  const clipped: ClippedTimeEntry[] = [];
  for (const entry of entries) {
    const rawStart = Date.parse(entry.started_at);
    const rawEnd = entry.ended_at === null ? asOfMs : Date.parse(entry.ended_at);
    const clipStart = Math.max(fromMs, rawStart);
    const clipEnd = Math.min(effectiveToMs, rawEnd);
    if (clipEnd <= clipStart) continue;
    clipped.push({
      id: entry.id,
      description: entry.description,
      project: entry.project,
      tags: [...entry.tags],
      card_id: entry.card_id,
      kind: entry.kind,
      source: entry.source,
      started_at: entry.started_at,
      ended_at: entry.ended_at,
      is_open: entry.ended_at === null,
      clipped_start: new Date(clipStart).toISOString(),
      clipped_end: new Date(clipEnd).toISOString(),
      clipped_ms: clipEnd - clipStart,
    });
  }
  clipped.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id));
  return {
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    effective_to: new Date(effectiveToMs).toISOString(),
    as_of: new Date(asOfMs).toISOString(),
    entries: clipped,
  };
}

export function summarizeDay(
  entries: readonly TimeEntry[],
  options: { day: string; dayMode: DayMode; boundaryHour: number; asOf: string; timezone: string },
): DaySummary {
  assertClockConsistent(entries, options.asOf);
  const range = resolveDayRange(options.day, options.dayMode, options.boundaryHour, options.asOf);
  const { entries: clipped } = clipEntriesInRange(entries, range.start, range.end, options.asOf);
  const interval_elapsed_ms = range.effectiveEndMs - range.startMs;
  const nonIdleSpans: [number, number][] = [];
  const idleSpans: [number, number][] = [];
  let non_idle_recorded_ms = 0;
  let idle_plain_ms = 0;
  let paused_ms = 0;
  const projectMap = new Map<string, number>();
  const tagMap = new Map<string, number>();

  for (const item of clipped) {
    projectMap.set(item.project, (projectMap.get(item.project) ?? 0) + item.clipped_ms);
    for (const tag of new Set(item.tags)) {
      tagMap.set(tag, (tagMap.get(tag) ?? 0) + item.clipped_ms);
    }
    const span: [number, number] = [Date.parse(item.clipped_start), Date.parse(item.clipped_end)];
    if (isIdle(item as unknown as TimeEntry)) {
      idleSpans.push(span);
      if (item.kind === '暂停') paused_ms += item.clipped_ms;
      else idle_plain_ms += item.clipped_ms;
    } else {
      nonIdleSpans.push(span);
      non_idle_recorded_ms += item.clipped_ms;
    }
  }

  const non_idle_covered_ms = unionLength(nonIdleSpans);
  const idle_ms = unionLength(idleSpans);
  const overlap_excess_ms = non_idle_recorded_ms - non_idle_covered_ms;
  const untracked_ms = Math.max(0, interval_elapsed_ms - non_idle_covered_ms - idle_ms);

  return {
    resolved_day: range.resolved_day,
    day_mode: range.day_mode,
    day_boundary_hour: range.day_boundary_hour,
    timezone: options.timezone,
    start: range.start,
    end: range.end,
    effective_end: range.effective_end,
    as_of: new Date(Date.parse(options.asOf)).toISOString(),
    interval_elapsed_ms,
    non_idle_recorded_ms,
    non_idle_covered_ms,
    overlap_excess_ms,
    idle_ms,
    idle_plain_ms,
    paused_ms,
    untracked_ms,
    by_project: mapToNullProtoRecord(projectMap),
    by_tag: mapToNullProtoRecord(tagMap),
    entry_count: clipped.length,
  };
}
