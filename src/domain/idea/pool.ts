import type { RecordEntry } from '../record/record';

export function requireIdea(record: RecordEntry): void {
  if (record.kind !== '想法' || record.pool === null) throw new Error('记录不是想法');
}
export const activeIdeas = (records: RecordEntry[]) => records.filter(record => record.kind === '想法' && record.pool === '活跃池');
export function weakest(records: RecordEntry[]): RecordEntry | null {
  return [...activeIdeas(records)].sort((a, b) => Date.parse(a.last_touched_at) - Date.parse(b.last_touched_at) ||
    Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))[0] ?? null;
}
export function freezeIdea(record: RecordEntry, at: string): RecordEntry {
  requireIdea(record);
  if (record.pool === '已转任务') throw new Error('已转任务的想法不参加归档或对决');
  return { ...record, pool: '冷库', cold_since: at };
}
export function reviveIdea(record: RecordEntry, at: string): RecordEntry {
  requireIdea(record);
  if (record.pool !== '冷库') throw new Error('想法不在冷库');
  return { ...record, pool: '活跃池', cold_since: null, last_touched_at: at };
}
export function expiredIdeas(records: RecordEntry[], at: string, days: number): RecordEntry[] {
  const elapsed = days * 86400000;
  return activeIdeas(records).filter(record => Date.parse(at) - Date.parse(record.last_touched_at) >= elapsed).map(record => freezeIdea(record, at));
}
export function coldOffer(records: RecordEntry[]): RecordEntry[] {
  // Product contract: offer the two oldest cold entries, only on explicit request.
  return records.filter(record => record.kind === '想法' && record.pool === '冷库')
    .sort((a, b) => Date.parse(a.cold_since!) - Date.parse(b.cold_since!) || a.id.localeCompare(b.id)).slice(0, 2);
}
