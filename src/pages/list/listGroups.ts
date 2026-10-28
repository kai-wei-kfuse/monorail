// 列表的纯计算（设计文档「计时 · 列表」、UI 规范 §11.7）：筛选、按活动日分组（新的在上）、同一天相同的条目合成一组、
// 当天合计（重叠只算一次）、并行标记。字段名和计时条目一致，可以直接把条目传进来。
import { activityDayStart, addDays, unionLength } from '../../shared/time';

export interface ListEntry {
  id: string; started_at: string; ended_at: string | null;
  description: string; project: string; tags: string[]; card_id: string | null;
}
/** 一组相同的条目。first 是最早开始；last 是最晚结束，有一条还在计就是 null；total 是各条时长之和。 */
export interface EntryGroup<T> { key: string; entries: T[]; first: number; last: number | null; total: number }
export interface DayList<T> { day: number; total: number; groups: EntryGroup<T>[] }
export interface ListOptions<T> { now: number; boundaryHour: number; days: number; showIdle: boolean; query: string; isIdle: (e: T) => boolean }

const start = (e: ListEntry) => Date.parse(e.started_at);
const end = (e: ListEntry, now: number) => e.ended_at === null ? now : Date.parse(e.ended_at);

/** 筛选：描述、项目、#标签里包含输入的字，不分大小写。 */
export function matchesQuery(e: ListEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [e.description, e.project, ...e.tags.map(t => '#' + t)].join(' ').toLowerCase().includes(q);
}

/** 合成一组的依据：描述、项目、标签、卡都相同。 */
export const groupKey = (e: ListEntry) => [e.description, e.project, [...e.tags].sort().join(','), e.card_id ?? ''].join('|');

/**
 * 最近 days 天（含今天）开始的条目，按活动日分组，新的在上。同一天里相同的条目合成一组，组按组里最晚开始的排，组内新的在上。
 * 当天合计是这一天里显示出来的非待机条目合在一起的时长，重叠只算一次；跨过日边界的只算到下一个日边界。
 */
export function listDays<T extends ListEntry>(entries: readonly T[], o: ListOptions<T>): DayList<T>[] {
  const from = addDays(activityDayStart(o.now, o.boundaryHour), -(o.days - 1));
  const shown = entries.filter(e => start(e) >= from && (o.showIdle || !o.isIdle(e)) && matchesQuery(e, o.query))
    .sort((a, b) => start(b) - start(a) || a.id.localeCompare(b.id));
  const byDay = new Map<number, T[]>();
  for (const e of shown) {
    const day = activityDayStart(start(e), o.boundaryHour);
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  return [...byDay].map(([day, list]) => {
    const groups = new Map<string, T[]>();
    for (const e of list) groups.set(groupKey(e), [...(groups.get(groupKey(e)) ?? []), e]);
    return {
      day,
      total: unionLength(list.filter(e => !o.isIdle(e)).map(e => [start(e), Math.min(end(e, o.now), addDays(day, 1))] as const)),
      groups: [...groups].map(([key, es]) => ({
        key, entries: es, first: Math.min(...es.map(start)),
        last: es.some(e => e.ended_at === null) ? null : Math.max(...es.map(e => end(e, o.now))),
        total: es.reduce((sum, e) => sum + end(e, o.now) - start(e), 0),
      })),
    };
  });
}

/** 和别的条目时间重叠的条目 id（列表里标「并行」）。待机不算。 */
export function overlapping<T extends ListEntry>(entries: readonly T[], now: number, isIdle: (e: T) => boolean): Set<string> {
  const real = entries.filter(e => !isIdle(e));
  return new Set(real.filter(a => real.some(b => b.id !== a.id && start(b) < end(a, now) && end(b, now) > start(a))).map(e => e.id));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 组标题：今天 / 昨天 / 10 月 25 日 周六。day、today 都是活动日起点。 */
export function dayLabel(day: number, today: number): string {
  if (day === today) return '今天';
  if (day === addDays(today, -1)) return '昨天';
  const d = new Date(day);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WEEK[d.getDay()]}`;
}
