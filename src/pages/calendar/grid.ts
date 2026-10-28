// 日历的纯计算（设计文档「计时 · 日历」、UI 规范 §11.6）：画哪几天、时间和像素的换算、吸附、拖动、重叠分栏、当天合计。
// 时刻用毫秒。条目只用到 id 和起止，字段名和计时条目一致，可以直接把条目传进来。
import { activityDayStart, addDays, HOUR, unionLength } from '../../shared/time';

export const HOUR_PX = 46;
const PX_PER_MS = HOUR_PX / HOUR;

export interface Span { id: string; started_at: string; ended_at: string | null }
const range = (e: Span, now: number): [number, number] => [Date.parse(e.started_at), e.ended_at === null ? now : Date.parse(e.ended_at)];

/** 要画的几天（每天的日边界时刻）：日视图一天，周视图从周一开始七天。shift 是往前（负）、往后（正）翻了几页。 */
export function viewDays(now: number, boundaryHour: number, view: 'day' | 'week', shift: number): number[] {
  const today = activityDayStart(now, boundaryHour);
  if (view === 'day') return [addDays(today, shift)];
  const monday = addDays(today, -((new Date(today).getDay() + 6) % 7) + shift * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** 按吸附步长取整。step 是毫秒（设置里的日历吸附，初始 5 分钟）。 */
export const snap = (t: number, step: number) => Math.round(t / step) * step;

/** 一天那一列有多高。有夏令时的那天不是 24 小时。 */
export const dayHeight = (day: number) => (addDays(day, 1) - day) * PX_PER_MS;

/** 一段时间在某一天那一列里的位置；和这一天不相交就是 null。跨过日边界的条目，在两天里各画一段。 */
export function piece(start: number, end: number, day: number): { top: number; height: number } | null {
  const a = Math.max(start, day), b = Math.min(end, addDays(day, 1));
  return b > a ? { top: (a - day) * PX_PER_MS, height: (b - a) * PX_PER_MS } : null;
}

/** 列里的纵坐标（像素）换成时刻，夹在这一天之内。 */
export const timeAt = (day: number, y: number) => Math.max(day, Math.min(addDays(day, 1), day + y / PX_PER_MS));

export type DragKind = 'create' | 'move' | 'copy' | 'top' | 'bottom';
/** t0 是按下时的时刻；start / end 是被拖那一条原来的起止（新建时没有；正在计时的 end 是 null）。 */
export interface Drag { kind: DragKind; t0: number; start?: number; end?: number | null }

/**
 * 拖到 t 时的新起止，结束都不晚于现在。
 * - create：从按下的位置拖到 t。
 * - move / copy：整块平移，碰到现在就整体往前推。正在计时的条目不能移动或复制，调用方只给它 top。
 * - top / bottom：只改一边，至少留一个吸附步长。
 */
export function dragTo(d: Drag, t: number, now: number, step: number): { start: number; end: number | null } {
  if (d.kind === 'create') {
    const a = snap(d.t0, step), b = snap(t, step);
    return { start: Math.min(a, b), end: Math.min(now, Math.max(a, b)) };
  }
  if (d.start === undefined) throw new Error('拖动已有条目时要给出原来的起止');
  if (d.kind === 'top') return { start: Math.min(snap(t, step), (d.end ?? now) - step), end: d.end ?? null };
  if (d.end === undefined || d.end === null) throw new Error('正在计时的条目只能拖开始边');
  if (d.kind === 'bottom') return { start: d.start, end: Math.min(now, Math.max(snap(t, step), d.start + step)) };
  const k = snap(t - d.t0, step);
  let start = d.start + k, end = d.end + k;
  if (end > now) { start -= end - now; end = now; }
  return { start, end };
}

export interface Placed<T> { entry: T; top: number; height: number; col: number; cols: number }

/**
 * 某一天里的条目怎么并排：互相重叠的归成一簇，簇里每条放进最靠左的空列，宽度是 1 / 这一簇的列数。
 * 待机由调用方先去掉（待机画成底纹，不参加分栏）。
 */
export function layoutDay<T extends Span>(entries: readonly T[], day: number, now: number): Placed<T>[] {
  const next = addDays(day, 1);
  const items = entries.flatMap(entry => {
    const [s, f] = range(entry, now), p = piece(s, f, day);
    return p ? [{ entry, ...p, s: Math.max(s, day), f: Math.min(f, next), col: 0, cols: 1 }] : [];
  }).sort((a, b) => a.s - b.s || b.f - a.f);
  let cluster: typeof items = [], colEnds: number[] = [], clusterEnd = -Infinity;
  const flush = () => { for (const x of cluster) x.cols = colEnds.length; cluster = []; colEnds = []; };
  for (const x of items) {
    if (x.s >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    let c = colEnds.findIndex(end => end <= x.s);
    if (c < 0) { c = colEnds.length; colEnds.push(0); }
    colEnds[c] = x.f; x.col = c; cluster.push(x); clusterEnd = Math.max(clusterEnd, x.f);
  }
  flush();
  return items.map(({ entry, top, height, col, cols }) => ({ entry, top, height, col, cols }));
}

/** 表头的当天合计：这一天里几件事重叠的部分只算一次。待机由调用方先去掉。 */
export function dayTotal(entries: readonly Span[], day: number, now: number): number {
  const next = addDays(day, 1);
  return unionLength(entries.map(e => { const [s, f] = range(e, now); return [Math.max(s, day), Math.min(f, next)] as const; }));
}

/** ISO 周数，周视图左上角的大编号用（「W43」）。 */
export function isoWeek(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 864e5 - 3 + (week1.getDay() + 6) % 7) / 7);
}
