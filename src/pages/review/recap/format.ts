// 回看看板的显示用纯函数：时长、占比、增减、日期、y 轴刻度、展开上限。不含业务口径（口径在 domain/review/recap）。
import { dotDate } from '../../../ui/controls/dateRange';
import type { RecapBucket, RecapPrevious, RecapRange, RecapUnit } from '../../../shared/recap';

const MIN = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 整数毫秒 → HH:MM（小时不封顶，80:05），按分钟四舍五入。 */
export function hm(ms: number): string {
  const m = Math.round(Math.max(0, ms) / MIN);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}
/** 柱顶的简写：不到 10 小时写一位小数（7.5h），否则写整数小时（156h）。 */
export function hoursLabel(ms: number): string {
  const h = ms / (60 * MIN);
  return h < 10 ? `${(Math.round(h * 10) / 10).toFixed(1)}h` : `${Math.round(h)}h`;
}
/** 千分数 → 一位小数的百分数（312 → 31.2）。 */
export const pct = (permille: number) => (permille / 10).toFixed(1);
/** 不是查询给的千分数时（悬停提示里一根柱子的分项）现算一位小数。 */
export const ratio = (part: number, total: number) => total > 0 ? (part / total * 100).toFixed(1) : '0.0';

const WK = ['日', '一', '二', '三', '四', '五', '六'];
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];
/** 2026-11-08 → 周日 */
export const wk = (day: string) => { const [y, m, d] = parts(day); return `周${WK[new Date(y, m - 1, d).getDay()]}`; };
/** 2026-11-08 → 11.08 */
export const md = (day: string) => `${day.slice(5, 7)}.${day.slice(8, 10)}`;
/** 本地时刻 HH:MM */
export const clock = (iso: string) => { const t = new Date(iso); return `${pad(t.getHours())}:${pad(t.getMinutes())}`; };
/** 和今天同一年写 11.08，不同年写 2025.11.08。 */
export const ymd = (day: string, today: string) => day.slice(0, 4) === today.slice(0, 4) ? md(day) : dotDate(day);

/** 控制栏里的区间小字：11.02 – 11.08；本次回顾周期从上次完成回顾那一刻起，带上时刻。 */
export function rangeText(r: RecapRange, today: string): string {
  return `${ymd(r.fromDay, today)}${r.after ? ` ${clock(r.after)}` : ''} – ${md(r.toDay)}`;
}
export const previousRange = (p: RecapPrevious, today: string) => `${ymd(p.fromDay, today)}–${ymd(p.toDay, today)}`;

export interface Delta { text: string; dir: 'up' | 'dn' | 'flat' }
/** 增减：▲ 增加（黑）、▼ 减少（灰）、0 写「持平」；不分好坏，不用红绿。 */
export function delta(diff: number, format: (abs: number) => string, unit = ''): Delta {
  if (diff === 0) return { text: '持平', dir: 'flat' };
  return { text: `${diff > 0 ? '▲' : '▼'} ${format(Math.abs(diff))}${unit}`, dir: diff > 0 ? 'up' : 'dn' };
}
/** 时长增减不足 1 分钟时显示成 00:00 没有意义，按分钟取整后再比。 */
export const msDelta = (now: number, before: number) => delta(Math.round(now / MIN) - Math.round(before / MIN), m => hm(m * MIN));
/** 主线投入的增减：千分数之差 → 一位小数的百分点。 */
export const pointDelta = (now: number, before: number) => delta(now - before, v => (v / 10).toFixed(1), ' 个百分点');

/** y 轴：最高柱子（至少 1 小时）向上取整到刻度步长；步长随高度 1 / 2 / 4 / 10 / 20 小时。 */
export function yTicks(maxMs: number): { top: number; ticks: number[] } {
  const max = Math.max(60, maxMs / MIN);
  const step = max > 3600 ? 1200 : max > 1800 ? 600 : max > 900 ? 240 : max > 480 ? 120 : 60;
  const top = Math.ceil(max / step) * step, ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v * MIN);
  return { top: top * MIN, ticks };
}
export const tickLabel = (ms: number) => `${ms / MIN / 60}h`;

export const UNIT: Record<RecapUnit, { en: string; cn: string; action: string; scope: string }> = {
  day: { en: 'DAILY TREND', cn: '每日分布', action: '只看这一天', scope: '这一天' },
  week: { en: 'WEEKLY TREND', cn: '每周分布', action: '只看这一周', scope: '这一周' },
  month: { en: 'MONTHLY TREND', cn: '每月分布', action: '只看这一月', scope: '这一月' },
};

export const LIMITS = { legend: 6, sub: 12, card: 6, list: 10 } as const;
/** 先显示最近 limit 条，其余折叠；expanded 时全部显示。hidden 是折叠掉的条数（没超过上限时为 0）。 */
export function collapse<T>(list: readonly T[], limit: number, expanded: boolean): { shown: readonly T[]; hidden: number; overflow: boolean } {
  const overflow = list.length > limit;
  return { shown: overflow && !expanded ? list.slice(0, limit) : list, hidden: overflow ? list.length - limit : 0, overflow };
}
/** 选中某一桶时，完成的卡、做到哪了只留这一桶的天。 */
export const inBucket = <T extends { day: string }>(list: readonly T[], bucket: RecapBucket | null) =>
  bucket ? list.filter(x => bucket.days.includes(x.day)) : list;
