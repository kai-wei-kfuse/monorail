// 双月起止日期选择器的纯计算（UI 风格规范 §11.12「自定义时间」）。日期一律是 YYYY-MM-DD 字符串，按日历日计算。

const pad = (n: number) => String(n).padStart(2, '0');
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];

/** 2026-10-20 → 2026.10.20 */
export const dotDate = (day: string) => day.replaceAll('-', '.');
/** 含两端的天数（顺序不限）。 */
export function spanDays(a: string, b: string): number {
  const [x, y] = [parts(a), parts(b)];
  return Math.abs(Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86_400_000)) + 1;
}
/** 2026-11 往后 n 个月。 */
export function shiftMonth(ym: string, n: number): string {
  const t = +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1 + n;
  return `${Math.floor(t / 12)}-${pad(t % 12 + 1)}`;
}
export const MONTH_EN = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

/** 一个月固定 42 格（6 行，周一开始），null 是空格：翻月时高度不跳。 */
export function monthCells(ym: string): (string | null)[] {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7, n = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= n; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length < 42) cells.push(null);
  return cells;
}

/** 左边那个月：结束日所在月的前一个月，夹在 [最早一月, 今天的前一个月] 之间（右边那个月就到今天所在月）。 */
export function initialView(to: string, minDay: string | null, maxDay: string): string {
  const hi = shiftMonth(maxDay.slice(0, 7), -1), lo = minDay ? minDay.slice(0, 7) : null;
  let view = shiftMonth(to.slice(0, 7), -1);
  if (view > hi) view = hi;
  if (lo && view < lo) view = lo;
  return view;
}

export interface RangeDraft { from: string; to: string | null; anchor: string | null }
/** 先点开始、再点结束，顺序不限。 */
export function pickDay(d: RangeDraft, day: string): RangeDraft {
  if (!d.anchor) return { from: day, to: null, anchor: day };
  return d.anchor <= day ? { from: d.anchor, to: day, anchor: null } : { from: day, to: d.anchor, anchor: null };
}
export const dayDisabled = (day: string, minDay: string | null, maxDay: string) => (minDay !== null && day < minDay) || day > maxDay;

/** 日格的类名：today / s / e / in；选了开始、悬停在另一天时给预览 pv / pe。 */
export function cellClass(day: string, d: RangeDraft, today: string, hover: string | null): string {
  const out = [];
  if (day === today) out.push('today');
  if (day === d.from) out.push('s');
  if (d.to && day === d.to) out.push('e');
  if (d.to && day > d.from && day < d.to) out.push('in');
  if (d.anchor && hover && hover !== d.anchor) {
    const [lo, hi] = d.anchor <= hover ? [d.anchor, hover] : [hover, d.anchor];
    if (day > lo && day < hi) out.push('pv');
    if (day === hover) out.push('pe');
  }
  return out.join(' ');
}
