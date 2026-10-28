import type { TimeEntry } from '../../domain/timeline/entry';
import { assertEntries } from '../../domain/timeline/entry';
import { splitAtDays } from '../../domain/timeline/day';
import { effective } from './v1/effective';
import type { Segment } from './v1/segment';

const project = (category: string) => category === '主线' || category === '支线' ? '未分类' : category;
export function migrateTimeline(segments: Segment[], openId: string | null, now: string, id: () => string): TimeEntry[] {
  const view = effective(segments, now), grouped = new Map<string, Segment[]>();
  for (const segment of view) {
    const siblings = grouped.get(segment.id) ?? [], last = siblings.at(-1);
    if (last && Date.parse(last.ended_at!) === Date.parse(segment.started_at)) last.ended_at = segment.ended_at;
    else siblings.push({ ...segment });
    grouped.set(segment.id, siblings);
  }
  const entries: TimeEntry[] = [];
  for (const [originalId, siblings] of grouped) siblings.forEach((segment, index) => {
    const tail = index === siblings.length - 1;
    entries.push({ id: tail ? originalId : id(), started_at: segment.started_at,
      ended_at: originalId === openId && tail ? null : segment.ended_at,
      description: segment.activity, project: project(segment.category), tags: [], card_id: segment.card_id,
      kind: segment.kind, source: segment.source === '补记' ? '手动' : segment.source, updated_at: now });
  });
  // A just-created running segment may have zero observed duration at the migration clock.
  if (openId && !entries.some(entry => entry.id === openId)) {
    const raw = segments.find(segment => segment.id === openId && segment.ended_at === null);
    if (!raw || Date.parse(raw.started_at) !== Date.parse(now)) throw new Error('迁移缺少当前计时段');
    entries.push({ id: raw.id, started_at: raw.started_at, ended_at: null, description: raw.activity,
      project: project(raw.category), tags: [], card_id: raw.card_id, kind: raw.kind,
      source: raw.source === '补记' ? '手动' : raw.source, updated_at: now });
  }
  assertEntries(entries, now);
  if (entries.filter(entry => entry.ended_at === null).length !== (openId ? 1 : 0)) throw new Error('迁移当前计时数量错误');
  return entries.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

export function auditTime(segments: Segment[], entries: TimeEntry[], now: string, boundary: number): void {
  const total = (rows: { start: string; end: string; project: string; ref: string | null }[]) => {
    const result = new Map<string, number>();
    const add = (key: string, duration: number) => { result.set(key, (result.get(key) ?? 0) + duration); };
    for (const row of rows) {
      for (const piece of splitAtDays(row.start, row.end, boundary)) add(`day:${piece.day}:${row.project}`, Date.parse(piece.end) - Date.parse(piece.start));
      if (row.ref) add(`ref:${row.ref}`, Date.parse(row.end) - Date.parse(row.start));
    }
    return Object.fromEntries([...result].filter(([, duration]) => duration !== 0).sort(([a], [b]) => a.localeCompare(b)));
  };
  const before = total(effective(segments, now).map(row => ({ start: row.started_at, end: row.ended_at!, project: project(row.category), ref: row.card_id })));
  const after = total(entries.map(row => ({ start: row.started_at, end: row.ended_at ?? now, project: row.project, ref: row.card_id })));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`迁移时长对账失败：${JSON.stringify({ before, after })}`);
}
