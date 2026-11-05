// 操作历史的查询（ADR 0019 第 8 条，执行方案 E8c）：不进每次提交都算的投影，按需读；
// 经 readSerial 排在提交队列上，读不到写了一半的 journal，读取期间也不会被清理删文件。
import { historyMergePath, maintain, readSerial, whenCommitsOpen } from './commit';
import type { Ctx } from './commit';
import type { HistoryRecord } from '../shared/history';
import { HISTORY_RETENTION_DAYS } from '../shared/history';
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

/**
 * 保留清理（ADR 0019 第 7 条，执行方案 E8d 第 1 条）：保留包含今天在内的最近 180 个活动日，删掉 day < 今天 − 179 天的。
 * 排在提交队列上（maintain），与提交、读取互斥；安装更新冻结期间先等解冻。跳过设置合并指针所指的文件。
 * 删一个失败不影响其余，也不封锁队列；不经 journal（逐文件删除，可重复）。
 */
export function cleanup(ctx: Ctx): Promise<{ removed: number; failed: number; cutoff: string }> {
  return whenCommitsOpen(ctx, () => maintain(ctx, async () => {
    const cutoff = shiftDay(today(ctx), -(HISTORY_RETENTION_DAYS - 1)), skip = historyMergePath(ctx);
    const result = await ctx.repos.history.removeBefore(cutoff, new Set(skip ? [skip] : []));
    // 今日任务板同样保留 180 天（ADR 0021 第 1 条）：逐个删，失败计数
    for (const d of (await ctx.repos.plans.days()).filter(d => d < cutoff)) { try { await ctx.repos.plans.remove(d); result.removed++; } catch { result.failed++; } }
    return { ...result, cutoff };
  }));
}

export const isAutomation = (r: HistoryRecord) => r.source.kind === 'mcp' || r.source.kind === 'cli' || r.source.kind === 'automation';
/** 设置 09「最近调用」：最近 n 条自动化改动。 */
export const recentAutomation = (ctx: Ctx, n: number): Promise<HistoryRecord[]> =>
  readSerial(ctx, () => ctx.repos.history.readRecent(n, isAutomation));
