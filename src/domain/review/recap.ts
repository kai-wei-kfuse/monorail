// 回看里需要卡片、任务的部分（0.3.0-beta.3 D7，执行方案 E6 第 2 条）：任务与来源维度、完成的卡、做到哪了、主线投入，
// 并把 domain/timeline/recap 的各步拼成一份 RecapResult。纯函数：不改输入，不读时钟（asOf 由调用方给）。
import type { Card } from '../card/card';
import type { Task } from '../task/task';
import { trackOf } from '../task/task';
import type { TimeEntry } from '../timeline/entry';
import { activityDay } from '../timeline/day';
import { activityKeys, allocate, bucketOf, bucketsOf, occupiedMs, permilles, prepare, previousPeriod, projectKeys, resolvePeriod, sumByKey, tagKeys, unitFor } from '../timeline/recap';
import type { Prepared, Share } from '../timeline/recap';
import { LOOSE } from '../../shared/backpack';
import { CHART_TOP, OTHER, RECAP_IDLE_PROJECTS, RECAP_SOURCES } from '../../shared/recap';
import type { RecapBucket, RecapDoneCard, RecapGroup, RecapNote, RecapQuery, RecapRange, RecapResult, RecapRow, RecapSeries, RecapSource } from '../../shared/recap';
import { recapColor } from '../../shared/recapColors';

export interface RecapInput {
  entries: readonly TimeEntry[]; cards: readonly Card[]; tasks: readonly Task[];
  /** 上次完成回顾的时刻（recapStart 的结果），「本次回顾周期」从这一刻起算 */
  lastReviewAt: string | null;
  firstUsedDay: string | null;
  projectColors: Record<string, string>;
  boundaryHour: number; asOf: string;
  query: RecapQuery;
  /** 同一份 entries 预先解析好的索引（服务层按 dataVersion 缓存）；不给就现做一份 */
  prepared?: Prepared;
}

const isIdleProject = (project: string) => (RECAP_IDLE_PROJECTS as readonly string[]).includes(project);
/** 一张卡算主线还是支线：已完成的卡用完成时冻结的 completed_track，没完成的按它现在所在任务的槽位。 */
export const cardTrack = (card: Card, tasks: readonly Task[]): '主线' | '支线' =>
  card.status === '已完成' && card.completed_track ? card.completed_track : trackOf(card.task_id, [...tasks]);

/** 「任务与来源」：插入的是临时离开；关联主线卡的是主线任务、其余卡是支线任务；没有卡是自由活动。待机 / 睡眠按项目名。 */
export function sourceOf(entry: TimeEntry, cards: ReadonlyMap<string, Card>, tasks: readonly Task[]): RecapSource {
  if (entry.kind === '插入') return '临时离开';
  if (!entry.card_id) return '自由活动';
  const card = cards.get(entry.card_id);
  return card && cardTrack(card, tasks) === '主线' ? '主线任务' : '支线任务';
}

const within = (at: string | null | undefined, r: RecapRange) => !!at && Date.parse(at) >= Date.parse(r.from) && Date.parse(at) <= Date.parse(r.effectiveTo);
const sumMs = (shares: readonly Share[]) => shares.reduce((n, s) => n + s.ms, 0);

function bySource(shares: readonly Share[], cards: ReadonlyMap<string, Card>, tasks: readonly Task[]) {
  const out = Object.fromEntries(RECAP_SOURCES.map(s => [s, 0])) as Record<RecapSource, number>;
  for (const s of shares) out[sourceOf(s.entry, cards, tasks)] += s.ms;
  return out;
}
const mainPermille = (src: Record<RecapSource, number>, total: number) => total > 0 ? Math.round(src['主线任务'] * 1000 / total) : 0;

function doneCards(input: RecapInput, r: RecapRange, byCard: ReadonlyMap<string, TimeEntry[]>): RecapDoneCard[] {
  const taskName = (id: string | null) => input.tasks.find(t => t.id === id)?.name ?? LOOSE.name;
  return input.cards.filter(c => c.status === '已完成' && within(c.completed_at, r)).map(c => ({
    id: c.id, content: c.content, task: taskName(c.task_id), track: cardTrack(c, input.tasks),
    day: activityDay(c.completed_at!, input.boundaryHour), at: c.completed_at!,
    ms: occupiedMs(byCard.get(c.id) ?? [], r, input.asOf, input.boundaryHour),
  })).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}
/** 做到哪了：每张卡只保存最新一条笔记（progress_note 会被覆盖），这是现有数据模型的限制（R3）。 */
function notesOf(input: RecapInput, r: RecapRange): RecapNote[] {
  const taskName = (id: string | null) => input.tasks.find(t => t.id === id)?.name ?? LOOSE.name;
  return input.cards.flatMap(c => {
    const at = c.progress_noted_at ?? c.completed_at;
    if (!c.progress_note.trim() || !within(at, r)) return [];
    return [{ id: c.id, note: c.progress_note, content: c.content, task: taskName(c.task_id), track: cardTrack(c, input.tasks),
      day: activityDay(at!, input.boundaryHour), at: at! }];
  }).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id));
}

const byMsThenKey = <T extends { key: string; ms: number }>(a: T, b: T) => b.ms - a.ms || a.key.localeCompare(b.key);

/** 回看的全部数字。各组合计 = 各柱之和 = totalMs（整数毫秒严格相等）；有效投入不随「含待机/睡眠」开关变。 */
export function computeRecap(input: RecapInput): RecapResult {
  const { entries, tasks, query, asOf, boundaryHour } = input;
  const cards = new Map(input.cards.map(c => [c.id, c]));
  const prepared = input.prepared ?? prepare(entries);
  const byCard = new Map<string, TimeEntry[]>();
  for (const e of entries) if (e.card_id) { const list = byCard.get(e.card_id); if (list) list.push(e); else byCard.set(e.card_id, [e]); }
  const r = resolvePeriod(query.period, { asOf, boundaryHour, lastReviewAt: input.lastReviewAt, from: query.from, to: query.to });
  // 最早的记录：首次使用日与最早一条条目所在活动日里更早的那个（迁移来的老条目可能早于首次使用日）
  let firstStart = Infinity;
  for (const e of entries) { const s = Date.parse(e.started_at); if (s < firstStart) firstStart = s; }
  const firstEntryDay = Number.isFinite(firstStart) ? activityDay(new Date(firstStart).toISOString(), boundaryHour) : null;
  const earliest = [input.firstUsedDay, firstEntryDay].filter((d): d is string => d !== null).sort()[0] ?? null;

  const keysOf = query.dim === 'project' ? projectKeys : query.dim === 'tag' ? tagKeys : query.dim === 'activity' ? activityKeys
    : (e: TimeEntry) => [isIdleProject(e.project) ? e.project : sourceOf(e, cards, tasks)];

  // 有效投入与主线投入：总是不含待机 / 睡眠
  const effective = allocate(prepared, r, asOf, boundaryHour, false), effectiveMs = sumMs(effective);
  const activeDays = new Set(effective.filter(s => s.ms > 0).map(s => s.day)).size;
  const src = bySource(effective, cards, tasks);

  // 当前开关下的分组
  const shares = query.includeIdle ? allocate(prepared, r, asOf, boundaryHour, true) : effective;
  const totalMs = sumMs(shares);
  const all = [...sumByKey(shares, keysOf)].map(([key, g]) => ({ key, ...g })).sort(byMsThenKey);
  const colors = new Map(all.map((g, i) => [g.key, recapColor(query.dim, g.key, i, input.projectColors)]));

  // 图表：最多 8 项单独配色，超过 9 项时其余合并成「其他」
  const head = all.length <= CHART_TOP + 1 ? all : all.slice(0, CHART_TOP), rest = all.slice(head.length);
  const seriesKeys = new Map<string, string>(head.map(g => [g.key, g.key]));
  for (const g of rest) seriesKeys.set(g.key, OTHER);
  const seriesMs = [...head.map(g => g.ms), ...(rest.length ? [rest.reduce((n, g) => n + g.ms, 0)] : [])];
  const seriesPm = permilles(seriesMs);
  const series: RecapSeries[] = [...head.map((g, i) => ({ key: g.key, ms: g.ms, permille: seriesPm[i], color: colors.get(g.key)!, merged: 0 })),
    ...(rest.length ? [{ key: OTHER, ms: seriesMs.at(-1)!, permille: seriesPm.at(-1)!, color: recapColor(query.dim, OTHER, CHART_TOP, input.projectColors), merged: rest.length }] : [])];

  const unit = unitFor(r.days);
  const buckets: RecapBucket[] = bucketsOf(r, unit).map(b => ({ ...b, totalMs: 0, byKey: {} }));
  const bucketIndex = new Map(buckets.map(b => [b.id, b]));
  for (const g of all) for (const [day, ms] of g.byDay) {
    const b = bucketIndex.get(bucketOf(day, unit)); if (!b) continue;
    const k = seriesKeys.get(g.key)!; b.byKey[k] = (b.byKey[k] ?? 0) + ms; b.totalMs += ms;
  }

  // 上一期
  const prev = previousPeriod(r, asOf, boundaryHour, earliest);
  let previousByKey: Map<string, number> | null = null;
  let previous = { label: prev.label, fromDay: prev.range.fromDay, toDay: prev.range.toDay, comparable: prev.comparable, effectiveMs: 0, mainPermille: 0, done: 0, notes: 0 };
  if (prev.comparable) {
    const pEff = allocate(prepared, prev.range, asOf, boundaryHour, false), pEffMs = sumMs(pEff);
    const pShares = query.includeIdle ? allocate(prepared, prev.range, asOf, boundaryHour, true) : pEff;
    previousByKey = new Map([...sumByKey(pShares, keysOf)].map(([k, g]) => [k, g.ms]));
    previous = { ...previous, effectiveMs: pEffMs, mainPermille: mainPermille(bySource(pEff, cards, tasks), pEffMs),
      done: input.cards.filter(c => c.status === '已完成' && within(c.completed_at, prev.range)).length, notes: notesOf(input, prev.range).length };
  }

  // 明细：整个周期，或只看某一桶
  const bucket = query.bucket ? bucketIndex.get(query.bucket) ?? null : null;
  const listShares = bucket ? shares.filter(s => bucket.days.includes(s.day)) : shares;
  const list = bucket ? [...sumByKey(listShares, keysOf)].map(([key, g]) => ({ key, ...g })).sort(byMsThenKey) : all;
  const listPm = permilles(list.map(g => g.ms));
  // 每条条目在明细范围里出现的第一天、最后一天（份额按天排好序）
  const spanOf = new Map<string, { entry: TimeEntry; first: string; last: string }>();
  for (const s of listShares) {
    const x = spanOf.get(s.entry.id);
    if (x) { if (s.day < x.first) x.first = s.day; if (s.day > x.last) x.last = s.day; } else spanOf.set(s.entry.id, { entry: s.entry, first: s.day, last: s.day });
  }
  const rowFor = (entry: TimeEntry, ms: number, count: number, firstDay: string, lastDay: string): RecapRow => {
    const card = entry.card_id ? cards.get(entry.card_id) ?? null : null;
    return { key: entry.id, description: entry.description, ms, count, firstDay, lastDay,
      start: null, end: null, project: entry.project, tags: [...entry.tags],
      card: card ? { id: card.id, content: card.content, track: cardTrack(card, tasks) } : null,
      source: isIdleProject(entry.project) ? null : sourceOf(entry, cards, tasks) };
  };
  const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const groups: RecapGroup[] = list.map((g, i) => {
    let rows: RecapRow[];
    if (query.dim === 'activity') {
      rows = [...g.entries].map(([id, ms]) => { const x = spanOf.get(id)!;
        return { ...rowFor(x.entry, ms, 1, x.first, x.last), start: x.entry.started_at, end: x.entry.ended_at }; })
        .sort((a, b) => cmp(b.start!, a.start!) || cmp(a.key, b.key));
    } else {
      const merged = new Map<string, { entry: TimeEntry; ms: number; count: number; first: string; last: string }>();
      for (const [id, ms] of g.entries) {
        const x = spanOf.get(id)!, k = activityKeys(x.entry)[0], m = merged.get(k);
        if (!m) { merged.set(k, { entry: x.entry, ms, count: 1, first: x.first, last: x.last }); continue; }
        m.ms += ms; m.count++; if (x.first < m.first) m.first = x.first; if (x.last > m.last) m.last = x.last;
      }
      rows = [...merged].map(([k, m]) => ({ ...rowFor(m.entry, m.ms, m.count, m.first, m.last), key: k }))
        .sort((a, b) => b.ms - a.ms || cmp(a.key, b.key));
    }
    const previousMs = bucket || !previousByKey ? undefined : previousByKey.has(g.key) ? previousByKey.get(g.key)! : null;
    return { key: g.key, ms: g.ms, permille: listPm[i], count: g.entries.size, color: colors.get(g.key) ?? recapColor(query.dim, g.key, i, input.projectColors), previousMs, rows };
  });
  const goneKeys = previousByKey && !bucket ? [...previousByKey.keys()].filter(k => !all.some(g => g.key === k)).sort() : [];

  return {
    range: r, today: activityDay(asOf, boundaryHour), earliestDay: earliest, lastReviewAt: input.lastReviewAt,
    effectiveMs, activeDays, entryCount: new Set(shares.map(s => s.entry.id)).size,
    mainline: { permille: mainPermille(src, effectiveMs), bySource: src },
    previous, unit, buckets, totalMs, series, groups, goneKeys,
    done: doneCards(input, r, byCard), notes: notesOf(input, r),
  };
}
