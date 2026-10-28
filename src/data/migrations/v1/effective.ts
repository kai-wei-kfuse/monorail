// Frozen 0.1.4 format/semantics for the one-way v2 migration.
import type { Segment } from './segment';

export function effective(segments: Segment[], now: string): Segment[] {
  const groups = new Map<number, Segment[]>();
  const identities = new Map<string, number>();
  let result: Segment[] = [];
  for (const segment of [...segments].sort((a, b) => a.seq - b.seq)) {
    const start = Date.parse(segment.started_at), end = Date.parse(segment.ended_at ?? now);
    if (end < start) throw new Error(`Invalid segment: ${segment.id}`);
    if (start === end) continue;
    const siblings = groups.get(segment.seq) ?? [];
    if (identities.has(segment.id) && identities.get(segment.id) !== segment.seq) throw new Error(`Changed seq for ${segment.id}`);
    // Cross-day file fragments retain the logical segment's id and precedence.
    // Reusing a sequence for another segment, or overlapping its fragments, is corruption.
    if (siblings.some(s => s.id !== segment.id || s.card_id !== segment.card_id || s.activity !== segment.activity ||
      s.source !== segment.source || s.category !== segment.category ||
      (Date.parse(s.started_at) < end && Date.parse(s.ended_at ?? now) > start))) throw new Error(`Duplicate seq: ${segment.seq}`);
    groups.set(segment.seq, [...siblings, segment]); identities.set(segment.id, segment.seq);
    const next: Segment[] = [];
    for (const previous of result) {
      const a = Date.parse(previous.started_at), b = Date.parse(previous.ended_at!);
      if (b <= start || a >= end) { next.push(previous); continue; }
      if (a < start) next.push({ ...previous, ended_at: segment.started_at });
      if (b > end) next.push({ ...previous, started_at: new Date(end).toISOString() });
    }
    next.push({ ...segment, ended_at: new Date(end).toISOString() });
    result = next;
  }
  return result.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}
