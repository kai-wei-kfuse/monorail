import { assertEntries, isIdle } from './entry';
import type { TimeEntry } from './entry';
import { place } from './place';

export interface ReadoutRequest { entryId: string; at: string; milliseconds: number; mode: 'entry' | 'ref' }
export interface Coverage { id: string; description: string; project: string; tags: string[]; card_id: string | null; from: string; to: string }
export interface ReadoutPlan { entryId: string; start: string; hit: Coverage[] }

function refStart(entries: readonly TimeEntry[], open: TimeEntry, at: number, target: number): number {
  const history = entries.filter(entry => entry.id !== open.id && entry.card_id === open.card_id);
  const closed = history.reduce((sum, entry) => sum + Date.parse(entry.ended_at!) - Date.parse(entry.started_at), 0);
  if (target < closed) throw new Error(`最少 ${closed / 60000} 分钟（之前各段已计 ${closed / 60000} 分钟）`);
  // Sweep backwards: extending the open interval adds time, while covered own-history is removed.
  // Interval multiplicity also accounts for parallel copies of the same reference.
  const events = new Map<number, number>(); let active = 0, total = 0, cursor = at;
  for (const entry of history) {
    const start = Date.parse(entry.started_at), end = Date.parse(entry.ended_at!);
    total += Math.max(0, Math.min(at, end) - start);
    if (start <= at && end > at) active++;
    for (const [time, delta] of [[end, 1], [start, -1]]) if (time <= at) events.set(time, (events.get(time) ?? 0) + delta);
  }
  for (const [time, delta] of [...events].sort(([a], [b]) => b - a)) {
    const slope = 1 - active, duration = cursor - time;
    if (slope > 0 && total + slope * duration >= target) return cursor - (target - total) / slope;
    total += slope * duration; cursor = time; active += delta;
  }
  return cursor - (target - total);
}

export function previewReadout(entries: readonly TimeEntry[], request: ReadoutRequest): ReadoutPlan {
  const open = entries.find(entry => entry.ended_at === null);
  if (!open || open.id !== request.entryId) throw new Error('已经换成别的事了，没有改');
  if (isIdle(open)) throw new Error('现在没有在计时');
  const at = Date.parse(request.at), target = request.milliseconds;
  if (!Number.isFinite(at) || at < Date.parse(open.started_at)) throw new Error('命令时间早于当前计时');
  if (!Number.isFinite(target) || target < 0) throw new Error('读数不能小于 0');
  let start = at - target;
  if (request.mode === 'ref') {
    if (!open.card_id) throw new Error('当前条目没有引用');
    start = refStart(entries, open, at, target);
  }
  const hit = entries.filter(entry => entry.id !== open.id && !isIdle(entry) &&
    !(request.mode === 'ref' && entry.card_id === open.card_id)).flatMap(entry => {
      const from = Math.max(start, Date.parse(entry.started_at)), to = Date.parse(entry.ended_at ?? request.at);
      return to > from ? [{ id: entry.id, description: entry.description, project: entry.project, tags: [...entry.tags],
        card_id: entry.card_id, from: new Date(from).toISOString(), to: new Date(to).toISOString() }] : [];
    }).sort((a, b) => a.id.localeCompare(b.id));
  return { entryId: open.id, start: new Date(start).toISOString(), hit };
}

export function applyReadout(entries: readonly TimeEntry[], request: ReadoutRequest, seen: ReadoutPlan | null, now: string, id: () => string):
  { kind: 'confirm'; plan: ReadoutPlan } | { kind: 'done'; entries: TimeEntry[]; plan: ReadoutPlan } {
  const plan = previewReadout(entries, request);
  if (plan.hit.length && JSON.stringify(plan) !== JSON.stringify(seen)) return { kind: 'confirm', plan };
  const entry = entries.find(value => value.id === request.entryId)!;
  return { kind: 'done', plan, entries: place(entries, { ...entry, started_at: plan.start, updated_at: now }, 'switch', now, id) };
}

export function editEntry(entries: readonly TimeEntry[], entryId: string, patch: Partial<Pick<TimeEntry, 'description' | 'project' | 'tags' | 'started_at' | 'ended_at'>>, at: string, id: () => string): TimeEntry[] {
  const entry = entries.find(value => value.id === entryId);
  if (!entry) throw new Error('计时条目不存在');
  if (entry.ended_at === null && patch.ended_at !== undefined) throw new Error('正在计时的条目不能直接设置结束时间');
  return place(entries, { ...entry, ...patch, updated_at: at }, 'overlay', at, id);
}
export function removeEntry(entries: readonly TimeEntry[], entryId: string, at: string): TimeEntry[] {
  const entry = entries.find(value => value.id === entryId);
  if (!entry) throw new Error('计时条目不存在');
  if (entry.ended_at === null) throw new Error('正在计时的条目不能删除');
  const next = entries.filter(value => value.id !== entryId);
  assertEntries(next, at);
  return next;
}
