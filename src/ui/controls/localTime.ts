const pad = (n: number) => String(n).padStart(2, '0');

const DAY_WORDS: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2 };
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 显示用：今年的写「10/28」，别的年份写「2027/1/5」。 */
export function formatDate(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
export const formatTime = (iso: string | null): string => (iso ? `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}` : '');

/**
 * 解析手写的日期：「今天/明天/后天」「28」「10/28」「1028」「2026-10-28」「20261028」。
 * 没写年份时取今年；如果这个日期已经过去了，算明年。空串返回 null，写不对返回 undefined。
 */
export function parseDate(text: string, now = new Date()): Date | null | undefined {
  const t = text.trim();
  if (!t) return null;
  if (t in DAY_WORDS) { const d = startOfDay(now); d.setDate(d.getDate() + DAY_WORDS[t]); return d; }
  const g = t.match(/\d+/g) ?? [];
  let y: number | null = null, m: number, d: number;
  if (g.length === 1 && g[0].length === 8) [y, m, d] = [+g[0].slice(0, 4), +g[0].slice(4, 6), +g[0].slice(6)];
  else if (g.length === 1 && g[0].length >= 3 && g[0].length <= 4) [m, d] = [+g[0].slice(0, -2), +g[0].slice(-2)];
  else if (g.length === 1 && g[0].length <= 2) [m, d] = [now.getMonth() + 1, +g[0]];
  else if (g.length === 2) [m, d] = [+g[0], +g[1]];
  else if (g.length === 3) [y, m, d] = [+g[0] < 100 ? 2000 + +g[0] : +g[0], +g[1], +g[2]];
  else return undefined;
  const year = y ?? now.getFullYear();
  const date = new Date(year, m - 1, d);
  if (date.getMonth() !== m - 1 || date.getDate() !== d) return undefined;
  if (y === null && date < startOfDay(now)) date.setFullYear(year + 1);
  return date;
}

/** 解析手写的时间：「18」「18:30」「1830」「930」。空串返回 null，写不对返回 undefined。 */
export function parseTime(text: string): { h: number; m: number } | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const g = t.match(/\d+/g) ?? [];
  let h: number, m: number;
  if (g.length === 1 && g[0].length <= 2) [h, m] = [+g[0], 0];
  else if (g.length === 1 && g[0].length <= 4) [h, m] = [+g[0].slice(0, -2), +g[0].slice(-2)];
  else if (g.length === 2) [h, m] = [+g[0], +g[1]];
  else return undefined;
  return h < 24 && m < 60 ? { h, m } : undefined;
}

/**
 * 日期 + 时间 → ISO。都空返回 null；只写时间算今天（已经过了就算明天）；只写日期算当天 23:59。
 * 任一处写不对返回 undefined。
 */
export function composeDateTime(dateText: string, timeText: string, now = new Date()): string | null | undefined {
  const date = parseDate(dateText, now), time = parseTime(timeText);
  if (date === undefined || time === undefined) return undefined;
  if (date === null && time === null) return null;
  const day = date ?? startOfDay(now);
  const out = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time?.h ?? 23, time?.m ?? 59);
  if (date === null && out < now) out.setDate(out.getDate() + 1);
  return out.toISOString();
}