// 时间的通用小工具，各层都可以用。时刻用毫秒；日边界是设置里的 dayBoundaryHour，按本地时间算。

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/** 这一刻所在活动日的起点：当天的日边界；还没到日边界时，是前一天的日边界。 */
export function activityDayStart(at: number, boundaryHour: number): number {
  const d = new Date(at);
  if (d.getHours() < boundaryHour) d.setDate(d.getDate() - 1);
  d.setHours(boundaryHour, 0, 0, 0);
  return d.getTime();
}

/** 活动日起点往后数 n 天（按日历日加，有夏令时的地方也对）。n 可以是负数。 */
export function addDays(dayStart: number, n: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** 几段时间合在一起有多长：重叠的部分只算一次。每段是 [开始, 结束)，结束不晚于开始的忽略。 */
export function unionLength(spans: readonly (readonly [number, number])[]): number {
  let sum = 0, end = -Infinity;
  for (const [a, b] of spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    if (b > end) { sum += b - Math.max(a, end); end = b; }
  }
  return sum;
}
