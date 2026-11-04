export function activityDay(at: string, boundaryHour: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid time: ${at}`);
  date.setHours(date.getHours() - boundaryHour);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 活动日 day（YYYY-MM-DD）开始的时刻：那一天本地的 boundaryHour 点。按日历日期直接构造，不在同一个 Date 上先改小时再改日期。 */
export function activityDayStartOf(day: string, boundaryHour: number): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, boundaryHour).getTime();
}

/**
 * 把一段时间按活动日切开。0.3.0-beta.3 修正夏令时错误（执行方案 E6，审核 G6）：以前在同一个 Date 上
 * 先 setHours(boundaryHour) 再 setDate(+1)，春季跳时那天 boundaryHour 不存在被规范成后一小时，次日也被带偏一小时。
 * 现在每一天的日界都按目标日历日期单独构造。
 */
export function splitAtDays(start: string, end: string, boundaryHour: number): { start: string; end: string; day: string }[] {
  const stopAt = Date.parse(end);
  if (stopAt < Date.parse(start)) throw new Error('结束时间早于开始');
  const result = [];
  let cursor = Date.parse(start);
  while (cursor < stopAt) {
    const day = activityDay(new Date(cursor).toISOString(), boundaryHour);
    const [y, m, d] = day.split('-').map(Number);
    const next = new Date(y, m - 1, d + 1, boundaryHour).getTime();
    if (next <= cursor) throw new Error(`活动日边界计算错误：${new Date(cursor).toISOString()}`);
    const stop = Math.min(next, stopAt);
    result.push({ start: new Date(cursor).toISOString(), end: new Date(stop).toISOString(), day });
    cursor = stop;
  }
  return result;
}
