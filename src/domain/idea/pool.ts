import type { IdeaCompletedBy, RecordEntry } from '../record/record';

export function requireIdea(record: RecordEntry): void {
  if (record.kind !== '想法' || record.pool === null) throw new Error('记录不是想法');
}
/** 想法的状态（ADR 0020）：冷库 + completed_at 是「已完成」，其余就是 pool。 */
export type IdeaStatus = '活跃池' | '冷库' | '已转任务' | '已完成';
export function ideaStatus(record: RecordEntry): IdeaStatus | null {
  if (record.kind !== '想法' || record.pool === null) return null;
  return record.pool === '冷库' && record.completed_at ? '已完成' : record.pool;
}
const isCold = (record: RecordEntry) => ideaStatus(record) === '冷库';
/**
 * 改 pool 的转换一律清掉完成字段，免得旧版捞回后留下的 completed_at 跟着走（ADR 0020 第 3、5 条）。
 * 显式写 null 而不是删键：写盘时会和原文的 frontmatter 合并，删掉的键会被原文补回来。从没有过的不添键。
 */
export const clearDone = (record: RecordEntry): RecordEntry =>
  record.completed_at == null && record.completed_by == null ? record : { ...record, completed_at: null, completed_by: null };

export const activeIdeas = (records: RecordEntry[]) => records.filter(record => record.kind === '想法' && record.pool === '活跃池');
export const doneIdeas = (records: RecordEntry[]) => records.filter(record => ideaStatus(record) === '已完成')
  .sort((a, b) => b.completed_at!.localeCompare(a.completed_at!) || a.id.localeCompare(b.id));
export function weakest(records: RecordEntry[]): RecordEntry | null {
  return [...activeIdeas(records)].sort((a, b) => Date.parse(a.last_touched_at) - Date.parse(b.last_touched_at) ||
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))[0] ?? null;
}
export function freezeIdea(record: RecordEntry, at: string): RecordEntry {
  requireIdea(record);
  if (record.pool === '已转任务') throw new Error('已转任务的想法不参加归档或对决');
  return { ...clearDone(record), pool: '冷库', cold_since: at };
}
export function reviveIdea(record: RecordEntry, at: string): RecordEntry {
  requireIdea(record);
  if (ideaStatus(record) === '已完成') throw new Error('想法已完成，请先在「已完成」里撤销完成');
  if (record.pool !== '冷库') throw new Error('想法不在冷库');
  return { ...clearDone(record), pool: '活跃池', cold_since: null, last_touched_at: at };
}
/** 完成：只允许活跃池的想法；已完成的由调用方按 noop 处理（ADR 0020 第 3 条）。 */
export function completeIdea(record: RecordEntry, at: string, by: IdeaCompletedBy): RecordEntry {
  requireIdea(record);
  const status = ideaStatus(record);
  if (status !== '活跃池') throw new Error(`想法当前是「${status}」，只有想法池里的想法能标记完成`);
  return { ...record, pool: '冷库', cold_since: at, completed_at: at, completed_by: by, last_touched_at: at };
}
/** 撤销完成：回到活跃池，算一次「动过」。池子满了也放回，下次回顾用擂台压回。 */
export function uncompleteIdea(record: RecordEntry, at: string): RecordEntry {
  requireIdea(record);
  if (ideaStatus(record) !== '已完成') throw new Error('想法不是已完成的');
  return { ...clearDone(record), pool: '活跃池', cold_since: null, last_touched_at: at };
}
export function expiredIdeas(records: RecordEntry[], at: string, days: number): RecordEntry[] {
  const elapsed = days * 86400000;
  return activeIdeas(records).filter(record => Date.parse(at) - Date.parse(record.last_touched_at) >= elapsed).map(record => freezeIdea(record, at));
}
export function coldOffer(records: RecordEntry[]): RecordEntry[] {
  // Product contract: offer the two oldest cold entries, only on explicit request. Completed ideas are not cold (ADR 0020).
  return records.filter(isCold)
    .sort((a, b) => Date.parse(a.cold_since!) - Date.parse(b.cold_since!) || a.id.localeCompare(b.id)).slice(0, 2);
}
