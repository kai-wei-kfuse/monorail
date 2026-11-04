// 回看的时间部分（0.3.0-beta.3 D7，执行方案 E6）：周期解析、上一期、实际占用时长的分摊、分桶、按键累加、千分比。
// 不认识卡片和任务（eslint：domain/timeline 不得引用 card / task / review），「任务与来源」维度由 domain/review/recap 传入取键函数。
import type { TimeEntry } from './entry';
import { activityDay, activityDayStartOf } from './day';
import type { RecapPeriod, RecapRange, RecapUnit } from '../../shared/recap';
import { RECAP_IDLE_PROJECTS } from '../../shared/recap';

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (y: number, m: number, d: number) => { const t = new Date(y, m - 1, d); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
const parts = (day: string) => day.split('-').map(Number) as [number, number, number];

/** 日历日加减（不用固定 24 小时）。 */
export function addDay(day: string, n: number): string { const [y, m, d] = parts(day); return fmt(y, m, d + n); }
/** 两个活动日之间含两端的天数。 */
export function spanDays(from: string, to: string): number {
  const [a, b] = [parts(from), parts(to)];
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000) + 1;
}
const weekday = (day: string) => { const [y, m, d] = parts(day); return new Date(y, m - 1, d).getDay(); };
/** 这一天所在周的周一（周一开始）。 */
export const mondayOf = (day: string) => addDay(day, -((weekday(day) + 6) % 7));
const lastDayOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
/** 往前推 n 个月的同一天；那个月没有这一天时取月末（5-31 往前 3 个月是 2-28）。 */
function monthsBack(day: string, n: number): string {
  const [y, m, d] = parts(day), t = y * 12 + (m - 1) - n, yy = Math.floor(t / 12), mm = t % 12 + 1;
  return fmt(yy, mm, Math.min(d, lastDayOfMonth(yy, mm)));
}
export const isWeekend = (day: string) => [0, 6].includes(weekday(day));

interface PeriodContext { asOf: string; boundaryHour: number; lastReviewAt?: string | null; from?: string; to?: string }

function range(period: RecapPeriod, fromDay: string, toDay: string, asOf: string, boundaryHour: number, after: string | null = null): RecapRange {
  const from = after ?? new Date(activityDayStartOf(fromDay, boundaryHour)).toISOString();
  const to = new Date(activityDayStartOf(addDay(toDay, 1), boundaryHour)).toISOString();
  const effective = Math.min(Date.parse(to), Math.max(Date.parse(from), Date.parse(asOf)));
  return { period, fromDay, toDay, days: spanDays(fromDay, toDay), from, to, effectiveTo: new Date(effective).toISOString(), after };
}

/**
 * 7 种周期 → 活动日起止（含）与时刻范围 [from, to)。「今天」是 asOf 所在的活动日。
 * 本周：周一到今天；上周：上周一到上周日；本次回顾周期：上次完成回顾那一刻到今天（没有完成过回顾时由调用方给 recapStart 的值）；
 * 本月：1 号到今天；近 3 个月、最近一年：往前推 3 / 12 个月的后一天到今天；自定义：给定起止（顺序不限）。
 */
export function resolvePeriod(period: RecapPeriod, c: PeriodContext): RecapRange {
  const today = activityDay(c.asOf, c.boundaryHour);
  switch (period) {
    case 'week': return range(period, mondayOf(today), today, c.asOf, c.boundaryHour);
    case 'lastWeek': { const mon = addDay(mondayOf(today), -7); return range(period, mon, addDay(mon, 6), c.asOf, c.boundaryHour); }
    case 'cycle': {
      const after = c.lastReviewAt ?? new Date(activityDayStartOf(today, c.boundaryHour)).toISOString();
      const fromDay = activityDay(after, c.boundaryHour);
      return range(period, fromDay <= today ? fromDay : today, today, c.asOf, c.boundaryHour, Date.parse(after) <= Date.parse(c.asOf) ? after : null);
    }
    case 'month': return range(period, `${today.slice(0, 8)}01`, today, c.asOf, c.boundaryHour);
    case 'quarter': return range(period, addDay(monthsBack(today, 3), 1), today, c.asOf, c.boundaryHour);
    case 'year': return range(period, addDay(monthsBack(today, 12), 1), today, c.asOf, c.boundaryHour);
    case 'custom': {
      const a = c.from ?? today, b = c.to ?? today;
      return range(period, a <= b ? a : b, a <= b ? b : a, c.asOf, c.boundaryHour);
    }
  }
}

export const PREVIOUS_LABEL: Record<RecapPeriod, string> = {
  week: '上周', lastWeek: '上上周', cycle: '上个周期', month: '上月同期', quarter: '前 3 个月', year: '前一年', custom: '前一段',
};
/**
 * 上一期：紧挨着本期之前、同样天数的一段；本月按「上月同期」（不超过上月末）。
 * earliestDay 是最早一条记录的活动日；上一期有一部分早于它时 comparable = false（数据不全，不对比）。
 */
export function previousPeriod(current: RecapRange, asOf: string, boundaryHour: number, earliestDay: string | null) {
  const n = current.days;
  let fromDay = addDay(current.fromDay, -n), toDay = addDay(current.fromDay, -1);
  if (current.period === 'month') {
    const [y, m] = parts(current.fromDay), prevEnd = fmt(y, m, 0);
    fromDay = `${prevEnd.slice(0, 8)}01`;
    toDay = addDay(fromDay, n - 1); if (toDay > prevEnd) toDay = prevEnd;
  }
  const r = range(current.period, fromDay, toDay, asOf, boundaryHour);
  return { range: r, label: PREVIOUS_LABEL[current.period], comparable: earliestDay !== null && fromDay >= earliestDay };
}

/** 一条条目在某个活动日分到的实际占用时长（整数毫秒）。 */
export interface Share { entry: TimeEntry; day: string; ms: number }

/** 把整数 total 分成 k 份：每份 ⌊total / k⌋，余下的按给定次序各补 1。 */
export function splitEvenly(total: number, k: number): number[] {
  const q = Math.floor(total / k), r = total - q * k;
  return Array.from({ length: k }, (_, i) => q + (i < r ? 1 : 0));
}

/**
 * 实际占用时长的分摊（R1，用户 2026-11-04 定；审核 P5、G7）。顺序不能换：
 * 1. 先过滤：不含待机 / 睡眠时先剔除它们，否则和睡眠重叠的补录会被分走一半；
 * 2. 裁到周期内（与 clipEntriesInRange 同一口径，之后只用裁切后的端点），正在计时的以 asOf 为终点；
 * 3. 所有端点加上周期内的每个活动日界，切成互不重叠的原子段；被 k 条覆盖的段每条分 Δ / k，
 *    余数按条目 ID 排序各补 1 毫秒；段不跨日界，所以直接记到这一天。
 * 结果与输入顺序无关；所有份额之和 = 这段时间里至少有一条记录覆盖的总时长（并行只算一次）。
 */
/** 预先解析好时间戳、按开始时刻排好的条目。一次回看查询里各次分摊共用一份（一年约一万条，反复解析太慢）。 */
export interface Prepared {
  list: { entry: TimeEntry; start: number; end: number | null; idle: boolean }[];
  /** 已结束条目里最长的一条；正在计时的条目另记最早的开始 */
  longest: number; openStart: number;
}
/** 不依赖「现在」，同一份数据（同一个 dataVersion）可以给多次查询共用。 */
export function prepare(entries: readonly TimeEntry[]): Prepared {
  const list = entries.map(entry => ({ entry, start: Date.parse(entry.started_at), end: entry.ended_at === null ? null : Date.parse(entry.ended_at),
    idle: (RECAP_IDLE_PROJECTS as readonly string[]).includes(entry.project) })).filter(x => Number.isFinite(x.start)).sort((a, b) => a.start - b.start);
  let longest = 0, openStart = Infinity;
  for (const x of list) { if (x.end === null) openStart = Math.min(openStart, x.start); else longest = Math.max(longest, x.end - x.start); }
  return { list, longest, openStart };
}
const isPrepared = (x: readonly TimeEntry[] | Prepared): x is Prepared => !Array.isArray(x);

export function allocate(source: readonly TimeEntry[] | Prepared, r: RecapRange, asOf: string, boundaryHour: number, includeIdle: boolean): Share[] {
  const fromMs = Date.parse(r.from), toMs = Date.parse(r.to), asOfMs = Date.parse(asOf);
  if (toMs <= fromMs) return [];
  const prepared = isPrepared(source) ? source : prepare(source);
  // 裁切与 clipEntriesInRange 同一口径：[max(from, 开始), min(min(to, max(from, asOf)), 结束 ?? asOf))，之后只用裁切后的端点。
  // 晚于「现在」的部分（系统时钟被往回调过）截到现在，开始就晚于现在的不算，不让整页回看报错。
  // 条目按开始排好序：只看开始早于 to、且开始不早于 from − 最长一条时长的那一段。
  const effectiveTo = Math.min(toMs, Math.max(fromMs, asOfMs));
  const list = prepared.list, floor = Math.min(fromMs - prepared.longest, prepared.openStart);
  let hiIdx = list.length;
  { let a = 0, b = list.length; while (a < b) { const m = (a + b) >> 1; if (list[m].start < toMs) a = m + 1; else b = m; } hiIdx = a; }
  let loIdx = 0;
  { let a = 0, b = hiIdx; while (a < b) { const m = (a + b) >> 1; if (list[m].start < floor) a = m + 1; else b = m; } loIdx = a; }
  const spans: { entry: TimeEntry; s: number; e: number }[] = [];
  for (let i = loIdx; i < hiIdx; i++) {
    const x = list[i];
    if (!includeIdle && x.idle) continue;
    const end = x.end === null ? asOfMs : Math.min(x.end, asOfMs);
    const s = Math.max(fromMs, x.start), e = Math.min(effectiveTo, end);
    if (Number.isFinite(e) && e > s) spans.push({ entry: x.entry, s, e });
  }
  if (!spans.length) return [];
  let lo = Infinity, hi = -Infinity;
  for (const x of spans) { if (x.s < lo) lo = x.s; if (x.e > hi) hi = x.e; }
  // 覆盖范围内的活动日：每一天的起点，按日历日期分别构造（夏令时安全）
  const days: { day: string; start: number }[] = [];
  for (let day = activityDay(new Date(lo).toISOString(), boundaryHour); ; day = addDay(day, 1)) {
    const start = activityDayStartOf(day, boundaryHour);
    if (start >= hi) break;
    days.push({ day, start });
  }
  const cuts = new Set<number>();
  for (const x of spans) { cuts.add(x.s); cuts.add(x.e); }
  for (const d of days) if (d.start > lo && d.start < hi) cuts.add(d.start);
  const points = [...cuts].sort((a, b) => a - b);
  // spans 按开始时刻排好（prepare 已排序，裁切只会把更早的开始抬到 from，次序不变）
  const starts = spans, ends = [...spans].sort((a, b) => a.e - b.e);
  // 按时间顺序扫，一条条目的份额总是落在它最近的那一天：只需记住每条当前那一天的份额
  const active = new Map<string, TimeEntry>(), current = new Map<string, Share>(), out: Share[] = [];
  const add = (entry: TimeEntry, day: string, ms: number) => {
    const slot = current.get(entry.id);
    if (slot && slot.day === day) { slot.ms += ms; return; }
    const share = { entry, day, ms }; current.set(entry.id, share); out.push(share);
  };
  let si = 0, ei = 0, di = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    while (ei < ends.length && ends[ei].e <= a) active.delete(ends[ei++].entry.id);
    while (si < starts.length && starts[si].s <= a) { if (starts[si].e > a) active.set(starts[si].entry.id, starts[si].entry); si++; }
    if (!active.size) continue;
    while (di + 1 < days.length && days[di + 1].start <= a) di++;
    const day = days[di].day;
    if (active.size === 1) { add(active.values().next().value!, day, b - a); continue; }   // 绝大多数时段只有一条
    const ids = [...active.keys()].sort(), parts = splitEvenly(b - a, ids.length);
    for (let j = 0; j < ids.length; j++) add(active.get(ids[j])!, day, parts[j]);
  }
  // 分到 0 毫秒的（例如 1 毫秒的段分给 2 条时的第二条）不算参与
  const shares = out.filter(s => s.ms > 0);
  return shares.sort((x, y) => x.day < y.day ? -1 : x.day > y.day ? 1 : x.entry.id < y.entry.id ? -1 : x.entry.id > y.entry.id ? 1 : 0);
}

/** 分桶：≤ 16 天按日，17–100 天按周（周一开始），> 100 天按月。 */
export function unitFor(days: number): RecapUnit { return days <= 16 ? 'day' : days <= 100 ? 'week' : 'month'; }
export function bucketOf(day: string, unit: RecapUnit): string {
  return unit === 'day' ? day : unit === 'week' ? `W:${mondayOf(day)}` : `M:${day.slice(0, 7)}`;
}
const WK = ['日', '一', '二', '三', '四', '五', '六'];
const md = (day: string) => `${day.slice(5, 7)}.${day.slice(8, 10)}`;
/** 周期里的每一桶（含没有记录的），带显示用的文字。 */
export function bucketsOf(r: RecapRange, unit: RecapUnit) {
  const list: { id: string; label: string; sub: string; title: string; weekend: boolean; days: string[] }[] = [];
  for (let day = r.fromDay; day <= r.toDay; day = addDay(day, 1)) {
    const id = bucketOf(day, unit), last = list.at(-1);
    if (last?.id === id) { last.days.push(day); continue; }
    if (unit === 'day') list.push({ id, label: `周${WK[weekday(day)]}`, sub: md(day), title: `${md(day)} 周${WK[weekday(day)]}`, weekend: isWeekend(day), days: [day] });
    else if (unit === 'week') list.push({ id, label: md(day), sub: '', title: '', weekend: false, days: [day] });
    else list.push({ id, label: `${+day.slice(5, 7)}月`, sub: `${day.slice(2, 4)}年`, title: `${day.slice(0, 4)}年${+day.slice(5, 7)}月`, weekend: false, days: [day] });
  }
  for (const b of list) if (unit === 'week') { const end = b.days.at(-1)!; b.sub = `~${md(end)}`; b.title = `${md(b.days[0])}–${md(end)} 周`; }
  return list;
}

/**
 * 按键累加：每条份额全额计入 keysOf 给的键；给了多个键（多标签）时按 1 / n 分摊，余数按键名排序各补 1。
 * 交回每个键的总时长、出现的条目数、每个活动日的时长、每条条目分到的时长。
 */
export function sumByKey(shares: readonly Share[], keysOf: (entry: TimeEntry) => string[]) {
  const groups = new Map<string, { ms: number; entries: Map<string, number>; byDay: Map<string, number> }>();
  const put = (key: string, s: Share, ms: number) => {
    let g = groups.get(key);
    if (!g) groups.set(key, g = { ms: 0, entries: new Map(), byDay: new Map() });
    g.ms += ms;
    g.entries.set(s.entry.id, (g.entries.get(s.entry.id) ?? 0) + ms);
    g.byDay.set(s.day, (g.byDay.get(s.day) ?? 0) + ms);
  };
  for (const s of shares) {
    const raw = keysOf(s.entry);
    if (raw.length === 1) { put(raw[0], s, s.ms); continue; }
    const keys = [...new Set(raw)].sort(), parts = splitEvenly(s.ms, keys.length);
    for (let i = 0; i < keys.length; i++) put(keys[i], s, parts[i]);
  }
  return groups;
}

/** 最大余数法：把各项按占比分成整数千分数，合计正好 1000（全为 0 时都是 0）。并列时按给定次序。 */
export function permilles(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map(v => v * 1000 / total), base = raw.map(Math.floor);
  let left = 1000 - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - base[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; base[i]++; left--; }
  return base;
}

/** 维度取键：项目、标签（无标签归「无标签」，系统项按项目名）、具体活动（按描述）。 */
export const projectKeys = (e: TimeEntry) => [e.project];
export const tagKeys = (e: TimeEntry) => (RECAP_IDLE_PROJECTS as readonly string[]).includes(e.project) ? [e.project]
  : e.tags.length ? e.tags.map(t => `#${t}`) : ['无标签'];
export const activityKeys = (e: TimeEntry) => [e.description.trim() || '（无描述）'];

/** 一组条目在周期内的实际占用时长（这组自己的并行只算一次），例如一张卡的「用时」。 */
export function occupiedMs(entries: readonly TimeEntry[], r: RecapRange, asOf: string, boundaryHour: number): number {
  return allocate(entries, r, asOf, boundaryHour, true).reduce((n, s) => n + s.ms, 0);
}
