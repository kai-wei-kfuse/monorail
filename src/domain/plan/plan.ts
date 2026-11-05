import type { Card } from '../card/card';
import type { Task } from '../task/task';
import { inBackpack } from '../task/task';
import type { TimeEntry } from '../timeline/entry';
import { activityDay, activityDayStartOf, splitAtDays } from '../timeline/day';

/**
 * 今日任务板（ADR 0021 第 1 条）：一个活动日一份 plans/<day>.yaml。
 * 只存用户排进去的东西；今天已计、今日达成、候选、行显不显示都现算。
 */
export type PlanPriority = '普通' | '高';
export interface PlanItem {
  card_id: string; priority: PlanPriority;
  /** 时间盒才有：今天做 N 分钟；结果卡为 null */
  today_minutes: number | null;
  added_at: string;
  /** 从前一天带过来的（确认前不进候选） */
  carried: boolean;
}
export interface DayPlan {
  schemaVersion: 1; day: string;
  /** 选了「这次先不排」：到当天结束或排进第一项为止 */
  skip_until_planned: boolean;
  carried_from: string | null; carried_confirmed: boolean;
  /** 这一天的换日处理做过没有：每个活动日只做一次（第 2 轮 B2） */
  rolled_over: boolean;
  /** 本轮〔换一张〕跳过的卡 */
  seen: string[];
  items: PlanItem[];
}

export const emptyPlan = (day: string): DayPlan => ({ schemaVersion: 1, day, skip_until_planned: false, carried_from: null,
  carried_confirmed: true, rolled_over: false, seen: [], items: [] });

/** 后一天 / 前一天（按日历日期，和夏令时无关）。 */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

/** 这张卡在这个活动日计了多少分钟（按活动日切开，开着的条目算到 at）。 */
export function minutesOnDay(entries: readonly TimeEntry[], cardId: string, day: string, boundaryHour: number, at: string): number {
  let ms = 0;
  for (const entry of entries) {
    if (entry.card_id !== cardId) continue;
    const end = entry.ended_at ?? at;
    if (Date.parse(end) <= Date.parse(entry.started_at)) continue;
    for (const piece of splitAtDays(entry.started_at, end, boundaryHour)) if (piece.day === day) ms += Date.parse(piece.end) - Date.parse(piece.start);
  }
  return ms / 60_000;
}

/** 这张卡一共计了多少分钟。 */
export function totalMinutes(entries: readonly TimeEntry[], cardId: string, at: string): number {
  return entries.filter(entry => entry.card_id === cardId)
    .reduce((sum, entry) => sum + Math.max(0, Date.parse(entry.ended_at ?? at) - Date.parse(entry.started_at)), 0) / 60_000;
}

/** 时间盒还剩多少分钟（至少 0）。结果卡没有时长，返回 null。 */
export function remainingMinutes(card: Card, spentMinutes: number): number | null {
  return card.type === '时间盒卡' && card.timebox_minutes !== null ? Math.max(0, card.timebox_minutes - spentMinutes) : null;
}

/** 今日达成：卡已完成；时间盒今天已计 ≥ 今天的量。 */
export function achieved(item: PlanItem, card: Card | undefined, minutesToday: number): boolean {
  if (!card) return false;
  if (card.status === '已完成') return true;
  return item.today_minutes !== null && minutesToday >= item.today_minutes;
}

/** 卡还在背包里、还能做（待做或进行中，所在任务在背包）。板子不写盘移出，读的时候过滤（ADR 0021 第 1 条）。 */
export function workable(card: Card | undefined, tasks: readonly Task[]): card is Card {
  if (!card || (card.status !== '待做' && card.status !== '进行中')) return false;
  return card.task_id === null || tasks.some(task => task.id === card.task_id && inBackpack(task));
}

/** 板子上要显示的项：卡还在背包，或者今天已经完成了（完成的留在板子上显示「已完成」）。 */
export function visibleItems(plan: DayPlan, cards: readonly Card[], tasks: readonly Task[]): PlanItem[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  return plan.items.filter(item => { const card = byId.get(item.card_id); return card?.status === '已完成' || workable(card, tasks); });
}

/** 那天到期的卡标红（已定 16：只标那天到期的，已经过期的不标）。 */
export function dueOn(card: Card, day: string, boundaryHour: number): boolean {
  return card.due_at !== null && activityDay(card.due_at, boundaryHour) === day;
}

/** 这一条是不是从这个活动日起点之前就开始了（真的跨过了换日时间）。 */
export function startedBeforeDay(entry: TimeEntry, day: string, boundaryHour: number): boolean {
  return Date.parse(entry.started_at) < activityDayStartOf(day, boundaryHour);
}

export interface CarryInput {
  source: DayPlan; today: DayPlan; cards: readonly Card[]; tasks: readonly Task[];
  entries: readonly TimeEntry[]; boundaryHour: number; at: string;
}
/**
 * 把来源那天没达成的项带到今天（已定 4、49 提议 7）：保留优先级；今天的量 = min(来源填的, 剩下的时长)；
 * 卡已不在背包、今天已经排了的不带。返回新加的项（carried: true）。
 */
export function carryItems({ source, today, cards, tasks, entries, boundaryHour, at }: CarryInput): PlanItem[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const planned = new Set(today.items.map(item => item.card_id));
  const out: PlanItem[] = [];
  for (const item of source.items) {
    const card = byId.get(item.card_id);
    if (!workable(card, tasks) || planned.has(item.card_id)) continue;
    if (achieved(item, card, minutesOnDay(entries, card.id, source.day, boundaryHour, at))) continue;
    const rest = remainingMinutes(card, totalMinutes(entries, card.id, at));
    if (rest === 0) continue;
    const todayMinutes = item.today_minutes === null || rest === null ? (card.type === '时间盒卡' ? rest : null) : Math.min(item.today_minutes, rest);
    out.push({ card_id: card.id, priority: item.priority, today_minutes: todayMinutes, added_at: at, carried: true });
    planned.add(card.id);
  }
  return out;
}

/** 排进今天 / 明天时，时间盒默认填剩下的时长（已定 2，v0.4）。 */
export function defaultTodayMinutes(card: Card, spentMinutes: number): number | null {
  const rest = remainingMinutes(card, spentMinutes);
  return rest === null ? null : Math.max(5, Math.ceil(rest / 5) * 5);
}
