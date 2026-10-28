import { expect, it } from 'vitest';
import type { TimeEntry } from './entry';
import { assertEntries, refElapsed } from './entry';
import { claim, place } from './place';
import { applyReadout, previewReadout } from './edit';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 0, minute)).toISOString();
const entry = (id: string, start: number, end: number | null, fields: Partial<TimeEntry> = {}): TimeEntry => ({
  id, started_at: at(start), ended_at: end === null ? null : at(end), description: id, project: '学习', tags: [],
  card_id: null, kind: '普通', source: '计时', updated_at: at(start), ...fields,
});

it('A1 overlay keeps 60 minutes of work plus 20 minutes of restroom; switch keeps 40 plus 20', () => {
  const old = entry('work', 0, 60, { card_id: 'card' }), added = entry('restroom', 20, 40);
  const overlay = place([old], added, 'overlay', at(60), () => 'front');
  expect(refElapsed(overlay, 'card', at(60))).toBe(60 * 60000);
  const switched = place([old], added, 'switch', at(60), () => 'front');
  expect(refElapsed(switched, 'card', at(60))).toBe(40 * 60000);
  expect(switched.find(value => value.id === old.id)?.started_at).toBe(at(40));
  expect(old.ended_at).toBe(at(60));
});
it('overlay splits running idle and preserves the running tail identity', () => {
  const idle = entry('idle', 0, null, { project: '待机' });
  const placed = place([idle], entry('manual', 10, 20), 'overlay', at(30), () => 'head');
  expect(placed.map(value => [value.id, value.started_at, value.ended_at])).toEqual([
    ['head', at(0), at(10)], ['manual', at(10), at(20)], ['idle', at(20), null],
  ]);
});
it('R1 protects offline crossing pending but truncates the earlier ordinary activity', () => {
  expect(claim([entry('offline', 39, 59, { project: '离线' })], at(40), at(60))).toBe(at(59));
  expect(claim([entry('work', 30, null)], at(40), at(60))).toBe(at(40));
  expect(claim([entry('wc', 45, 50, { kind: '插入' })], at(40), at(60))).toBe(at(50));
  expect(claim([entry('sleep', 39, 59, { project: '睡眠', source: '离线追问' })], at(40), at(60))).toBe(at(59));
});
it('R2 includes second-sized overlaps and requires a fresh confirmation if content or coverage changes', () => {
  const rows = [entry('a', 0, 1), entry('b', 1, null)];
  const req = { entryId: 'b', at: at(2), milliseconds: 80000, mode: 'entry' as const };
  const preview = applyReadout(rows, req, null, at(2), () => 'unused');
  expect(preview.kind).toBe('confirm');
  expect(Date.parse(preview.plan.hit[0].to) - Date.parse(preview.plan.hit[0].from)).toBe(20000);
  expect(rows[1].started_at).toBe(at(1));
  const changed = [{ ...rows[0], description: 'changed' }, rows[1]];
  expect(applyReadout(changed, req, preview.plan, at(3), () => 'unused').kind).toBe('confirm');
  const result = applyReadout(rows, req, preview.plan, at(3), () => 'unused');
  expect(result.kind).toBe('done');
  expect(result.plan.start).toBe(new Date(Date.parse(at(2)) - 80000).toISOString());
});
it('R2 rejects a replaced running target and previews concurrent manual entries that would be removed', () => {
  const rows = [entry('b', 10, null), entry('parallel', 12, 14)];
  expect(() => previewReadout(rows, { entryId: 'a', at: at(20), milliseconds: 10, mode: 'entry' })).toThrow('已经换成');
  const plan = previewReadout(rows, { entryId: 'b', at: at(20), milliseconds: 12 * 60000, mode: 'entry' });
  expect(plan.hit.map(hit => hit.id)).toEqual(['parallel']);
});
it('R3 rejects totals below closed time; raising a total skips prior segments of the same reference', () => {
  const rows = [entry('old', 0, 10, { card_id: 'c' }), entry('idle', 10, 15, { project: '待机' }), entry('open', 15, null, { card_id: 'c' })];
  const req = { entryId: 'open', at: at(20), milliseconds: 30 * 60000, mode: 'ref' as const };
  expect(() => previewReadout(rows, { ...req, milliseconds: 5 * 60000 })).toThrow('最少 10');
  const result = applyReadout(rows, req, null, at(20), () => 'unused');
  expect(result.kind).toBe('done');
  if (result.kind === 'done') expect(refElapsed(result.entries, 'c', at(20))).toBe(30 * 60000);
});
it.each([
  [entry('x', 1, 1)], [entry('x', 0, 61)], [entry('x', 61, null)],
  [entry('x', 0, null), entry('y', 1, null)], [entry('x', 0, 1), entry('x', 2, 3)],
  [entry('x', 0, 10, { project: '待机' }), entry('y', 5, 15)],
].map(rows => ({ rows })))('rejects invalid timeline $rows', ({ rows }) => { expect(() => assertEntries(rows, at(60))).toThrow(); });
