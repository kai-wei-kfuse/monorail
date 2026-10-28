export interface TimeEntry {
  id: string; started_at: string; ended_at: string | null; description: string; project: string;
  tags: string[]; card_id: string | null; kind: '普通' | '插入' | '暂停';
  source: '计时' | '手动' | '日历' | '自动' | '离线追问'; updated_at: string;
}
export type EntryTemplate = Pick<TimeEntry, 'description' | 'project' | 'tags' | 'card_id'>;
export const isIdle = (entry: TimeEntry) => entry.project === '待机';
export const milliseconds = (entry: TimeEntry, at: string) => Date.parse(entry.ended_at ?? at) - Date.parse(entry.started_at);
export const refElapsed = (entries: readonly TimeEntry[], ref: string, at: string) =>
  entries.filter(entry => entry.card_id === ref).reduce((sum, entry) => sum + milliseconds(entry, at), 0);

export function assertEntries(entries: readonly TimeEntry[], now: string): void {
  const at = Date.parse(now), ids = new Set<string>();
  if (!Number.isFinite(at)) throw new Error('无效的当前时间');
  let open = 0;
  for (const entry of entries) {
    const start = Date.parse(entry.started_at), end = entry.ended_at === null ? Infinity : Date.parse(entry.ended_at);
    if (!entry.id || ids.has(entry.id)) throw new Error(`条目 id 重复或为空：${entry.id}`);
    ids.add(entry.id);
    if (!Number.isFinite(start) || start > at || !(end > start) || (entry.ended_at !== null && (!Number.isFinite(end) || end > at))) {
      throw new Error(`计时时间无效：${entry.id}`);
    }
    if (entry.ended_at === null && ++open > 1) throw new Error('最多一条记录在计时');
    if (isIdle(entry) && entries.some(other => other.id !== entry.id && Date.parse(other.started_at) < end &&
      (other.ended_at === null ? Infinity : Date.parse(other.ended_at)) > start)) throw new Error('待机不能与其他条目重叠');
  }
}
