// 操作历史的采集（ADR 0019 第 3、4 条，执行方案 E8a2）：commit.ts 的 execute() 在算出业务 writes 之后、transact 之前调用，
// 把历史作为新文件 write 追加进同一份 journal。设置在 60 秒内连续改同一项时改写上一条（合并）。
import type { Card } from '../domain/card/card';
import type { Task } from '../domain/task/task';
import type { Review } from '../domain/review/schedule';
import type { RecordEntry } from '../domain/record/record';
import type { TimeEntry } from '../domain/timeline/entry';
import { activityDay } from '../domain/timeline/day';
import { compareAll, splitSubject } from '../domain/history/compare';
import type { Captured } from '../domain/history/compare';
import type { DayChange, HistoryWrite, Repositories } from '../data/repos';
import { HISTORY_PARAMS_LIMIT, historyActions } from '../shared/history';
import type { HistoryChange, HistoryIntent, HistoryObjectType, HistoryRecord, HistorySource, HistoryActionSpec } from '../shared/history';
import type { Settings } from '../shared/settings';

export interface CaptureInput {
  intent: HistoryIntent; value: unknown;
  /** 自动化调用：方法、operation_id、规范化后的参数原文 */
  operation?: { id: string; command: string; input: string };
  at: string; boundaryHour: number; id: () => string;
  before: { state: Record<string, unknown>; settings: Settings };
  after: { state: Record<string, unknown>; settings: Settings; cards: readonly Card[]; tasks: readonly Task[]; entries: readonly TimeEntry[] };
  changed: { cards: Captured<Card>[]; tasks: Captured<Task>[]; reviews: Captured<Review>[]; records: Captured<RecordEntry>[]; days: DayChange[] };
}

/** 设置合并要记住的上一条（只在 transact 成功后更新；提交失败或重载后清空）。 */
export interface MergePointer {
  path: string; rawText: string; record: HistoryRecord; committedAtMs: number; settingKey: string; sourceKey: string; day: string;
}
export interface PendingHistory { write: HistoryWrite; record: HistoryRecord; pointer: MergePointer | null }

const MERGE_WINDOW_MS = 60_000;
const DEFAULT_MANUAL: HistorySource = { kind: 'manual', via: 'main' };
const DEFAULT_AUTOMATION: HistorySource = { kind: 'automation', agent: { name: null, detected_by: 'none' } };
const specOf = (action: string): HistoryActionSpec | null => (historyActions as Record<string, HistoryActionSpec>)[action] ?? null;

/** 设置合并的累计（审核 G9）：按「对象类型 + ID + 字段」保留首次的改前、末次的改后；来回改的项去掉。 */
export function mergeChanges(prev: HistoryChange[], next: HistoryChange[]): HistoryChange[] {
  const key = (c: HistoryChange) => `${c.type}\u0000${c.id}\u0000${c.field}`, out = new Map<string, HistoryChange>();
  for (const c of prev) out.set(key(c), { ...c });
  for (const c of next) { const old = out.get(key(c)); out.set(key(c), old ? { ...c, before: old.before } : { ...c }); }
  return [...out.values()].filter(c => c.before !== c.after);
}

function subjectRef(input: CaptureInput, all: HistoryChange[]): { type: HistoryObjectType; id: string } | null {
  if (input.intent.subject) return input.intent.subject;
  const spec = specOf(input.intent.action);
  if (!spec?.subject) return null;
  if (spec.locate === 'result') {
    const v = input.value, id = typeof v === 'string' ? v : v && typeof v === 'object' && typeof (v as { id?: unknown }).id === 'string' ? (v as { id: string }).id : null;
    if (id) return { type: spec.subject, id };
  }
  const first = all.find(c => c.type === spec.subject);
  return first ? { type: first.type, id: first.id } : null;
}

/**
 * 算出这次提交要写的历史；没有实质改动（只写了 receipt、只动了簿记字段、noop）交回 null。
 * last 是这个 Ctx 上一条设置历史的指针，满足合并条件时改写它而不是新写一条。
 */
export function captureHistory(repos: Pick<Repositories, 'history'>, input: CaptureInput, last: MergePointer | null, nowMs: number): PendingHistory | null {
  const dayBefore = input.changed.days.flatMap(d => d.before), dayAfter = input.changed.days.flatMap(d => d.after);
  const names = {
    tasks: new Map([...input.changed.tasks.flatMap(c => [c.before, c.after]).filter((t): t is Task => !!t), ...input.after.tasks].map(t => [t.id, t.name])),
    cards: new Map([...input.changed.cards.flatMap(c => [c.before, c.after]).filter((c): c is Card => !!c), ...input.after.cards].map(c => [c.id, c.content])),
    entries: new Map([...dayBefore, ...input.after.entries].map(e => [e.id, e.description || '（无描述）'])),
  };
  const all = compareAll({ cards: input.changed.cards, tasks: input.changed.tasks, reviews: input.changed.reviews, records: input.changed.records,
    entries: { before: dayBefore, after: dayAfter }, state: { before: input.before.state, after: input.after.state },
    settings: { before: input.before.settings as unknown as Record<string, unknown>, after: input.after.settings as unknown as Record<string, unknown> }, names });
  if (!all.length) return null;
  const source = input.intent.source ?? (input.operation ? DEFAULT_AUTOMATION : DEFAULT_MANUAL);
  const entryMap = new Map([...dayBefore, ...input.after.entries].map(e => [e.id, e]));
  const cardMap = new Map([...input.changed.cards.flatMap(c => [c.before, c.after]).filter((c): c is Card => !!c), ...input.after.cards].map(c => [c.id, c]));
  const { subject, changes, effects } = splitSubject(all, subjectRef(input, all), { entries: entryMap, cards: cardMap, taskNames: names.tasks });
  const spec = specOf(input.intent.action);
  const day = activityDay(input.at, input.boundaryHour);
  const call = input.operation ? {
    method: input.operation.command, operation_id: input.operation.id,
    params: input.operation.input.length > HISTORY_PARAMS_LIMIT ? input.operation.input.slice(0, HISTORY_PARAMS_LIMIT) : input.operation.input,
    truncated: input.operation.input.length > HISTORY_PARAMS_LIMIT,
  } : undefined;
  const record: HistoryRecord = { version: 1, id: input.id(), at: input.at, day, action: input.intent.action, label: spec?.label ?? input.intent.action,
    source, subject, changes, effects, ...(call ? { call } : {}) };

  // 设置合并：同一设置项、同一来源、活动日未变、改的不是日界、距上一条 ≤ 60 秒（ADR 0019 第 3 条）
  const settingKeys = [...new Set(all.filter(c => c.type === 'settings').map(c => c.id))];
  const settingKey = settingKeys.length === 1 && all.every(c => c.type === 'settings' || effects.includes(c)) ? settingKeys[0] : null;
  const sourceKey = JSON.stringify(source);
  if (settingKey && settingKey !== 'dayBoundaryHour' && last && last.settingKey === settingKey && last.sourceKey === sourceKey && last.day === day
    && nowMs - last.committedAtMs <= MERGE_WINDOW_MS) {
    const mergedChanges = mergeChanges(last.record.changes, changes), mergedEffects = mergeChanges(last.record.effects, effects);
    const merged: HistoryRecord = { ...last.record, at: input.at, changes: mergedChanges, effects: mergedEffects, merged: (last.record.merged ?? 1) + 1,
      ...(mergedChanges.length || mergedEffects.length ? { reverted: undefined } : { reverted: true }) };
    if (merged.reverted === undefined) delete merged.reverted;
    const write = repos.history.rewrite(last, merged);
    return { write, record: merged, pointer: { ...last, rawText: write.text, record: merged, committedAtMs: nowMs } };
  }
  const write = repos.history.write(record);
  return { write, record, pointer: settingKey ? { path: write.path, rawText: write.text, record, committedAtMs: nowMs, settingKey, sourceKey, day } : null };
}
