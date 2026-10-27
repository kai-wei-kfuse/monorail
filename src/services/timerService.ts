import { closeSegment } from '../domain/timeline/segment';
import type { Segment } from '../domain/timeline/segment';
import { activityDay, splitAtDays } from '../domain/timeline/day';
import { releaseCard } from '../domain/card/transitions';
import type { Ctx, Transaction } from './commit';
import { run } from './commit';

type Target = Pick<Segment, 'activity' | 'category' | 'card_id' | 'kind' | 'resume_card_id'>;
export interface SwitchOptions { startAt?: string; source?: Segment['source'] }
export interface Activity { name: string; category: string }
export interface Range { start: string; end: string }

const ms = Date.parse;
const minutes = (n: number) => n * 60_000;

export function openSegmentInTx(tx: Transaction): Segment | null {
  if (!tx.state.open_segment) return null;
  const open = tx.segments.find(s => s.id === tx.state.open_segment && s.ended_at === null);
  if (!open) throw new Error('当前计时段不存在');
  return open;
}

type Change = { day: string; segment: Segment };
const staged = new WeakMap<Transaction, { changes: Change[]; writes: Transaction['writes'] }>();

/** All timelog changes of one transaction become one write per day file. */
async function stage(tx: Transaction, changes: Change[]) {
  const entry = staged.get(tx) ?? { changes: [], writes: [] };
  // A segment opened earlier in this transaction and closed later is written once, closed:
  // the repository only sees it as a new row, never as a history mutation.
  for (const change of changes) {
    const same = entry.changes.findIndex(c => c.day === change.day && c.segment.id === change.segment.id && c.segment.started_at === change.segment.started_at);
    if (same >= 0) entry.changes[same] = change; else entry.changes.push(change);
  }
  tx.writes = tx.writes.filter(w => !entry.writes.includes(w));
  entry.writes = await tx.repos.times.writes(entry.changes);
  tx.writes.push(...entry.writes);
  staged.set(tx, entry);
}

function track(tx: Transaction, segment: Segment) {
  tx.segments = [...tx.segments.filter(s => !(s.id === segment.id && s.started_at === segment.started_at)), segment];
}

/** Writes one logical segment; day-boundary pieces keep its id and seq (appendix A1). */
async function writeSegment(tx: Transaction, segment: Segment, firstDay?: string) {
  const end = segment.ended_at;
  const pieces = end === null ? [] : splitAtDays(segment.started_at, end, tx.settings.dayBoundaryHour);
  const changes = pieces.length
    ? pieces.map((p, i) => ({ day: i === 0 ? firstDay ?? p.day : p.day, segment: { ...segment, started_at: p.start, ended_at: p.end } }))
    : [{ day: firstDay ?? activityDay(segment.started_at, tx.settings.dayBoundaryHour), segment }];
  // Keep the original start string on the first piece so the file row is updated, not duplicated.
  changes[0].segment.started_at = segment.started_at;
  await stage(tx, changes);
  changes.forEach(c => track(tx, c.segment));
}

/**
 * Ends the open segment and opens `target`. `startAt` earlier than `at` backdates the new
 * segment (one-click backfill); it then overrides the overlapped history by its higher seq.
 */
export async function switchInTx(tx: Transaction, at: string, target: Target, opts: SwitchOptions = {}) {
  const startAt = opts.startAt ?? at;
  if (ms(startAt) > ms(at)) throw new Error('开始时间晚于命令时间');
  const previous = openSegmentInTx(tx);
  if (previous) {
    const closeAt = ms(previous.started_at) > ms(startAt) ? previous.started_at : startAt;
    await writeSegment(tx, closeSegment(previous, closeAt), tx.state.open_segment_day ?? undefined);
  }
  const next: Segment = { ...target, id: tx.id(), seq: tx.nextSeq(), started_at: startAt, ended_at: null, source: opts.source ?? '手动' };
  const day = activityDay(startAt, tx.settings.dayBoundaryHour);
  await writeSegment(tx, next, day);
  tx.state.open_segment = next.id;
  tx.state.open_segment_day = day;
}

export function idleTarget(tx: Transaction): Target {
  return { activity: tx.settings.lists.idleName, category: '待机', card_id: null, kind: '普通', resume_card_id: null };
}

/** Built-in activities that are not user-defined quick activities. */
const RESERVED: Record<string, string> = { 离线: '离线', 睡觉: '睡眠' };

/** A quick activity id, a reserved name, or a free-typed name (category 生活). */
function lookup(tx: Transaction, activity: string): Activity {
  const quick = tx.settings.lists.quickActivities.find(a => a.id === activity);
  if (quick) return { name: quick.name, category: quick.category };
  const name = activity.trim();
  if (!name) throw new Error('活动名不能为空');
  return { name, category: RESERVED[name] ?? '生活' };
}

/** Appendix A2: only one return target. Nested inserts keep the original card. */
export async function insertInTx(tx: Transaction, at: string, activity: Activity, opts: SwitchOptions = {}) {
  const current = openSegmentInTx(tx);
  const resume = current?.kind === '插入' ? current.resume_card_id : current?.card_id ?? null;
  await switchInTx(tx, at, { activity: activity.name, category: activity.category, card_id: null, kind: '插入', resume_card_id: resume }, opts);
}

export async function resumeInTx(tx: Transaction, at: string) {
  const current = openSegmentInTx(tx);
  if (!current || current.kind !== '插入') throw new Error('没有插入活动');
  const card = current.resume_card_id ? tx.cards.find(c => c.id === current.resume_card_id) : undefined;
  if (!card || card.status !== '进行中' || tx.state.current_card !== card.id) return switchInTx(tx, at, idleTarget(tx));
  const before = tx.segments.filter(s => s.card_id === card.id).sort((a, b) => b.seq - a.seq)[0];
  await switchInTx(tx, at, { activity: card.content, category: before?.category ?? '支线', card_id: card.id, kind: '普通', resume_card_id: null });
}

/** The card in progress goes back to 待做 and stops being current (sleep, offline). */
function releaseCurrentInTx(tx: Transaction) {
  const card = tx.cards.find(c => c.id === tx.state.current_card);
  if (card) tx.saveCard(releaseCard(card));
  tx.state.current_card = null;
}

/** A past interval with known bounds. It never changes the current activity. */
export async function backfillRangeInTx(tx: Transaction, at: string, range: Range, target: Target, source: Segment['source'] = '补记') {
  if (!(ms(range.start) < ms(range.end))) throw new Error('补记的结束时间必须晚于开始时间');
  if (ms(range.end) > ms(at)) throw new Error('补记不能超过现在');
  const segment: Segment = { ...target, id: tx.id(), seq: tx.nextSeq(), started_at: range.start, ended_at: range.end, source };
  await writeSegment(tx, segment);
  return segment;
}

/**
 * Lifecycle gap (shutdown, crash, sleep). Recorded as「离线」first so an unanswered question loses
 * nothing; idempotent per gap start, so repeated startup or resume events write it once.
 */
export async function settleOfflineInTx(tx: Transaction, gap: Range): Promise<Segment | null> {
  if (ms(gap.end) - ms(gap.start) < minutes(tx.settings.offlineAskMinMinutes)) return null;
  const day = activityDay(gap.start, tx.settings.dayBoundaryHour);
  const known = [...tx.segments, ...await tx.repos.times.readDay(day)];
  if (known.some(s => s.source === '离线追问' && ms(s.started_at) === ms(gap.start))) return null;
  const segment = await backfillRangeInTx(tx, gap.end, gap, { activity: '离线', category: '离线', card_id: null, kind: '普通', resume_card_id: null }, '离线追问');
  // After a gap nobody knows what is going on: stop the old activity rather than keep counting it.
  const open = openSegmentInTx(tx);
  if (open && open.category !== '待机' && ms(open.started_at) <= ms(gap.end)) {
    releaseCurrentInTx(tx);
    await switchInTx(tx, gap.end, idleTarget(tx));
  }
  tx.notices.push({ id: tx.id(), kind: 'offlineAsk', data: {
    from: gap.start, to: gap.end, activities: tx.settings.lists.quickActivities.map(a => ({ id: a.id, name: a.name })),
  } });
  return segment;
}

export const insert = (ctx: Ctx, activity: string, at: string) => run(ctx, tx => insertInTx(tx, at, lookup(tx, activity)), at);
export const resume = (ctx: Ctx, at: string) => run(ctx, tx => resumeInTx(tx, at), at);

export const backfillRange = (ctx: Ctx, range: Range, activity: string, at: string) =>
  run(ctx, tx => { const a = lookup(tx, activity); return backfillRangeInTx(tx, at, range, { activity: a.name, category: a.category, card_id: null, kind: '普通', resume_card_id: null }); }, at);

/** 「其实从 N 分钟前开始在做 Y」: a backdated insert, so「回来」still returns to the card. */
export const backfillSwitch = (ctx: Ctx, minutesAgo: number, activity: string, at: string) => run(ctx, tx => {
  if (!(minutesAgo > 0)) throw new Error('补记分钟数必须为正数');
  return insertInTx(tx, at, lookup(tx, activity), { startAt: new Date(ms(at) - minutes(minutesAgo)).toISOString(), source: '补记' });
}, at);

/** Answer to「从 X 到 Y 在做什么」: a newer segment over the same gap. */
export const answerOffline = (ctx: Ctx, gap: Range, activity: string, at: string) =>
  run(ctx, tx => { const a = lookup(tx, activity); return backfillRangeInTx(tx, at, gap, { activity: a.name, category: a.category, card_id: null, kind: '普通', resume_card_id: null }, '离线追问'); }, at);

export const settleOffline = (ctx: Ctx, gap: Range) => run(ctx, tx => settleOfflineInTx(tx, gap), gap.end);

/** 睡觉 ends the day's dealing (A5) and releases any card in progress. */
export const sleep = (ctx: Ctx, at: string) => run(ctx, async tx => {
  releaseCurrentInTx(tx);
  await switchInTx(tx, at, { activity: '睡觉', category: '睡眠', card_id: null, kind: '普通', resume_card_id: null });
  tx.state.stopped_day = activityDay(at, tx.settings.dayBoundaryHour);
}, at);

export const wake = (ctx: Ctx, at: string) => run(ctx, tx => switchInTx(tx, at, idleTarget(tx)), at);
