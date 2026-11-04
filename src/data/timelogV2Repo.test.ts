import { expect, it } from 'vitest';
import { MemoryFs } from './memoryFs';
import { TimelogV2Repo } from './timelogV2Repo';
import { Journal, committedWrite, createWrite } from './journal';
import type { TimeEntry } from '../domain/timeline/entry';

const time = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
const entry = (): TimeEntry => ({ id: 'cross-day', started_at: time(27, 3), ended_at: time(28, 5),
  description: 'work', project: '学习', tags: [], card_id: null, kind: '普通', source: '手动', updated_at: time(28, 5) });
it('stores once by start activity-day, queries intersecting later days, and moves/deletes via the journal', async () => {
  const fs = new MemoryFs(), repo = new TimelogV2Repo(fs), journal = new Journal(fs), now = time(28, 6);
  const save = async (rows: TimeEntry[]) => { const writes = await repo.writes(rows, now, 4); await journal.run(crypto.randomUUID(), writes); repo.acceptCommitted(writes); };
  await save([entry()]);
  expect(await fs.list('timelog')).toEqual(['timelog/2026-10-26.md']);
  expect(repo.between(time(28, 0), time(28, 6))).toHaveLength(1);
  const reloaded = new TimelogV2Repo(fs); expect(await reloaded.scan(now, 4)).toEqual([entry()]);
  await save([{ ...entry(), started_at: time(27, 5) }]);
  expect(await fs.list('timelog')).toEqual(['timelog/2026-10-27.md']);
  await save([]); expect(await fs.list('timelog')).toEqual([]);
});
it('does not publish a partial write, and recovery reconstructs the full timeline', async () => {
  const fs = new MemoryFs(), repo = new TimelogV2Repo(fs), journal = new Journal(fs), now = time(28, 6);
  const writes = [...await repo.writes([entry()], now, 4), createWrite('state.yaml', 'schemaVersion: 2', null)];
  fs.beforeWrite = path => { if (path === 'state.yaml') throw new Error('power loss'); };
  await expect(journal.run(crypto.randomUUID(), writes)).rejects.toThrow('power loss');
  expect(repo.snapshot()).toEqual([]);
  fs.beforeWrite = undefined; await journal.recover();
  expect(await new TimelogV2Repo(fs).scan(now, 4)).toEqual([entry()]);
});

it('groups days without changing input or committed index and writes only changed days', async () => {
  const fs = new MemoryFs(), repo = new TimelogV2Repo(fs), journal = new Journal(fs), now = time(28, 8);
  const rows = Object.freeze([
    Object.freeze({ ...entry(), id: 'a', started_at: time(27, 9), ended_at: time(27, 10) }),
    Object.freeze({ ...entry(), id: 'b', started_at: time(27, 11), ended_at: time(27, 12) }),
    Object.freeze({ ...entry(), id: 'c', started_at: time(28, 5), ended_at: time(28, 6) }),
  ]);
  const before = structuredClone(rows);
  const writes = await repo.writes(rows, now, 4);
  expect(rows).toEqual(before);
  expect(repo.snapshot()).toEqual([]);
  expect(await fs.list('timelog')).toEqual([]);
  await journal.run(crypto.randomUUID(), writes);
  repo.acceptCommitted(writes);
  expect(repo.snapshot()).toEqual(before);
  const updated = rows.map(row => row.id === 'b' ? { ...row, description: 'changed' } : row);
  const change = await repo.writes(updated, now, 4);
  expect(change).toHaveLength(1);
  expect(repo.snapshot()).toEqual(before);
  await journal.run(crypto.randomUUID(), change);
  repo.acceptCommitted(change);
  expect(repo.snapshot()).toEqual(updated);
});
it('changedDays reports the activity days that writes() would rewrite, with copies of before and after (ADR 0019 §4)', async () => {
  const fs = new MemoryFs(), repo = new TimelogV2Repo(fs), journal = new Journal(fs), now = time(28, 6);
  const other: TimeEntry = { ...entry(), id: 'other', started_at: time(28, 4), ended_at: time(28, 5), description: 'other' };
  const writes = await repo.writes([entry(), other], now, 4); await journal.run(crypto.randomUUID(), writes); repo.acceptCommitted(writes);
  expect(repo.changedDays([entry(), other], 4)).toEqual([]);
  // 键顺序不同、内容相同不算改动（和 writes() 一样先过 schema）。
  const reordered = Object.fromEntries(Object.entries(other).reverse()) as unknown as TimeEntry;
  expect(repo.changedDays([entry(), reordered], 4)).toEqual([]);
  const moved = { ...entry(), started_at: time(27, 5) };
  const changes = repo.changedDays([moved, other], 4);
  expect(changes).toEqual([
    { day: '2026-10-26', before: [entry()], after: [] },
    { day: '2026-10-27', before: [], after: [moved] },
  ]);
  expect(changes.map(change => change.day)).toEqual((await repo.writes([moved, other], now, 4)).map(write => committedWrite(write).path.slice(8, 18)));
  changes[0].before[0].description = 'mutated';
  expect(repo.snapshot().find(item => item.id === 'cross-day')!.description).toBe('work');
});
