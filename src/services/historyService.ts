// 操作历史的查询（ADR 0019 第 8 条，执行方案 E8c）：不进每次提交都算的投影，按需读；
// 经 readSerial 排在提交队列上，读不到写了一半的 journal，读取期间也不会被清理删文件。
import { readSerial } from './commit';
import type { Ctx } from './commit';
import type { HistoryRecord } from '../shared/history';
import { activityDay } from '../domain/timeline/day';

export interface HistoryPage { records: HistoryRecord[]; bad: number; older: boolean; fromDay: string; toDay: string }

const pad = (n: number) => String(n).padStart(2, '0');
/** 活动日字符串往前推 n 个日历日（不用固定 24 小时）。 */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number), t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
export const today = (ctx: Ctx, at = ctx.now()) => activityDay(at, ctx.settings.dayBoundaryHour);

/** 最近 days 个活动日（含今天）的历史，从新到旧。 */
export function list(ctx: Ctx, days: number, at = ctx.now()): Promise<HistoryPage> {
  if (!Number.isSafeInteger(days) || days <= 0) throw new Error('天数必须为正整数');
  const toDay = today(ctx, at), fromDay = shiftDay(toDay, 1 - days);
  return readSerial(ctx, async () => ({ ...await ctx.repos.history.readDays(fromDay, toDay), fromDay, toDay }));
}

export const isAutomation = (r: HistoryRecord) => r.source.kind === 'mcp' || r.source.kind === 'cli' || r.source.kind === 'automation';
/** 设置 09「最近调用」：最近 n 条自动化改动。 */
export const recentAutomation = (ctx: Ctx, n: number): Promise<HistoryRecord[]> =>
  readSerial(ctx, () => ctx.repos.history.readRecent(n, isAutomation));
