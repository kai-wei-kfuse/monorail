import { assertEntries, isIdle } from './entry';
import type { TimeEntry } from './entry';

export type PlaceMode = 'switch' | 'overlay';
export function place(entries: readonly TimeEntry[], entry: TimeEntry, mode: PlaceMode, now: string, id: () => string): TimeEntry[] {
  assertEntries([entry], now);
  const start = Date.parse(entry.started_at), end = entry.ended_at === null ? Infinity : Date.parse(entry.ended_at);
  const result: TimeEntry[] = [];
  for (const old of entries) {
    if (old.id === entry.id) continue;
    const a = Date.parse(old.started_at), b = old.ended_at === null ? Infinity : Date.parse(old.ended_at);
    if (b <= start || a >= end || (mode === 'overlay' && !isIdle(old))) { result.push(old); continue; }
    // The running/trailing part retains its identity; only an extra leading fragment gets a new ID.
    if (a < start) result.push({ ...old, id: b > end ? id() : old.id, ended_at: entry.started_at, updated_at: now });
    if (b > end) result.push({ ...old, started_at: entry.ended_at!, updated_at: now });
  }
  result.push(entry);
  result.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id));
  assertEntries(result, now);
  return result;
}

export function claim(entries: readonly TimeEntry[], from: string, at: string): string {
  const start = Date.parse(from), end = Date.parse(at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('待确认起点无效');
  let claimed = start;
  for (const entry of entries) {
    const a = Date.parse(entry.started_at), b = Date.parse(entry.ended_at ?? at);
    const offline = entry.project === '离线' || entry.source === '离线追问';
    if (!isIdle(entry) && a < end && b > start && (a >= start || offline)) claimed = Math.max(claimed, b);
  }
  return new Date(Math.min(end, claimed)).toISOString();
}
