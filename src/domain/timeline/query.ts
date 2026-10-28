import type { TimeEntry } from './entry';
import type { Coverage } from './edit';

export function inRange(entries: readonly TimeEntry[], start: string, end: string, at: string): TimeEntry[] {
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || !Number.isFinite(Date.parse(at))) throw new Error('时间范围无效');
  return entries.filter(entry => Date.parse(entry.started_at) < to && Date.parse(entry.ended_at ?? at) > from)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id));
}
export function overlaps(entries: readonly TimeEntry[], start: string, end: string, at: string): Coverage[] {
  return inRange(entries, start, end, at).filter(entry => entry.project !== '待机').map(entry => ({
    id: entry.id, description: entry.description, project: entry.project, tags: [...entry.tags], card_id: entry.card_id,
    from: new Date(Math.max(Date.parse(start), Date.parse(entry.started_at))).toISOString(),
    to: new Date(Math.min(Date.parse(end), Date.parse(entry.ended_at ?? at))).toISOString(),
  }));
}
