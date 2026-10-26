export function activityDay(at: string, boundaryHour: number): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid time: ${at}`);
  date.setHours(date.getHours() - boundaryHour);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function splitAtDays(start: string, end: string, boundaryHour: number): { start: string; end: string; day: string }[] {
  if (Date.parse(end) < Date.parse(start)) throw new Error('结束时间早于开始');
  const result = [];
  let cursor = new Date(start);
  while (cursor.getTime() < Date.parse(end)) {
    const boundary = new Date(cursor);
    boundary.setHours(boundaryHour, 0, 0, 0);
    if (boundary <= cursor) boundary.setDate(boundary.getDate() + 1);
    const stop = new Date(Math.min(boundary.getTime(), Date.parse(end)));
    result.push({ start: cursor.toISOString(), end: stop.toISOString(), day: activityDay(cursor.toISOString(), boundaryHour) });
    cursor = stop;
  }
  return result;
}
